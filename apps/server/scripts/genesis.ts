/**
 * Genesis — deploy-time setup of the $ALPHA mint and the Settlement state on a REAL
 * cluster (local validator or devnet; mainnet only behind the launch gates).
 *
 *   1. Create the $ALPHA SPL mint (9 decimals), mint the FIXED 2,000,000 supply to
 *      the treasury, then REVOKE the mint authority — the no-mint guarantee.
 *   2. Initialize the settlement state PDA + escrow ATA (admin = cold key, voucher
 *      signer = hot key; the program refuses signer == admin).
 *
 * The program itself must already be deployed (solana program deploy). Idempotence:
 * this script is run ONCE per cluster; a second run fails on the existing state PDA
 * rather than re-minting anything (the mint keypair is fresh each run, so a rerun
 * would otherwise create a second, unofficial mint).
 *
 *   OUTFOX_RPC_URL=…   OUTFOX_CHAIN_ID=0|1|2   OUTFOX_PROGRAM_ID=…
 *   OUTFOX_SIGNER_KEY=<hex/base58 32-byte seed>
 *   GENESIS_PAYER=<deployer keypair.json>  GENESIS_ADMIN=<admin keypair.json>
 *   GENESIS_TREASURY=<treasury keypair.json>
 *   GENESIS_WINDOW_CAP=<whole ALPHA, default 500>
 *   npx tsx scripts/genesis.ts
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ataFor, statePda, voucherSignerPubkey, chainConfigFromEnv,
  TOKEN_PROGRAM, ATA_PROGRAM,
} from '../src/chain.js';
import { ALPHA_BASE_UNITS } from '@outfox/shared';

const cfg = chainConfigFromEnv();
if (!cfg || !cfg.signerSeed) throw new Error('set OUTFOX_RPC_URL / _CHAIN_ID / _PROGRAM_ID / _SIGNER_KEY');

const loadKp = (env: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env[env]!, 'utf8'))));
const PAYER = loadKp('GENESIS_PAYER');
const ADMIN = loadKp('GENESIS_ADMIN');
const TREASURY = loadKp('GENESIS_TREASURY');
const WINDOW_CAP = BigInt(process.env.GENESIS_WINDOW_CAP ?? '500') * ALPHA_BASE_UNITS;

const conn = new Connection(cfg.rpcUrl, 'confirmed');

async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: PAYER.publicKey, blockhash, lastValidBlockHeight: 0 });
  tx.add(...ixs);
  tx.sign(PAYER, ...signers.filter((s) => !s.publicKey.equals(PAYER.publicKey)));
  const sig = await conn.sendRawTransaction(tx.serialize());
  // poll to 'confirmed'; genesis is sequential, each step depends on the last
  for (let i = 0; i < 60; i++) {
    const st = await conn.getSignatureStatus(sig);
    const c = st.value?.confirmationStatus;
    if (st.value?.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.value.err)}`);
    if (c === 'confirmed' || c === 'finalized') return sig;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`tx ${sig} not confirmed in time`);
}

// ----- SPL instruction builders (mirrors the M4 harness; rent from the live RPC) -----

function initMintIx(mint: PublicKey, authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [{ pubkey: mint, isSigner: false, isWritable: true }],
    // InitializeMint2 { decimals: 9, mint_authority, freeze_authority: None }
    data: Buffer.concat([Buffer.from([20, 9]), authority.toBuffer(), Buffer.from([0])]),
  });
}

function createAtaIx(owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: PAYER.publicKey, isSigner: true, isWritable: true },
      { pubkey: ataFor(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]), // CreateIdempotent
  });
}

function mintToIx(mint: PublicKey, dest: PublicKey, authority: PublicKey, amount: bigint): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(7, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function revokeMintIx(mint: PublicKey, authority: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([6, 0, 0]), // SetAuthority { MintTokens, None }
  });
}

// ----- genesis ---------------------------------------------------------------

const STATE = statePda(cfg);
if (await conn.getAccountInfo(STATE)) {
  throw new Error(`settlement state ${STATE.toBase58()} already initialized on this cluster — genesis is once`);
}

console.log(`genesis on ${cfg.rpcUrl} (chain ${cfg.chainId})`);
console.log(`  program   ${cfg.programId.toBase58()}`);
console.log(`  payer     ${PAYER.publicKey.toBase58()}`);
console.log(`  admin     ${ADMIN.publicKey.toBase58()} (cold)`);
console.log(`  signer    ${voucherSignerPubkey(cfg).toBase58()} (hot voucher key)`);
console.log(`  treasury  ${TREASURY.publicKey.toBase58()}`);

// ONE atomic transaction: mint genesis + settlement initialize. Either the whole
// genesis lands or none of it — a partial state (mint without settlement, or a
// half-funded escrow) can never exist on the cluster.
const mintKp = Keypair.generate();
const MINT = mintKp.publicKey;
const ESCROW = ataFor(STATE, MINT);
const rent = await conn.getMinimumBalanceForRentExemption(82);
const initData = Buffer.alloc(8 + 32 + 8 + 8);
createHash('sha256').update('global:initialize').digest().copy(initData, 0, 0, 8);
voucherSignerPubkey(cfg).toBuffer().copy(initData, 8);
initData.writeBigUInt64LE(WINDOW_CAP, 40);
initData.writeBigUInt64LE(BigInt(cfg.chainId), 48);

await send([
  SystemProgram.createAccount({
    fromPubkey: PAYER.publicKey, newAccountPubkey: MINT,
    lamports: rent, space: 82, programId: TOKEN_PROGRAM,
  }),
  initMintIx(MINT, TREASURY.publicKey),
  createAtaIx(TREASURY.publicKey, MINT),
  mintToIx(MINT, ataFor(TREASURY.publicKey, MINT), TREASURY.publicKey, 2_000_000n * ALPHA_BASE_UNITS),
  revokeMintIx(MINT, TREASURY.publicKey),
  // the Initialize context's rent payer is the ADMIN account — top it up in-tx
  SystemProgram.transfer({
    fromPubkey: PAYER.publicKey, toPubkey: ADMIN.publicKey, lamports: 20_000_000,
  }),
  new TransactionInstruction({
    programId: cfg.programId,
    keys: [
      { pubkey: STATE, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: ESCROW, isSigner: false, isWritable: true },
      { pubkey: ADMIN.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: initData,
  }),
], [mintKp, TREASURY, ADMIN]);

console.log(`  minted 2,000,000 $ALPHA to the treasury; mint authority REVOKED`);
console.log(`  settlement initialized (window cap ${WINDOW_CAP / ALPHA_BASE_UNITS} ALPHA)`);
console.log(`\naddresses:`);
console.log(`  ALPHA mint  ${MINT.toBase58()}`);
console.log(`  state PDA   ${STATE.toBase58()}`);
console.log(`  escrow ATA  ${ESCROW.toBase58()}`);
console.log(`\nserver env:`);
console.log(`  OUTFOX_RPC_URL=${cfg.rpcUrl}`);
console.log(`  OUTFOX_CHAIN_ID=${cfg.chainId}`);
console.log(`  OUTFOX_PROGRAM_ID=${cfg.programId.toBase58()}`);
console.log(`  OUTFOX_SIGNER_KEY=<the hot seed used for this genesis>`);
