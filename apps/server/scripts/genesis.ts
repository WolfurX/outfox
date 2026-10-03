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
 *
 * With a launch through Meteora (docs/LAUNCH.md) the mint already exists: scripts/launch.ts
 * created it. Set GENESIS_MINT=<that mint> and GENESIS_LAUNCH_POOL=<the curve pool from
 * launch.json> and step 1 is skipped. The script verifies that the mint is the one that
 * pool launched and that it is the fixed-supply $ALPHA (classic SPL, 9 decimals, no mint
 * authority, no freeze authority, supply at most 2,000,000: with no mint authority the
 * supply can only fall, by holders burning), and only then initializes settlement with
 * it. The treasury key is not needed in that mode. Settlement is never bound to a mint
 * that can still be minted or frozen, or to a look-alike. Run it right after
 * `launch.ts create`, in the same sitting: until settlement is initialized, anyone can
 * initialize this program id first.
 *
 * Either way the script reads the state back and compares it with what it sent. If the
 * state already exists it says whose it is: an initialize by someone else, with their
 * admin or signer, must never be mistaken for ours.
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ataFor, statePda, voucherSignerPubkey, chainConfigFromEnv, parseSettlementState,
  TOKEN_PROGRAM, ATA_PROGRAM,
} from '../src/chain/adapter.js';
import { decodeCurvePool } from '../src/chain/launch.js';
import { ALPHA_BASE_UNITS } from '@outfox/shared';

const cfg = chainConfigFromEnv();
if (!cfg || !cfg.signerSeed) throw new Error('set OUTFOX_RPC_URL / _CHAIN_ID / _PROGRAM_ID / _SIGNER_KEY');

const loadKp = (env: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env[env]!, 'utf8'))));
const PAYER = loadKp('GENESIS_PAYER');
const ADMIN = loadKp('GENESIS_ADMIN');
// set but empty (a shell substitution that came back blank) must never mean "mint a fresh one"
if (process.env.GENESIS_MINT !== undefined && process.env.GENESIS_MINT.trim() === '') {
  throw new Error('GENESIS_MINT is set but empty: unset it to mint a fresh supply, or give the launched mint');
}
const LAUNCHED_MINT = process.env.GENESIS_MINT ? new PublicKey(process.env.GENESIS_MINT) : null;
const TREASURY = LAUNCHED_MINT ? null : loadKp('GENESIS_TREASURY');
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

/** What must be true of the settlement state for it to be this genesis. */
function sameAsOurs(data: Uint8Array, mint: PublicKey | null): string[] {
  const st = parseSettlementState(data);
  const diff: string[] = [];
  if (!st.admin.equals(ADMIN.publicKey)) diff.push(`admin is ${st.admin.toBase58()}`);
  if (!st.signer.equals(voucherSignerPubkey(cfg!))) diff.push(`voucher signer is ${st.signer.toBase58()}`);
  if (mint && !st.alphaMint.equals(mint)) diff.push(`mint is ${st.alphaMint.toBase58()}`);
  if (st.chainId !== BigInt(cfg!.chainId)) diff.push(`chain id is ${st.chainId}`);
  return diff;
}

// A state account owned by the program is an initialized settlement. Lamports sent to
// the address by anyone do not make it one (the program can still `init` it).
const existing = await conn.getAccountInfo(STATE);
if (existing?.owner.equals(cfg.programId)) {
  const diff = sameAsOurs(existing.data, LAUNCHED_MINT);
  throw new Error(diff.length
    ? `settlement state ${STATE.toBase58()} was initialized by SOMEONE ELSE (${diff.join('; ')}). Do not run the game on this program id.`
    : `settlement state ${STATE.toBase58()} is already initialized with this admin and signer${LAUNCHED_MINT ? ' and this mint' : ''}: genesis is once`);
}

console.log(`genesis on ${cfg.rpcUrl} (chain ${cfg.chainId})`);
console.log(`  program   ${cfg.programId.toBase58()}`);
console.log(`  payer     ${PAYER.publicKey.toBase58()}`);
console.log(`  admin     ${ADMIN.publicKey.toBase58()} (cold)`);
console.log(`  signer    ${voucherSignerPubkey(cfg).toBase58()} (hot voucher key)`);
console.log(TREASURY ? `  treasury  ${TREASURY.publicKey.toBase58()}` : `  mint      ${LAUNCHED_MINT!.toBase58()} (already launched)`);

const SUPPLY = 2_000_000n * ALPHA_BASE_UNITS;

/** The launched mint must already be everything genesis would have made it. Fail closed. */
async function requireFixedSupplyMint(mint: PublicKey): Promise<void> {
  const acc = await conn.getAccountInfo(mint);
  if (!acc) throw new Error(`GENESIS_MINT ${mint.toBase58()} does not exist on this cluster`);
  if (!acc.owner.equals(TOKEN_PROGRAM) || acc.data.length !== 82) throw new Error('GENESIS_MINT is not a classic SPL Token mint');
  // SPL Mint: mint_authority COption(4+32) · supply u64 · decimals u8 · is_initialized u8 · freeze_authority COption(4+32)
  const d = acc.data;
  const problems: string[] = [];
  if (d.readUInt32LE(0) !== 0) problems.push(`it still has a mint authority (${new PublicKey(d.subarray(4, 36)).toBase58()})`);
  // at most, not exactly: any holder can burn, and one burned unit must not strand the game
  const supply = d.readBigUInt64LE(36);
  if (supply > SUPPLY || supply === 0n) problems.push(`its supply is ${supply} base units; the fixed supply is ${SUPPLY}`);
  if (d[44] !== 9) problems.push(`it has ${d[44]} decimals, not 9`);
  if (d[45] !== 1) problems.push('it is not initialized');
  if (d.readUInt32LE(46) !== 0) problems.push('it has a freeze authority');
  if (problems.length) throw new Error(`GENESIS_MINT is not the fixed-supply $ALPHA: ${problems.join('; ')}`);

  // ...and it must be the mint OUR launch created, not any mint of the same shape
  const poolArg = process.env.GENESIS_LAUNCH_POOL;
  if (!poolArg) throw new Error('set GENESIS_LAUNCH_POOL to the launch curve pool (`pool` in launch.json)');
  const pool = decodeCurvePool(await conn.getAccountInfo(new PublicKey(poolArg)));
  if (!pool.baseMint.equals(mint)) {
    throw new Error(`GENESIS_MINT is not the mint launched by ${poolArg} (that pool launched ${pool.baseMint.toBase58()})`);
  }
}

const mintKp = LAUNCHED_MINT ? null : Keypair.generate();
const MINT = LAUNCHED_MINT ?? mintKp!.publicKey;
const ESCROW = ataFor(STATE, MINT);
const initData = Buffer.alloc(8 + 32 + 8 + 8);
createHash('sha256').update('global:initialize').digest().copy(initData, 0, 0, 8);
voucherSignerPubkey(cfg).toBuffer().copy(initData, 8);
initData.writeBigUInt64LE(WINDOW_CAP, 40);
initData.writeBigUInt64LE(BigInt(cfg.chainId), 48);
const initialize = [
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
];

if (LAUNCHED_MINT) {
  await requireFixedSupplyMint(LAUNCHED_MINT);
  await send(initialize, [ADMIN]);
  console.log(`  the launched mint is the fixed-supply $ALPHA (no mint or freeze authority) from the named launch pool`);
} else {
  // ONE atomic transaction: mint genesis + settlement initialize. Either the whole
  // genesis lands or none of it — a partial state (mint without settlement, or a
  // half-funded escrow) can never exist on the cluster.
  const rent = await conn.getMinimumBalanceForRentExemption(82);
  await send([
    SystemProgram.createAccount({
      fromPubkey: PAYER.publicKey, newAccountPubkey: MINT,
      lamports: rent, space: 82, programId: TOKEN_PROGRAM,
    }),
    initMintIx(MINT, TREASURY!.publicKey),
    createAtaIx(TREASURY!.publicKey, MINT),
    mintToIx(MINT, ataFor(TREASURY!.publicKey, MINT), TREASURY!.publicKey, SUPPLY),
    revokeMintIx(MINT, TREASURY!.publicKey),
    ...initialize,
  ], [mintKp!, TREASURY!, ADMIN]);
  console.log(`  minted 2,000,000 $ALPHA to the treasury; mint authority REVOKED`);
}
// read it back: what is on chain must be what this run sent
const after = await conn.getAccountInfo(STATE);
const diff = after?.owner.equals(cfg.programId) ? sameAsOurs(after.data, MINT) : ['the state account does not exist'];
if (diff.length) throw new Error(`settlement state does not match this genesis: ${diff.join('; ')}`);
console.log(`  settlement initialized (window cap ${WINDOW_CAP / ALPHA_BASE_UNITS} ALPHA); state read back and matches`);
console.log(`\naddresses:`);
console.log(`  ALPHA mint  ${MINT.toBase58()}`);
console.log(`  state PDA   ${STATE.toBase58()}`);
console.log(`  escrow ATA  ${ESCROW.toBase58()}`);
console.log(`\nserver env:`);
console.log(`  OUTFOX_RPC_URL=${cfg.rpcUrl}`);
console.log(`  OUTFOX_CHAIN_ID=${cfg.chainId}`);
console.log(`  OUTFOX_PROGRAM_ID=${cfg.programId.toBase58()}`);
console.log(`  OUTFOX_SIGNER_KEY=<the hot seed used for this genesis>`);
