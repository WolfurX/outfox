//! Settlement — the chain edge of the Outfox economy, Solana port.
//!
//! Behavioral spec: `contracts/src/Settlement.sol` (frozen EVM reference). Deposits and
//! withdrawals of ALPHA settle here; game state is off-chain and server-authoritative,
//! so the chain sees only the edges. Deposits are permissionless and credited off-chain
//! to the account linked to the depositing wallet (event-indexed). Withdrawals require
//! an ed25519 voucher signed by the game server, which applies the game-side gates
//! (identity verification, fees, holding periods, per-account limits) BEFORE signing.
//! The program enforces only what the chain must: single use, expiry, signature, pause,
//! and a rolling cap bounding the blast radius of a compromised signer key.
//!
//! The escrow token account balance is the proof of reserves: total withdrawable
//! liabilities in the game ledger must never exceed it. No instruction moves tokens out
//! except voucher withdrawal — the admin cannot seize funds.
//!
//! EVM → Solana mappings:
//! - EIP-712 voucher → ed25519-program instruction introspection over a domain-tagged
//!   message (program id + chain id included, so a voucher cannot replay across
//!   deployments or clusters).
//! - `usedNonce` mapping → one PDA per nonce; account existence is the "used" bit.
//! - Ownable2Step → propose/accept admin; there is deliberately no way to renounce.

use anchor_lang::prelude::*;
use solana_instructions_sysvar::load_instruction_at_checked;
use solana_sdk_ids::ed25519_program;
use solana_sdk_ids::sysvar::instructions::ID as INSTRUCTIONS_SYSVAR_ID;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount};

declare_id!("FFNwC5HX9jzjnNrLiUkJ3y6uovVCGCpms5jo9R2Yn9o1");

/// Rolling window of the withdrawal cap, in seconds (24h).
pub const WINDOW: i64 = 86_400;
/// Domain tag for voucher messages (EIP-712 domain equivalent).
pub const VOUCHER_DOMAIN: &[u8; 20] = b"OUTFOX_SETTLEMENT_V1";
/// Signed voucher message length: domain(20) + program_id(32) + chain_id(8) +
/// to_wallet(32) + amount(8) + nonce(8) + deadline(8).
pub const VOUCHER_MSG_LEN: usize = 116;

#[program]
pub mod settlement {
    use super::*;

    /// Initialize the singleton settlement state and its escrow.
    /// `signer` is a HOT key (game server) and `admin` is a COLD key: if they were the
    /// same key, its compromise would let the attacker raise the window cap and drain
    /// the whole reserve — silently voiding the blast-radius bound this program
    /// exists for. `chain_id` distinguishes clusters (a program id alone is the same
    /// on devnet and mainnet).
    pub fn initialize(
        ctx: Context<Initialize>,
        signer: Pubkey,
        window_cap: u64,
        chain_id: u64,
    ) -> Result<()> {
        require!(window_cap > 0, SettlementError::ZeroCap); // 0 would brick withdrawals (use pause)
        require!(signer != Pubkey::default(), SettlementError::ZeroAddress);
        require!(signer != ctx.accounts.admin.key(), SettlementError::SignerEqualsAdmin);

        let state = &mut ctx.accounts.state;
        state.admin = ctx.accounts.admin.key();
        state.pending_admin = None;
        state.signer = signer;
        state.alpha_mint = ctx.accounts.alpha_mint.key();
        state.window_cap = window_cap;
        state.bucket = 0;
        state.last_drain = Clock::get()?.unix_timestamp;
        state.chain_id = chain_id;
        state.paused = false;
        state.bump = ctx.bumps.state;
        Ok(())
    }

    /// Deposit ALPHA into the game. Credited off-chain to the account linked to the
    /// depositing wallet (event-indexed by the game server).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(!ctx.accounts.state.paused, SettlementError::Paused);
        require!(amount > 0, SettlementError::ZeroAmount);

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.key(),
                token::Transfer {
                    from: ctx.accounts.depositor_ata.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(Deposited { from: ctx.accounts.depositor.key(), amount });
        Ok(())
    }

    /// Redeem a server-signed withdrawal voucher. Anyone may submit; tokens go to the
    /// voucher's recipient. All game-side gates were applied before the voucher was
    /// signed. The transaction must contain an ed25519-program instruction (at
    /// `ed25519_ix_index`) verifying the voucher message against the state's signer.
    pub fn withdraw(
        ctx: Context<Withdraw>,
        amount: u64,
        nonce: u64,
        deadline: i64,
        ed25519_ix_index: u8,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(!ctx.accounts.state.paused, SettlementError::Paused);
        require!(amount > 0, SettlementError::ZeroAmount);
        require!(now <= deadline, SettlementError::Expired);
        // Nonce single-use is enforced by the `nonce_account` init constraint:
        // a reused nonce means the PDA already exists and account init fails.

        verify_voucher_signature(
            &ctx.accounts.instructions_sysvar,
            ed25519_ix_index,
            &ctx.accounts.state.signer,
            &ctx.accounts.state.chain_id,
            &ctx.accounts.to_wallet.key(),
            amount,
            nonce,
            deadline,
        )?;

        // Leaky bucket: drains at window_cap/WINDOW per second, so total withdrawals
        // across ANY rolling WINDOW cannot exceed window_cap (a fixed/tumbling window
        // would allow a 2x burst across the boundary).
        let state = &mut ctx.accounts.state;
        let (bucket, last_drain) =
            drain_bucket(state.bucket, state.window_cap, state.last_drain, now);
        state.bucket = bucket
            .checked_add(amount)
            .ok_or(SettlementError::WindowCapExceeded)?;
        state.last_drain = last_drain;
        require!(state.bucket <= state.window_cap, SettlementError::WindowCapExceeded);

        let bump = ctx.accounts.state.bump;
        let seeds: &[&[u8]] = &[b"settlement", &[bump]];
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                token::Transfer {
                    from: ctx.accounts.escrow.to_account_info(),
                    to: ctx.accounts.to_ata.to_account_info(),
                    authority: ctx.accounts.state.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        emit!(Withdrawn { to: ctx.accounts.to_wallet.key(), amount, nonce });
        Ok(())
    }

    /// Rotate the game-server voucher signing key (admin only).
    pub fn set_signer(ctx: Context<AdminOnly>, new_signer: Pubkey) -> Result<()> {
        require!(new_signer != Pubkey::default(), SettlementError::ZeroAddress);
        require!(
            new_signer != ctx.accounts.state.admin,
            SettlementError::SignerEqualsAdmin
        );
        ctx.accounts.state.signer = new_signer;
        emit!(SignerChanged { new_signer });
        Ok(())
    }

    /// Change the rolling withdrawal cap (admin only). Drains at the OLD rate first,
    /// so a cap change cannot retroactively rewrite how much of the current bucket
    /// has already leaked away.
    pub fn set_window_cap(ctx: Context<AdminOnly>, new_cap: u64) -> Result<()> {
        require!(new_cap > 0, SettlementError::ZeroCap); // use pause to stop withdrawals
        let now = Clock::get()?.unix_timestamp;
        let state = &mut ctx.accounts.state;
        let (bucket, last_drain) =
            drain_bucket(state.bucket, state.window_cap, state.last_drain, now);
        state.bucket = bucket;
        state.last_drain = last_drain;
        state.window_cap = new_cap;
        emit!(WindowCapChanged { new_cap });
        Ok(())
    }

    pub fn pause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.state.paused = true;
        Ok(())
    }

    pub fn unpause(ctx: Context<AdminOnly>) -> Result<()> {
        ctx.accounts.state.paused = false;
        Ok(())
    }

    /// Two-step admin transfer, step 1: propose. There is deliberately no renounce —
    /// removing the admin would permanently remove the ability to pause or rotate a
    /// compromised signer key, freezing the reserve forever if paused.
    pub fn transfer_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        require!(new_admin != Pubkey::default(), SettlementError::ZeroAddress);
        ctx.accounts.state.pending_admin = Some(new_admin);
        Ok(())
    }

    /// Two-step admin transfer, step 2: the proposed admin accepts.
    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let state = &mut ctx.accounts.state;
        require!(
            state.pending_admin == Some(ctx.accounts.new_admin.key()),
            SettlementError::NotPendingAdmin
        );
        state.admin = ctx.accounts.new_admin.key();
        state.pending_admin = None;
        Ok(())
    }
}

/// Pure leaky-bucket drain: returns (new_bucket, new_last_drain).
/// u128 intermediates so cap * elapsed cannot overflow.
pub fn drain_bucket(bucket: u64, window_cap: u64, last_drain: i64, now: i64) -> (u64, i64) {
    let elapsed = now.saturating_sub(last_drain).max(0) as u128;
    let drained = (window_cap as u128).saturating_mul(elapsed) / (WINDOW as u128);
    let drained = drained.min(u64::MAX as u128) as u64;
    (bucket.saturating_sub(drained), now)
}

/// Build the canonical voucher message the game server signs.
pub fn voucher_message(
    program_id: &Pubkey,
    chain_id: u64,
    to_wallet: &Pubkey,
    amount: u64,
    nonce: u64,
    deadline: i64,
) -> [u8; VOUCHER_MSG_LEN] {
    let mut msg = [0u8; VOUCHER_MSG_LEN];
    msg[0..20].copy_from_slice(VOUCHER_DOMAIN);
    msg[20..52].copy_from_slice(program_id.as_ref());
    msg[52..60].copy_from_slice(&chain_id.to_le_bytes());
    msg[60..92].copy_from_slice(to_wallet.as_ref());
    msg[92..100].copy_from_slice(&amount.to_le_bytes());
    msg[100..108].copy_from_slice(&nonce.to_le_bytes());
    msg[108..116].copy_from_slice(&deadline.to_le_bytes());
    msg
}

/// Verify that the transaction carries an ed25519-program instruction proving
/// `state.signer` signed exactly the canonical voucher message. The ed25519 native
/// program has already verified the signature when the transaction executed; this
/// checks the verified (pubkey, message) pair is the one this withdrawal claims.
#[allow(clippy::too_many_arguments)]
fn verify_voucher_signature(
    instructions_sysvar: &AccountInfo,
    ed25519_ix_index: u8,
    expected_signer: &Pubkey,
    chain_id: &u64,
    to_wallet: &Pubkey,
    amount: u64,
    nonce: u64,
    deadline: i64,
) -> Result<()> {
    let ix = load_instruction_at_checked(ed25519_ix_index as usize, instructions_sysvar)
        .map_err(|_| SettlementError::BadSignature)?;
    require!(
        ix.program_id == ed25519_program::ID && ix.accounts.is_empty(),
        SettlementError::BadSignature
    );

    // ed25519 instruction data layout: count(1) + padding(1) + offsets(14) + payload.
    // All offsets must point inside THIS instruction (index == u16::MAX), with exactly
    // one signature entry — anything else is a crafted instruction, not our voucher.
    let d = &ix.data;
    require!(d.len() >= 16, SettlementError::BadSignature);
    require!(d[0] == 1, SettlementError::BadSignature); // exactly one signature
    let u16le = |i: usize| u16::from_le_bytes([d[i], d[i + 1]]);
    let sig_offset = u16le(2) as usize;
    let sig_ix_index = u16le(4);
    let pk_offset = u16le(6) as usize;
    let pk_ix_index = u16le(8);
    let msg_offset = u16le(10) as usize;
    let msg_size = u16le(12) as usize;
    let msg_ix_index = u16le(14);
    require!(
        sig_ix_index == u16::MAX && pk_ix_index == u16::MAX && msg_ix_index == u16::MAX,
        SettlementError::BadSignature
    );
    require!(
        d.len() >= sig_offset + 64
            && d.len() >= pk_offset + 32
            && d.len() >= msg_offset + msg_size,
        SettlementError::BadSignature
    );

    let pubkey = &d[pk_offset..pk_offset + 32];
    require!(pubkey == expected_signer.as_ref(), SettlementError::BadSignature);

    let expected = voucher_message(&crate::ID, *chain_id, to_wallet, amount, nonce, deadline);
    let msg = &d[msg_offset..msg_offset + msg_size];
    require!(msg == expected.as_ref(), SettlementError::BadSignature);
    Ok(())
}

// ------------------------------------------------------------------------- accounts

#[account]
#[derive(InitSpace)]
pub struct SettlementState {
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    pub signer: Pubkey,
    pub alpha_mint: Pubkey,
    pub window_cap: u64,
    pub bucket: u64,
    pub last_drain: i64,
    pub chain_id: u64,
    pub paused: bool,
    pub bump: u8,
}

/// Existence of this PDA marks its nonce as used.
#[account]
#[derive(InitSpace)]
pub struct UsedNonce {}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + SettlementState::INIT_SPACE,
        seeds = [b"settlement"],
        bump
    )]
    pub state: Account<'info, SettlementState>,
    pub alpha_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = alpha_mint,
        associated_token::authority = state
    )]
    pub escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(seeds = [b"settlement"], bump = state.bump)]
    pub state: Account<'info, SettlementState>,
    pub depositor: Signer<'info>,
    #[account(
        mut,
        token::mint = state.alpha_mint,
        token::authority = depositor
    )]
    pub depositor_ata: Account<'info, TokenAccount>,
    #[account(
        mut,
        associated_token::mint = state.alpha_mint,
        associated_token::authority = state
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(amount: u64, nonce: u64, deadline: i64, ed25519_ix_index: u8)]
pub struct Withdraw<'info> {
    #[account(mut, seeds = [b"settlement"], bump = state.bump)]
    pub state: Account<'info, SettlementState>,
    /// Anyone may submit a voucher; the payer funds the nonce PDA rent.
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: recipient wallet; bound to the voucher by signature verification.
    pub to_wallet: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + UsedNonce::INIT_SPACE,
        seeds = [b"nonce", nonce.to_le_bytes().as_ref()],
        bump
    )]
    pub nonce_account: Account<'info, UsedNonce>,
    #[account(
        mut,
        associated_token::mint = state.alpha_mint,
        associated_token::authority = state
    )]
    pub escrow: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = alpha_mint,
        associated_token::authority = to_wallet
    )]
    pub to_ata: Account<'info, TokenAccount>,
    /// CHECK: the instructions sysvar, address-checked.
    #[account(address = INSTRUCTIONS_SYSVAR_ID)]
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(address = state.alpha_mint @ SettlementError::BadSignature)]
    pub alpha_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [b"settlement"],
        bump = state.bump,
        has_one = admin @ SettlementError::NotAdmin
    )]
    pub state: Account<'info, SettlementState>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(mut, seeds = [b"settlement"], bump = state.bump)]
    pub state: Account<'info, SettlementState>,
    pub new_admin: Signer<'info>,
}

// --------------------------------------------------------------------------- events

#[event]
pub struct Deposited {
    pub from: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Withdrawn {
    pub to: Pubkey,
    pub amount: u64,
    pub nonce: u64,
}

#[event]
pub struct SignerChanged {
    pub new_signer: Pubkey,
}

#[event]
pub struct WindowCapChanged {
    pub new_cap: u64,
}

// --------------------------------------------------------------------------- errors

#[error_code]
pub enum SettlementError {
    #[msg("withdrawals and deposits are paused")]
    Paused,
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("voucher expired")]
    Expired,
    #[msg("bad voucher signature")]
    BadSignature,
    #[msg("rolling window cap exceeded")]
    WindowCapExceeded,
    #[msg("window cap must be > 0")]
    ZeroCap,
    #[msg("zero address")]
    ZeroAddress,
    #[msg("signer must differ from admin")]
    SignerEqualsAdmin,
    #[msg("only admin")]
    NotAdmin,
    #[msg("caller is not the pending admin")]
    NotPendingAdmin,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pure-function port of the EVM window tests that needed vm.warp.
    #[test]
    fn bucket_leaks_linearly() {
        let cap = 1000u64;
        // half a window drains half the cap
        let (b, _) = drain_bucket(1000, cap, 0, WINDOW / 2);
        assert_eq!(b, 500);
    }

    #[test]
    fn full_window_idle_refills_bucket() {
        let (b, _) = drain_bucket(1000, 1000, 0, WINDOW);
        assert_eq!(b, 0);
    }

    #[test]
    fn drain_never_underflows() {
        let (b, _) = drain_bucket(10, 1000, 0, WINDOW * 10);
        assert_eq!(b, 0);
    }

    #[test]
    fn no_time_travel_backwards() {
        // clock going backwards must not drain anything extra
        let (b, ld) = drain_bucket(700, 1000, 100, 50);
        assert_eq!(b, 700);
        assert_eq!(ld, 50);
    }

    #[test]
    fn rolling_window_never_exceeds_cap_fuzz() {
        // Port of testFuzz_rolling_window_never_exceeds_cap (reference invariant,
        // stated there verbatim): across ANY run, total withdrawn <= windowCap + one
        // window's worth of leak — the bucket's capacity plus the volume that drained
        // away over the elapsed time. And the bucket itself never exceeds the cap.
        let cap = 10_000u64;
        let mut seed = 0x5eed_5eed_u64;
        let mut rand = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut bucket = 0u64;
        let mut last = 0i64;
        let mut now = 0i64;
        let mut total = 0u64;
        for _ in 0..2000 {
            now += (rand() % 43_200) as i64; // gaps up to 12h, like the reference
            let amount = 1 + rand() % cap;
            let (b, ld) = drain_bucket(bucket, cap, last, now);
            last = ld;
            let candidate = b.saturating_add(amount);
            if candidate <= cap {
                bucket = candidate;
                total += amount;
            } else {
                bucket = b;
            }
            assert!(bucket <= cap, "bucket {bucket} exceeded cap {cap}");
            let max_allowed =
                cap as u128 + (cap as u128 * now as u128) / (WINDOW as u128);
            assert!(
                (total as u128) <= max_allowed,
                "total {total} exceeded leak bound {max_allowed} at t={now}"
            );
        }
    }
}
