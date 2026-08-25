//! Integration tests for the Settlement program, ported case-by-case from the frozen
//! EVM reference suite (`contracts/test/Settlement.t.sol`). Time-dependent window
//! behavior runs against LiteSVM with a warped Clock sysvar (the `vm.warp` port);
//! the pure leaky-bucket math also has unit tests in `src/lib.rs`.
//!
//! Not ported, with reasons:
//! - `test_alpha_zero_treasury_reverts`: EVM constructor guard; an SPL mint has no
//!   constructor. The genesis invariants (fixed supply to treasury, mint authority
//!   revoked) are covered by `alpha_genesis_fixed_supply_and_revoked_mint`.
//! - `test_depositWithPermit_*`: ERC-2612 is an EVM workaround for two-step
//!   approve+deposit; a Solana transaction natively carries both instructions.
//! - `test_renounceOwnership_disabled`: no renounce instruction exists to disable;
//!   `transfer_admin_rejects_zero` covers the "cannot orphan the admin" intent.
//! - `testFuzz_rolling_window_never_exceeds_cap`: ported as a unit test on the pure
//!   drain function (`rolling_window_never_exceeds_cap_fuzz` in `src/lib.rs`).

use anchor_lang::prelude::Pubkey;
use anchor_lang::AnchorSerialize;
use ed25519_dalek::{Signer as DalekSigner, SigningKey};
use litesvm::LiteSVM;
use litesvm_token::spl_token;
use litesvm_token::{get_spl_account, CreateAssociatedTokenAccount, CreateMint, MintTo};
use settlement::{voucher_message, SettlementState};
use sha2::{Digest, Sha256};
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_signer::Signer;
use solana_transaction::Transaction;
use std::str::FromStr;

const WINDOW: i64 = settlement::WINDOW;
const WINDOW_CAP: u64 = 1_000_000_000_000; // 1000 ALPHA at 9dp
const CHAIN_ID: u64 = 0; // localnet
const DECIMALS: u8 = 9;
const CAP_SUPPLY: u64 = 2_000_000_000_000_000; // 2,000,000 ALPHA at 9dp

const ATA_PROGRAM: &str = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// Anchor error codes, in declaration order (custom errors start at 6000).
const ERR_PAUSED: u32 = 6000;
const ERR_ZERO_AMOUNT: u32 = 6001;
const ERR_EXPIRED: u32 = 6002;
const ERR_BAD_SIGNATURE: u32 = 6003;
const ERR_WINDOW_CAP: u32 = 6004;
const ERR_ZERO_CAP: u32 = 6005;
const ERR_ZERO_ADDRESS: u32 = 6006;
const ERR_SIGNER_EQ_ADMIN: u32 = 6007;
const ERR_NOT_ADMIN: u32 = 6008;
const ERR_NOT_PENDING_ADMIN: u32 = 6009;

fn disc(name: &str) -> [u8; 8] {
    let h = Sha256::digest(format!("global:{name}").as_bytes());
    h[0..8].try_into().unwrap()
}

fn ata_for(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    let ata_prog = Pubkey::from_str(ATA_PROGRAM).unwrap();
    Pubkey::find_program_address(
        &[owner.as_ref(), spl_token::ID.as_ref(), mint.as_ref()],
        &ata_prog,
    )
    .0
}

struct World {
    svm: LiteSVM,
    program_id: Pubkey,
    payer: Keypair,       // fee payer / depositor wallet
    admin: Keypair,       // cold key
    game_signer: SigningKey, // hot ed25519 voucher key
    player: Pubkey,       // withdrawal recipient wallet
    mint: Pubkey,
    treasury_ata: Pubkey,
    state: Pubkey,
    escrow: Pubkey,
}

impl World {
    fn signer_pubkey(&self) -> Pubkey {
        Pubkey::new_from_array(self.game_signer.verifying_key().to_bytes())
    }

    fn now(&self) -> i64 {
        self.svm
            .get_sysvar::<anchor_lang::prelude::Clock>()
            .unix_timestamp
    }

    fn warp(&mut self, secs: i64) {
        let mut clock = self.svm.get_sysvar::<anchor_lang::prelude::Clock>();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    fn state_data(&self) -> SettlementState {
        let acc = self.svm.get_account(&self.state).unwrap();
        anchor_lang::AccountDeserialize::try_deserialize(&mut acc.data.as_slice()).unwrap()
    }

    fn token_balance(&self, ata: &Pubkey) -> u64 {
        get_spl_account::<spl_token::state::Account>(&self.svm, ata)
            .map(|a| a.amount)
            .unwrap_or(0)
    }

    fn send(&mut self, ixs: &[Instruction], extra_signers: &[&Keypair]) -> Result<(), String> {
        self.svm.expire_blockhash();
        let mut signers: Vec<&Keypair> = vec![&self.payer];
        signers.extend_from_slice(extra_signers);
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&self.payer.pubkey()),
            &signers,
            self.svm.latest_blockhash(),
        );
        self.svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|f| format!("{:?}", f.err))
    }

    // ------------------------------------------------------------ instructions

    fn initialize_ix(&self, signer: Pubkey, window_cap: u64, chain_id: u64, admin: Pubkey) -> Instruction {
        let mut data = disc("initialize").to_vec();
        signer.serialize(&mut data).unwrap();
        data.extend_from_slice(&window_cap.to_le_bytes());
        data.extend_from_slice(&chain_id.to_le_bytes());
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.state, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new(self.escrow, false),
                AccountMeta::new(admin, true),
                AccountMeta::new_readonly(spl_token::ID, false),
                AccountMeta::new_readonly(Pubkey::from_str(ATA_PROGRAM).unwrap(), false),
                AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
            ],
            data,
        }
    }

    fn deposit_ix(&self, depositor: Pubkey, amount: u64) -> Instruction {
        let mut data = disc("deposit").to_vec();
        data.extend_from_slice(&amount.to_le_bytes());
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new_readonly(self.state, false),
                AccountMeta::new_readonly(depositor, true),
                AccountMeta::new(ata_for(&depositor, &self.mint), false),
                AccountMeta::new(self.escrow, false),
                AccountMeta::new_readonly(spl_token::ID, false),
            ],
            data,
        }
    }

    fn ed25519_ix(&self, key: &SigningKey, msg: &[u8]) -> Instruction {
        let sig = key.sign(msg).to_bytes();
        let pk = key.verifying_key().to_bytes();
        // header(2) + offsets(14) + pubkey(32) + sig(64) + msg
        let pk_off: u16 = 16;
        let sig_off: u16 = 16 + 32;
        let msg_off: u16 = 16 + 32 + 64;
        let mut data = vec![1u8, 0u8];
        data.extend_from_slice(&sig_off.to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&pk_off.to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&msg_off.to_le_bytes());
        data.extend_from_slice(&(msg.len() as u16).to_le_bytes());
        data.extend_from_slice(&u16::MAX.to_le_bytes());
        data.extend_from_slice(&pk);
        data.extend_from_slice(&sig);
        data.extend_from_slice(msg);
        Instruction {
            program_id: solana_sdk_ids::ed25519_program::ID,
            accounts: vec![],
            data,
        }
    }

    fn withdraw_ixs_signed_by(
        &self,
        key: &SigningKey,
        to_wallet: Pubkey,
        signed_amount: u64,
        submitted_amount: u64,
        nonce: u64,
        deadline: i64,
    ) -> Vec<Instruction> {
        let msg = voucher_message(
            &self.program_id,
            CHAIN_ID,
            &to_wallet,
            signed_amount,
            nonce,
            deadline,
        );
        let ed = self.ed25519_ix(key, &msg);

        let nonce_pda = Pubkey::find_program_address(
            &[b"nonce", nonce.to_le_bytes().as_ref()],
            &self.program_id,
        )
        .0;
        let mut data = disc("withdraw").to_vec();
        data.extend_from_slice(&submitted_amount.to_le_bytes());
        data.extend_from_slice(&nonce.to_le_bytes());
        data.extend_from_slice(&deadline.to_le_bytes());
        data.push(0u8); // ed25519 instruction index in this tx
        let wd = Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.state, false),
                AccountMeta::new(self.payer.pubkey(), true),
                AccountMeta::new_readonly(to_wallet, false),
                AccountMeta::new(nonce_pda, false),
                AccountMeta::new(self.escrow, false),
                AccountMeta::new(ata_for(&to_wallet, &self.mint), false),
                AccountMeta::new_readonly(solana_sdk_ids::sysvar::instructions::ID, false),
                AccountMeta::new_readonly(self.mint, false),
                AccountMeta::new_readonly(spl_token::ID, false),
                AccountMeta::new_readonly(Pubkey::from_str(ATA_PROGRAM).unwrap(), false),
                AccountMeta::new_readonly(solana_sdk_ids::system_program::ID, false),
            ],
            data,
        };
        vec![ed, wd]
    }

    fn withdraw_ixs(&self, to: Pubkey, amount: u64, nonce: u64, deadline: i64) -> Vec<Instruction> {
        let key = self.game_signer.clone();
        self.withdraw_ixs_signed_by(&key, to, amount, amount, nonce, deadline)
    }

    fn admin_ix(&self, name: &str, arg: Option<&[u8]>, admin: Pubkey) -> Instruction {
        let mut data = disc(name).to_vec();
        if let Some(a) = arg {
            data.extend_from_slice(a);
        }
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(self.state, false),
                AccountMeta::new_readonly(admin, true),
            ],
            data,
        }
    }
}

/// Genesis + initialize: mimics `scripts` genesis — create the mint, mint the full
/// fixed supply to the treasury, revoke the mint authority — then initialize the
/// settlement state and fund the escrow via a deposit.
fn setup() -> World {
    let mut svm = LiteSVM::new();
    let program_id = Pubkey::from_str("FFNwC5HX9jzjnNrLiUkJ3y6uovVCGCpms5jo9R2Yn9o1").unwrap();
    svm.add_program_from_file(program_id, "../target/deploy/settlement.so")
        .expect("run `anchor build` first");

    let payer = Keypair::new();
    let admin = Keypair::new();
    let player = Keypair::new().pubkey();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();

    // ALPHA genesis (treasury = payer for tests)
    let mint = CreateMint::new(&mut svm, &payer)
        .authority(&payer.pubkey())
        .decimals(DECIMALS)
        .send()
        .unwrap();
    let treasury_ata = CreateAssociatedTokenAccount::new(&mut svm, &payer, &mint)
        .owner(&payer.pubkey())
        .send()
        .unwrap();
    MintTo::new(&mut svm, &payer, &mint, &treasury_ata, CAP_SUPPLY)
        .send()
        .unwrap();
    let revoke = spl_token::instruction::set_authority(
        &spl_token::ID,
        &mint,
        None,
        spl_token::instruction::AuthorityType::MintTokens,
        &payer.pubkey(),
        &[],
    )
    .unwrap();
    let tx = Transaction::new_signed_with_payer(
        &[revoke],
        Some(&payer.pubkey()),
        &[&payer],
        svm.latest_blockhash(),
    );
    svm.send_transaction(tx).unwrap();

    let state = Pubkey::find_program_address(&[b"settlement"], &program_id).0;
    let game_signer = SigningKey::from_bytes(&[7u8; 32]);

    let mut w = World {
        escrow: Pubkey::default(),
        svm,
        program_id,
        payer,
        admin,
        game_signer,
        player,
        mint,
        treasury_ata,
        state,
    };
    w.escrow = ata_for(&state, &mint);

    let ix = w.initialize_ix(w.signer_pubkey(), WINDOW_CAP, CHAIN_ID, w.admin.pubkey());
    let admin = w.admin.insecure_clone();
    w.send(&[ix], &[&admin]).unwrap();

    // Fund the escrow: deposit 10 * WINDOW_CAP from the treasury (payer's) ATA.
    let dep = w.deposit_ix(w.payer.pubkey(), 10 * WINDOW_CAP);
    w.send(&[dep], &[]).unwrap();
    w
}

fn assert_custom(err: &str, code: u32) {
    assert!(
        err.contains(&format!("Custom({code})")),
        "expected Custom({code}), got: {err}"
    );
}

// ------------------------------------------------------------------ token genesis

#[test]
fn alpha_genesis_fixed_supply_and_revoked_mint() {
    let w = setup();
    let mint: spl_token::state::Mint = get_spl_account(&w.svm, &w.mint).unwrap();
    assert_eq!(mint.supply, CAP_SUPPLY);
    assert!(mint.mint_authority.is_none(), "mint authority must be revoked");
    assert!(mint.freeze_authority.is_none(), "no freeze authority");
    // whole supply started at the treasury; escrow now holds the test deposit
    assert_eq!(
        w.token_balance(&w.treasury_ata) + w.token_balance(&w.escrow),
        CAP_SUPPLY
    );
}

// ----------------------------------------------------------------------- deposits

#[test]
fn deposit_transfers() {
    let mut w = setup();
    let before_escrow = w.token_balance(&w.escrow);
    let before_treasury = w.token_balance(&w.treasury_ata);
    let ix = w.deposit_ix(w.payer.pubkey(), 5_000);
    w.send(&[ix], &[]).unwrap();
    assert_eq!(w.token_balance(&w.escrow), before_escrow + 5_000);
    assert_eq!(w.token_balance(&w.treasury_ata), before_treasury - 5_000);
}

#[test]
fn deposit_zero_reverts() {
    let mut w = setup();
    let ix = w.deposit_ix(w.payer.pubkey(), 0);
    assert_custom(&w.send(&[ix], &[]).unwrap_err(), ERR_ZERO_AMOUNT);
}

#[test]
fn deposit_blocked_when_paused() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let p = w.admin_ix("pause", None, admin.pubkey());
    w.send(&[p], &[&admin]).unwrap();
    let ix = w.deposit_ix(w.payer.pubkey(), 1_000);
    assert_custom(&w.send(&[ix], &[]).unwrap_err(), ERR_PAUSED);
}

// -------------------------------------------------------------------- withdrawals

#[test]
fn withdraw_happy_path() {
    let mut w = setup();
    let deadline = w.now() + 3 * 86_400;
    let ixs = w.withdraw_ixs(w.player, 250_000, 1, deadline);
    w.send(&ixs, &[]).unwrap();
    assert_eq!(w.token_balance(&ata_for(&w.player, &w.mint)), 250_000);
    assert_eq!(w.state_data().bucket, 250_000);
}

#[test]
fn withdraw_replay_reverts() {
    let mut w = setup();
    let deadline = w.now() + 3 * 86_400;
    let ixs = w.withdraw_ixs(w.player, 100, 7, deadline);
    w.send(&ixs, &[]).unwrap();
    let replay = w.withdraw_ixs(w.player, 100, 7, deadline);
    let err = w.send(&replay, &[]).unwrap_err();
    // nonce PDA already exists -> account-in-use at init
    assert!(
        err.contains("already in use") || err.contains("Custom(0)"),
        "expected nonce-reuse failure, got: {err}"
    );
    assert_eq!(w.token_balance(&ata_for(&w.player, &w.mint)), 100);
}

#[test]
fn withdraw_expired_reverts() {
    let mut w = setup();
    let deadline = w.now() - 1;
    let ixs = w.withdraw_ixs(w.player, 100, 2, deadline);
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_EXPIRED);
}

#[test]
fn withdraw_wrong_signer_reverts() {
    let mut w = setup();
    let deadline = w.now() + 86_400;
    let mallory = SigningKey::from_bytes(&[9u8; 32]);
    let ixs = w.withdraw_ixs_signed_by(&mallory, w.player, 100, 100, 3, deadline);
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_BAD_SIGNATURE);
}

#[test]
fn withdraw_tampered_amount_reverts() {
    let mut w = setup();
    let deadline = w.now() + 86_400;
    let key = w.game_signer.clone();
    // voucher signed for 100, submitted claiming 100_000
    let ixs = w.withdraw_ixs_signed_by(&key, w.player, 100, 100_000, 4, deadline);
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_BAD_SIGNATURE);
}

#[test]
fn withdraw_wrong_chain_id_reverts() {
    let mut w = setup();
    let deadline = w.now() + 86_400;
    // voucher signed for a different cluster: replicate withdraw_ixs with chain_id+1
    let msg = voucher_message(&w.program_id, CHAIN_ID + 1, &w.player, 100, 5, deadline);
    let key = w.game_signer.clone();
    let ed = w.ed25519_ix(&key, &msg);
    let mut ixs = w.withdraw_ixs(w.player, 100, 5, deadline);
    ixs[0] = ed; // valid signature, wrong domain
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_BAD_SIGNATURE);
}

#[test]
fn withdraw_blocked_when_paused() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let p = w.admin_ix("pause", None, admin.pubkey());
    w.send(&[p], &[&admin]).unwrap();
    let deadline = w.now() + 86_400;
    let ixs = w.withdraw_ixs(w.player, 100, 6, deadline);
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_PAUSED);
}

#[test]
fn withdraw_zero_reverts() {
    let mut w = setup();
    let deadline = w.now() + 86_400;
    let ixs = w.withdraw_ixs(w.player, 0, 8, deadline);
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_ZERO_AMOUNT);
}

// ------------------------------------------------------------------- window maths

#[test]
fn window_cap_enforced() {
    let mut w = setup();
    let deadline = w.now() + 30 * 86_400;
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP, 10, deadline), &[])
        .unwrap();
    let err = w
        .send(&w.withdraw_ixs(w.player, 1, 11, deadline), &[])
        .unwrap_err();
    assert_custom(&err, ERR_WINDOW_CAP);
}

#[test]
fn bucket_leaks_linearly() {
    let mut w = setup();
    let deadline = w.now() + 30 * 86_400;
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP, 12, deadline), &[])
        .unwrap();
    w.warp(WINDOW / 2);
    // half the cap has leaked; half fits again, a token more does not
    let err = w
        .send(&w.withdraw_ixs(w.player, WINDOW_CAP / 2 + 1_000, 13, deadline), &[])
        .unwrap_err();
    assert_custom(&err, ERR_WINDOW_CAP);
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP / 2, 14, deadline), &[])
        .unwrap();
}

#[test]
fn full_window_idle_refills_bucket() {
    let mut w = setup();
    let deadline = w.now() + 30 * 86_400;
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP, 15, deadline), &[])
        .unwrap();
    w.warp(WINDOW);
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP, 16, deadline), &[])
        .unwrap();
    assert_eq!(w.token_balance(&ata_for(&w.player, &w.mint)), 2 * WINDOW_CAP);
}

#[test]
fn no_boundary_burst_across_window_edge() {
    let mut w = setup();
    let deadline = w.now() + 30 * 86_400;
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP, 17, deadline), &[])
        .unwrap();
    w.warp(WINDOW - 1);
    let err = w
        .send(&w.withdraw_ixs(w.player, WINDOW_CAP, 18, deadline), &[])
        .unwrap_err();
    assert_custom(&err, ERR_WINDOW_CAP);
}

// --------------------------------------------------------------------------- ops

#[test]
fn set_signer_only_admin() {
    let mut w = setup();
    let rando = Keypair::new();
    w.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    let new_signer = Keypair::new().pubkey();
    let ix = w.admin_ix("set_signer", Some(new_signer.as_ref()), rando.pubkey());
    assert_custom(&w.send(&[ix], &[&rando]).unwrap_err(), ERR_NOT_ADMIN);
}

#[test]
fn set_signer_zero_reverts() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let zero = Pubkey::default();
    let ix = w.admin_ix("set_signer", Some(zero.as_ref()), admin.pubkey());
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_ZERO_ADDRESS);
}

#[test]
fn set_signer_rejects_admin_key() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let admin_pk = admin.pubkey();
    let ix = w.admin_ix("set_signer", Some(admin_pk.as_ref()), admin_pk);
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_SIGNER_EQ_ADMIN);
}

#[test]
fn set_window_cap_only_admin() {
    let mut w = setup();
    let rando = Keypair::new();
    w.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();
    let ix = w.admin_ix("set_window_cap", Some(&5u64.to_le_bytes()), rando.pubkey());
    assert_custom(&w.send(&[ix], &[&rando]).unwrap_err(), ERR_NOT_ADMIN);
}

#[test]
fn set_window_cap_zero_reverts() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let ix = w.admin_ix("set_window_cap", Some(&0u64.to_le_bytes()), admin.pubkey());
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_ZERO_CAP);
}

#[test]
fn set_window_cap_drains_at_old_rate_first() {
    let mut w = setup();
    let deadline = w.now() + 30 * 86_400;
    w.send(&w.withdraw_ixs(w.player, WINDOW_CAP, 20, deadline), &[])
        .unwrap();
    w.warp(WINDOW / 2); // half leaked at OLD rate
    let admin = w.admin.insecure_clone();
    let ix = w.admin_ix(
        "set_window_cap",
        Some(&(WINDOW_CAP * 10).to_le_bytes()),
        admin.pubkey(),
    );
    w.send(&[ix], &[&admin]).unwrap();
    let st = w.state_data();
    assert_eq!(st.window_cap, WINDOW_CAP * 10);
    assert_eq!(st.bucket, WINDOW_CAP / 2, "drained at the old rate, not the new");
}

#[test]
fn initialize_rejects_signer_equals_admin() {
    // fresh world without initialize: build manually
    let mut w = setup_uninitialized();
    let admin = w.admin.insecure_clone();
    let ix = w.initialize_ix(admin.pubkey(), WINDOW_CAP, CHAIN_ID, admin.pubkey());
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_SIGNER_EQ_ADMIN);
}

#[test]
fn initialize_rejects_zero_cap() {
    let mut w = setup_uninitialized();
    let admin = w.admin.insecure_clone();
    let ix = w.initialize_ix(w.signer_pubkey(), 0, CHAIN_ID, admin.pubkey());
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_ZERO_CAP);
}

#[test]
fn admin_cannot_move_funds() {
    // No instruction lets the admin transfer from the escrow: the only outflow is
    // `withdraw`, and the admin holds no valid voucher. Submitting a self-signed
    // voucher fails signature verification; the escrow is untouched.
    let mut w = setup();
    let before = w.token_balance(&w.escrow);
    let deadline = w.now() + 86_400;
    let admin_forged = SigningKey::from_bytes(&[42u8; 32]);
    let admin_wallet = w.admin.pubkey();
    let ixs = w.withdraw_ixs_signed_by(&admin_forged, admin_wallet, before, before, 21, deadline);
    assert_custom(&w.send(&ixs, &[]).unwrap_err(), ERR_BAD_SIGNATURE);
    assert_eq!(w.token_balance(&w.escrow), before);
}

#[test]
fn two_step_admin_transfer() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let new_admin = Keypair::new();
    w.svm.airdrop(&new_admin.pubkey(), 1_000_000_000).unwrap();
    let rando = Keypair::new();
    w.svm.airdrop(&rando.pubkey(), 1_000_000_000).unwrap();

    // propose
    let new_admin_pk = new_admin.pubkey();
    let ix = w.admin_ix("transfer_admin", Some(new_admin_pk.as_ref()), admin.pubkey());
    w.send(&[ix], &[&admin]).unwrap();
    // admin unchanged until accepted
    assert_eq!(w.state_data().admin, admin.pubkey());

    // a non-proposed key cannot accept
    let accept = Instruction {
        program_id: w.program_id,
        accounts: vec![
            AccountMeta::new(w.state, false),
            AccountMeta::new_readonly(rando.pubkey(), true),
        ],
        data: disc("accept_admin").to_vec(),
    };
    assert_custom(&w.send(&[accept], &[&rando]).unwrap_err(), ERR_NOT_PENDING_ADMIN);

    // the proposed key accepts
    let accept = Instruction {
        program_id: w.program_id,
        accounts: vec![
            AccountMeta::new(w.state, false),
            AccountMeta::new_readonly(new_admin.pubkey(), true),
        ],
        data: disc("accept_admin").to_vec(),
    };
    w.send(&[accept], &[&new_admin]).unwrap();
    assert_eq!(w.state_data().admin, new_admin.pubkey());

    // the old admin has lost its powers
    let ix = w.admin_ix("pause", None, admin.pubkey());
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_NOT_ADMIN);
}

#[test]
fn transfer_admin_rejects_zero() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    let zero = Pubkey::default();
    let ix = w.admin_ix("transfer_admin", Some(zero.as_ref()), admin.pubkey());
    assert_custom(&w.send(&[ix], &[&admin]).unwrap_err(), ERR_ZERO_ADDRESS);
}

#[test]
fn unpause_restores_operation() {
    let mut w = setup();
    let admin = w.admin.insecure_clone();
    w.send(&[w.admin_ix("pause", None, admin.pubkey())], &[&admin])
        .unwrap();
    w.send(&[w.admin_ix("unpause", None, admin.pubkey())], &[&admin])
        .unwrap();
    let ix = w.deposit_ix(w.payer.pubkey(), 1_000);
    w.send(&[ix], &[]).unwrap();
}

/// Like `setup` but stops before `initialize` (for initialize-guard tests).
fn setup_uninitialized() -> World {
    let mut svm = LiteSVM::new();
    let program_id = Pubkey::from_str("FFNwC5HX9jzjnNrLiUkJ3y6uovVCGCpms5jo9R2Yn9o1").unwrap();
    svm.add_program_from_file(program_id, "../target/deploy/settlement.so")
        .expect("run `anchor build` first");
    let payer = Keypair::new();
    let admin = Keypair::new();
    let player = Keypair::new().pubkey();
    svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
    svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
    let mint = CreateMint::new(&mut svm, &payer)
        .authority(&payer.pubkey())
        .decimals(DECIMALS)
        .send()
        .unwrap();
    let treasury_ata = CreateAssociatedTokenAccount::new(&mut svm, &payer, &mint)
        .owner(&payer.pubkey())
        .send()
        .unwrap();
    let state = Pubkey::find_program_address(&[b"settlement"], &program_id).0;
    let game_signer = SigningKey::from_bytes(&[7u8; 32]);
    let mut w = World {
        escrow: Pubkey::default(),
        svm,
        program_id,
        payer,
        admin,
        game_signer,
        player,
        mint,
        treasury_ata,
        state,
    };
    w.escrow = ata_for(&state, &mint);
    w
}
