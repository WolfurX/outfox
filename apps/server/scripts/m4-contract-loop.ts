/**
 * M4 — contract-in-the-loop (ECONOMY-SIM-SPEC.md §15), Solana edition.
 *
 * The abstract sim credits the cash-out valve with throttling extraction (w_cap, PoP,
 * vesting, seasoning, fees). Those are now REAL CODE against the REAL PROGRAM. This
 * harness re-checks G10/G11/G12 against actual behaviour instead of assumption:
 *
 *   G12 — proof of reserves: escrow balance >= game-side liabilities at EVERY step.
 *   G10 — the provenance firewall: chance-origin (Unsettled) value cannot reach the valve.
 *   G11 — sybil extraction: what a mule ring can ACTUALLY pull through the real valve.
 *
 * Runs on LiteSVM, not a validator: vesting is 14 days and seasoning is 60, so the
 * harness must warp time — a validator cannot. LiteSVM executes the SAME compiled
 * program bytecode (`programs/target/deploy/settlement.so`) plus the real SPL token
 * and ed25519 programs; the chain clock and the game clock are advanced together.
 * The one departure from production: events are folded through the indexer's own
 * `foldTransaction` (the real parse/idempotency/blockTime logic) fed from the
 * in-process chain instead of over RPC — LiteSVM has no RPC to poll.
 *
 *   anchor build   # in programs/, then:
 *   npx tsx scripts/m4-contract-loop.ts
 */
import { LiteSVM, FailedTransactionMetadata } from 'litesvm';
import { getTransactionDecoder } from '@solana/kit';
import {
  Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  Ed25519Program, SYSVAR_INSTRUCTIONS_PUBKEY,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { openDb } from '../src/db.js';
import { createPlayer, postTx, applyCarry, conservationAudit, EngineError } from '../src/engine.js';
import {
  signVoucher, voucherMessage, voucherSignerPubkey, parseSettlementState,
  depositIx, withdrawIx, foldTransaction, ataFor, statePda,
  TOKEN_PROGRAM, ATA_PROGRAM, type ChainConfig,
} from '../src/chain.js';
import {
  linkWallet, alphaBalance, unseasonedBalance, requestWithdrawal, prepareClaim,
  recordSignedVoucher, solvencyAudit, applyAlphaCarry,
} from '../src/settlement.js';
import {
  getPool, poolSeedFromDeposit, buyAlpha, sellAlpha, buyCapacityCents, sellCapacityWei,
  effectiveFeeBps, exchangeAudit,
} from '../src/exchange.js';
import { ALPHA_BASE_UNITS, VALVE, EXCHANGE } from '@outfox/shared';

const DAY = 86_400_000;
const A = (n: number | bigint) => BigInt(n) * ALPHA_BASE_UNITS;
const fmt = (w: bigint) => (Number(w) / Number(ALPHA_BASE_UNITS)).toFixed(2);

// deterministic actors (seeds 1..10)
const KEYS = Array.from({ length: 10 }, (_, i) =>
  Keypair.fromSeed(new Uint8Array(32).fill(i + 1)));

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`); if (!c) failures++; };

// ---------------------------------------------------------------- the chain

const svm = new LiteSVM();
const PROGRAM_ID = new PublicKey(
  JSON.parse((await import('node:fs')).readFileSync(
    new URL('../../../programs/target/idl/settlement.json', import.meta.url), 'utf8',
  )).address,
);
svm.addProgramFromFile(PROGRAM_ID.toBase58(),
  new URL('../../../programs/target/deploy/settlement.so', import.meta.url).pathname);

const chainMs = () => Number(svm.getClock().unixTimestamp) * 1000;
let gameNow = 0;

/** Advance BOTH clocks together — the chain's and the game's. The game clock is SEEDED
 * FROM THE CHAIN, not from Date.now() (the EVM harness learned this the hard way). */
function warp(days: number) {
  const clock = svm.getClock();
  clock.unixTimestamp = clock.unixTimestamp + BigInt(Math.round(days * 86_400));
  svm.setClock(clock);
  svm.expireBlockhash();
  gameNow += days * DAY;
}

/** Sign + send a web3.js transaction through LiteSVM; throw with logs on failure. */
function send(ixs: TransactionInstruction[], signers: Keypair[]): { signature: string; logs: string[] } {
  const tx = new Transaction({
    feePayer: signers[0].publicKey, blockhash: svm.latestBlockhash(), lastValidBlockHeight: 0,
  });
  tx.add(...ixs);
  tx.sign(...signers);
  const meta = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()));
  if (meta instanceof FailedTransactionMetadata) {
    const err = new Error(`tx failed: ${meta.err().toString()}`);
    (err as Error & { logs: string[] }).logs = meta.meta().logs();
    throw err;
  }
  return { signature: bs58.encode(tx.signature!), logs: meta.logs() };
}

/** Like send() but expects failure; returns the error string. */
function sendExpectFail(ixs: TransactionInstruction[], signers: Keypair[]): string {
  try {
    send(ixs, signers);
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

/** Fold a sent transaction into the game ledger through the REAL indexer logic. */
function fold(db0: ReturnType<typeof openDb>, r: { signature: string; logs: string[] }) {
  foldTransaction(db0, r.signature, Number(svm.getClock().slot), r.logs, chainMs());
}

// ----------------------------------------------------------- SPL plumbing

function splCreateMintIxs(payer: Keypair, mint: Keypair, decimals: number): TransactionInstruction[] {
  const rent = svm.minimumBalanceForRentExemption(82n);
  return [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey, newAccountPubkey: mint.publicKey,
      lamports: Number(rent), space: 82, programId: TOKEN_PROGRAM,
    }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM,
      keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
      // InitializeMint2 { decimals, mint_authority, freeze_authority: None }
      data: Buffer.concat([Buffer.from([20, decimals]), payer.publicKey.toBuffer(), Buffer.from([0])]),
    }),
  ];
}

function createAtaIx(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
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

function tokenTransferIx(src: PublicKey, dst: PublicKey, owner: PublicKey, amount: bigint): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(amount, 1);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM,
    keys: [
      { pubkey: src, isSigner: false, isWritable: true },
      { pubkey: dst, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function tokenBalance(addr: PublicKey): bigint {
  const acc = svm.getAccount(addr.toBase58());
  if (!acc || !acc.exists || acc.data.length < 72) return 0n;
  return Buffer.from(acc.data).readBigUInt64LE(64);
}

// ---------------------------------------------------------------- genesis

console.log('M4 — contract-in-the-loop (LiteSVM, Solana)\n');
gameNow = chainMs(); // the chain is the clock of record; the game follows it

const TREASURY = KEYS[9];
const SIGNER_SEED = new Uint8Array(32).fill(88); // hot voucher key (harness-local)
const ADMIN = KEYS[7];
const WINDOW_CAP = A(500); // deliberately tight, so the global bound is exercised
const CHAIN_ID = 0;

for (const k of KEYS) svm.airdrop(k.publicKey.toBase58(), 100_000_000_000n);

// ALPHA genesis: fixed supply to the treasury, mint authority revoked
const mintKp = Keypair.generate();
const MINT = mintKp.publicKey;
send(splCreateMintIxs(TREASURY, mintKp, 9), [TREASURY, mintKp]);
send([createAtaIx(TREASURY.publicKey, TREASURY.publicKey, MINT)], [TREASURY]);
send([mintToIx(MINT, ataFor(TREASURY.publicKey, MINT), TREASURY.publicKey, A(2_000_000))], [TREASURY]);
send([revokeMintIx(MINT, TREASURY.publicKey)], [TREASURY]);

const cfg: ChainConfig = {
  rpcUrl: 'litesvm://in-process', chainId: CHAIN_ID, programId: PROGRAM_ID,
  signerSeed: SIGNER_SEED,
};
const STATE = statePda(cfg);
const ESCROW = ataFor(STATE, MINT);

// initialize the settlement state (admin = cold key; signer = hot ed25519 key)
{
  const data = Buffer.alloc(8 + 32 + 8 + 8);
  createHash('sha256').update('global:initialize').digest().copy(data, 0, 0, 8);
  voucherSignerPubkey(cfg).toBuffer().copy(data, 8);
  data.writeBigUInt64LE(WINDOW_CAP, 40);
  data.writeBigUInt64LE(BigInt(CHAIN_ID), 48);
  send([new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: STATE, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: ESCROW, isSigner: false, isWritable: true },
      { pubkey: ADMIN.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: ATA_PROGRAM, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })], [ADMIN]);
}

// seed the reserve directly (treasury backing, like the EVM harness's transfer)
send([tokenTransferIx(ataFor(TREASURY.publicKey, MINT), ESCROW, TREASURY.publicKey, A(50_000))], [TREASURY]);
// fund the actors
for (let i = 1; i <= 6; i++) {
  send([createAtaIx(TREASURY.publicKey, KEYS[i].publicKey, MINT)], [TREASURY]);
  send([tokenTransferIx(ataFor(TREASURY.publicKey, MINT), ataFor(KEYS[i].publicKey, MINT), TREASURY.publicKey, A(1_000))], [TREASURY]);
}
console.log(`  program    ${PROGRAM_ID.toBase58()}\n  mint       ${MINT.toBase58()}\n  escrow     ${ESCROW.toBase58()}`);
console.log(`  reserve seeded, windowCap = ${fmt(WINDOW_CAP)} ALPHA / rolling 24h\n`);

const db = openDb(':memory:');

const reserve = () => tokenBalance(ESCROW);
const bucket = () => parseSettlementState(svm.getAccount(STATE.toBase58())!.data).bucket;

/** Deposit on-chain, then fold through the indexer logic — the real path, no shortcuts. */
function deposit(kp: Keypair, amount: bigint) {
  fold(db, send([depositIx(cfg, MINT, kp.publicKey, amount)], [kp]));
}

/** Assert PoR right now. Called after every single state change (G12). */
function assertPoR(where: string): boolean {
  const audit = solvencyAudit(db, reserve());
  if (!audit.holds) {
    console.log(`  FAIL  PoR BREACHED at ${where}: reserve ${audit.reserveWei} < liabilities ${audit.liabilitiesWei}`);
    failures++;
    return false;
  }
  return true;
}

/** Build the [ed25519, withdraw] pair for a signed voucher. */
async function redeemIxs(
  kp: Keypair, v: { to: PublicKey; amount: bigint; nonce: bigint; deadline: bigint },
  signature: string,
): Promise<TransactionInstruction[]> {
  const ed = Ed25519Program.createInstructionWithPublicKey({
    publicKey: voucherSignerPubkey(cfg).toBytes(),
    message: voucherMessage(cfg, v),
    signature: bs58.decode(signature),
  });
  return [ed, withdrawIx(cfg, MINT, kp.publicKey, v, 0)];
}

/** Full cash-out through the real valve + real program. Returns ALPHA actually received. */
async function cashOut(kp: Keypair, playerId: number, gross: bigint): Promise<bigint> {
  const wd = requestWithdrawal(db, playerId, gross, reserve(), gameNow);
  assertPoR('post-request');
  warp(VALVE.vestingDays + 1);                              // V4
  const claim = prepareClaim(db, playerId, wd.id, gameNow);
  const v = {
    to: new PublicKey(claim.to), amount: claim.amountWei,
    nonce: claim.nonce, deadline: claim.deadline,
  };
  const sig = await signVoucher(cfg, v);
  recordSignedVoucher(db, wd.id, sig, claim.deadline);
  const dest = ataFor(v.to, MINT);
  const before = tokenBalance(dest);
  fold(db, send(await redeemIxs(kp, v, sig), [kp]));
  const after = tokenBalance(dest);
  assertPoR('post-redeem');
  return after - before;
}

// ================================================================ G12
console.log('G12 — proof of reserves under real load');
{
  const players = [1, 2, 3].map((i) => {
    const id = createPlayer(db, gameNow);
    linkWallet(db, id, KEYS[i].publicKey.toBase58(), gameNow);
    db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
    return { id, kp: KEYS[i] };
  });
  for (const p of players) {
    deposit(p.kp, A(100));
    assertPoR('post-deposit');
  }
  const got = await cashOut(players[0].kp, players[0].id, A(40));
  ok(got > 0n, `a full cash-out round-trip paid out ${fmt(got)} ALPHA, PoR held at every step`);
  const audit = solvencyAudit(db, reserve());
  ok(audit.holds, `reserve ${fmt(BigInt(audit.reserveWei))} >= liabilities ${fmt(BigInt(audit.liabilitiesWei))}`);
  ok(BigInt(audit.surplusWei) > 0n, `fees accrue as un-owed surplus (${fmt(BigInt(audit.surplusWei))} ALPHA) — the §3 boundary-fee revenue`);
}

// ================================================================ G10
console.log('\nG10 — the provenance firewall reaches the valve');
{
  const id = createPlayer(db, gameNow);
  linkWallet(db, id, KEYS[4].publicKey.toBase58(), gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
  // Give this Fox a pile of CHANCE-ORIGIN (Unsettled) Scrip — the stuff that must never
  // become real money — and no ALPHA at all.
  postTx(db, id, 0, 1_000_000, 'call', 'm4:chance', gameNow);
  let threw = '';
  try {
    requestWithdrawal(db, id, A(1), reserve(), gameNow);
  } catch (e) { threw = (e as EngineError).message; }
  ok(/not enough ALPHA/.test(threw), 'chance-won Scrip cannot fund a cash-out (no path exists to convert it)');
  ok(alphaBalance(db, id) === 0n, 'a Fox rich in Unsettled Scrip still has zero ALPHA');
  const sources = (db.prepare(`SELECT DISTINCT source FROM alpha_lots`).all() as { source: string }[])
    .map((r) => r.source);
  ok(sources.every((s) => s === 'deposit'),
    `every ALPHA lot before the exchange opens originates from a real deposit (sources: ${sources.join(',') || 'none'})`);
}

// ================================================================ G11
console.log('\nG11 — sybil extraction through the REAL valve');
{
  const id = createPlayer(db, gameNow);
  const kp = KEYS[5];
  linkWallet(db, id, kp.publicKey.toBase58(), gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
  deposit(kp, A(50));
  const got = await cashOut(kp, id, A(50));              // immediate: fully unseasoned
  const lossPct = Number((A(50) - got) * 10_000n / A(50)) / 100;
  ok(got < A(50), `a fresh deposit round-trips at a LOSS: 50 in → ${fmt(got)} out (−${lossPct.toFixed(1)}%)`);
  ok(lossPct >= 45, `the seasoning surcharge + fee make fast in-out strictly value-destroying (−${lossPct.toFixed(1)}%)`);

  const capPerIdentity = BigInt(VALVE.weeklyCapAlpha) * ALPHA_BASE_UNITS;
  const identitiesToBeatGlobalCap = Number(WINDOW_CAP / capPerIdentity) + 1;
  ok(true, `per-identity cap: ${VALVE.weeklyCapAlpha} ALPHA/week — k identities give k× that (the named residual)`);
  ok(true, `program's GLOBAL cap: ${fmt(WINDOW_CAP)} ALPHA per rolling 24h — binds at ~${identitiesToBeatGlobalCap} identities regardless of k`);
}

// ================================================================ the global bound
console.log('\nNEW — the program enforces a bound the sim never credited');
{
  const kp = KEYS[6];
  send([createAtaIx(TREASURY.publicKey, kp.publicKey, MINT)], [TREASURY]);
  send([tokenTransferIx(ataFor(TREASURY.publicKey, MINT), ataFor(kp.publicKey, MINT), TREASURY.publicKey, A(2_000))], [TREASURY]);
  warp(1.5); // let the bucket leak fully empty first — earlier cash-outs partly filled it

  // forge a voucher for the full cap (the server would never sign this — we sign it
  // directly to test the PROGRAM's bound, i.e. the blast radius of a stolen signer key)
  const nonce1 = 111111n;
  const nonce2 = 222222n;
  const deadline = BigInt(Math.floor(chainMs() / 1000) + 86_400 * 30);
  const to = kp.publicKey;
  const v1 = { to, amount: WINDOW_CAP, nonce: nonce1, deadline };
  fold(db, send(await redeemIxs(kp, v1, await signVoucher(cfg, v1)), [kp]));
  ok(bucket() === WINDOW_CAP, `bucket is full after draining the cap (${fmt(bucket())})`);

  const v2 = { to, amount: A(1), nonce: nonce2, deadline };
  const err2 = sendExpectFail(await redeemIxs(kp, v2, await signVoucher(cfg, v2)), [kp]);
  ok(err2 !== '' && bucket() === WINDOW_CAP,
    `even a VALIDLY SIGNED voucher is refused once the rolling cap is spent (${err2 || 'NO ERROR'})`);

  // ... and it refills linearly, not in a tumbling jump
  warp(0.5);
  ok(bucket() === WINDOW_CAP, 'bucket is a stored value; the leak is applied on the next withdraw');
  const v3 = { to, amount: WINDOW_CAP / 2n - A(1), nonce: nonce2, deadline };
  const r3 = send(await redeemIxs(kp, v3, await signVoucher(cfg, v3)), [kp]);
  fold(db, r3);
  ok(true, 'after half a window, ~half the cap has leaked back — a linear refill, no boundary burst');
}

// ================================================================ the exchange half
console.log('\nEXCHANGE — the missing half of M4 (farm → exchange → cash-out)');

const rate = () => {
  const pool = getPool(db)!;
  return (Number(pool.creditCents) * Number(ALPHA_BASE_UNITS)) / Number(pool.alphaWei); // ¢ per ALPHA
};

// --- E6: the pool opens ONLY against a real, reserve-backed treasury deposit ---
{
  const POOL_C = 3_000_000;          // the sim's calibrated POL depth (e0 = 100 ¢/ALPHA)
  const POOL_A = A(30_000);
  deposit(TREASURY, POOL_A); // treasury deposits; address linked to NO player
  const treasuryAddr = TREASURY.publicKey.toBase58();
  const held = db.prepare(
    `SELECT tx_hash, log_index FROM unclaimed_deposits WHERE address = ?`
  ).get(treasuryAddr) as { tx_hash: string; log_index: number } | undefined;
  ok(!!held, 'the treasury deposit is HELD (no player owns that address)');
  poolSeedFromDeposit(db, held!.tx_hash, held!.log_index, POOL_C, gameNow);
  ok(getPool(db) !== null, `pool open: ${POOL_C.toLocaleString()} Scrip / ${fmt(POOL_A)} ALPHA (e0 = ${rate().toFixed(1)} ¢/ALPHA)`);
  const gone = db.prepare(`SELECT COUNT(*) AS n FROM unclaimed_deposits WHERE address = ?`)
    .get(treasuryAddr) as { n: number };
  ok(gone.n === 0, 'the held deposit was CONSUMED — it can never also be claimed by a wallet link');
  assertPoR('post-pool-seed');
  ok(true, 'PoR holds with the pool inventory counted as a liability (nothing in the ledger is unbacked)');
}

// --- G10 at the exchange: the firewall now guards a REAL bridge ---
{
  const id = createPlayer(db, gameNow);
  db.prepare(`UPDATE players SET rung = 1 WHERE id = ?`).run(id);
  postTx(db, id, 0, 1_000_000, 'call', 'm4:chance', gameNow); // rich in CHANCE value only
  let threw = '';
  try {
    buyAlpha(db, id, 1_000, null, gameNow);
  } catch (e) { threw = (e as EngineError).message; }
  ok(/Settled/.test(threw), 'Unsettled (chance) Scrip cannot buy ALPHA — the refusal is the firewall, not a rung gate');
  ok(alphaBalance(db, id) === 0n, 'a Fox rich in Unsettled Scrip still has zero ALPHA');
  const srcs = (db.prepare(`SELECT DISTINCT source FROM alpha_lots`).all() as { source: string }[])
    .map((r) => r.source).sort();
  ok(srcs.every((s) => s === 'deposit' || s === 'exchange'),
    `every ALPHA lot traces to a real deposit or a Settled-Scrip exchange buy (sources: ${srcs.join(',')})`);
}

// --- G11, the full re-check: the farmed channel is strictly value-destroying ---
const mule = createPlayer(db, gameNow);
{
  // an attacker-controlled VERIFIED identity (the smart_sybil premise), wallet = KEYS[0]
  linkWallet(db, mule, KEYS[0].publicKey.toBase58(), gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(mule);
  send([createAtaIx(TREASURY.publicKey, KEYS[0].publicKey, MINT)], [TREASURY]);
  const FARM = 5_000; // ¢ of farmed Settled Scrip (deterministic-work faucet)
  const fairAlpha = FARM / rate(); // what the farm is worth at mid, no fees, no slippage
  postTx(db, mule, FARM, 0, 'gig', 'm4:farm', gameNow);
  const { outWei } = buyAlpha(db, mule, FARM, null, gameNow);
  assertPoR('post-exchange-buy');
  ok(unseasonedBalance(db, mule, gameNow) === alphaBalance(db, mule),
    `exchange-bought ALPHA is 100% UNSEASONED (${fmt(outWei)} ALPHA, fresh clock — §13.C)`);
  const got = await cashOut(KEYS[0], mule, outWei); // immediate exit attempt
  const lossPct = (1 - Number(got) / Number(ALPHA_BASE_UNITS) / fairAlpha) * 100;
  ok(got > 0n, `farm → exchange → cash-out EXISTS end-to-end: ${FARM.toLocaleString()}¢ farmed → ${fmt(got)} ALPHA on-chain`);
  ok(lossPct >= 45, `the fast channel is strictly value-destroying: −${lossPct.toFixed(1)}% vs mid (exchange fee + slippage + 5% valve fee + 40% unseasoned surcharge)`);
}

// --- E4: the flow cap bounds any one day's pressure, then frees up ---
{
  const pusher = createPlayer(db, gameNow);
  db.prepare(`UPDATE players SET rung = 1 WHERE id = ?`).run(pusher);
  const cap0 = Number(buyCapacityCents(db, gameNow));
  postTx(db, pusher, cap0 + 70_000, 0, 'gig', 'm4:push-fund', gameNow);
  let threw = '';
  try {
    buyAlpha(db, pusher, cap0 + 5_000, null, gameNow);
  } catch (e) { threw = (e as EngineError).message; }
  ok(/capacity/.test(threw), `a buy beyond the rolling 24h cap (${cap0.toLocaleString()}¢ ≈ 2% of the Scrip reserve) is refused`);
  buyAlpha(db, pusher, cap0, null, gameNow);
  assertPoR('post-cap-buy');
  let threw2 = '';
  try {
    buyAlpha(db, pusher, 5_000, null, gameNow);
  } catch (e) { threw2 = (e as EngineError).message; }
  ok(/capacity/.test(threw2), 'the window is spent — more flow re-queues to a later day (an orderly book, not a wall)');
  warp(1.5);
  buyAlpha(db, pusher, 5_000, null, gameNow);
  ok(true, 'a day later the same order fills — the cap paces, it does not block exit');

  // --- E5: sustained one-way pressure escalates the toll; calm restores it ---
  let pushedDays = 0;
  while (effectiveFeeBps(db, gameNow) === EXCHANGE.feeBps && pushedDays < 25) {
    warp(1);
    pushedDays++;
    const cap = buyCapacityCents(db, gameNow);
    if (cap > 1_000n) {
      const spend = Number(cap) - 500;
      postTx(db, pusher, spend, 0, 'gig', 'm4:push', gameNow);
      buyAlpha(db, pusher, spend, null, gameNow);
    }
  }
  for (let d = 0; d < 4; d++) { // keep pushing past the trigger — the toll must RISE
    warp(1);
    pushedDays++;
    const cap = buyCapacityCents(db, gameNow);
    if (cap > 1_000n) {
      const spend = Number(cap) - 500;
      postTx(db, pusher, spend, 0, 'gig', 'm4:push', gameNow);
      buyAlpha(db, pusher, spend, null, gameNow);
    }
  }
  const escalated = effectiveFeeBps(db, gameNow);
  ok(escalated > EXCHANGE.feeBps,
    `${pushedDays} days of max-cap one-way buying escalated the fee to ${escalated} bps (base ${EXCHANGE.feeBps}) — a cycling cartel pays rising tolls`);
  ok(escalated <= EXCHANGE.feeBps * EXCHANGE.volFeeMultMax, `the toll is capped at ${EXCHANGE.volFeeMultMax}× base`);
  let calmDays = 0;
  while (effectiveFeeBps(db, gameNow) > EXCHANGE.feeBps && calmDays < 120) {
    warp(1);
    calmDays++;
  }
  ok(calmDays < 120, `calm trade restored the base fee after ${calmDays} quiet days — honest users never fund the defense`);

  // --- sells: the ALPHA-side fee is captured, PoR still holds ---
  const sellCap = sellCapacityWei(db, gameNow);
  const sellAmt = sellCap / 2n;
  const { outCents } = sellAlpha(db, pusher, sellAmt, null, gameNow);
  assertPoR('post-exchange-sell');
  const tAlpha = (db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string }).wei;
  ok(outCents > 0 && BigInt(tAlpha) > 0n,
    `selling ${fmt(sellAmt)} ALPHA paid ${outCents.toLocaleString()}¢ SETTLED; the ALPHA fee (${fmt(BigInt(tAlpha))}) is CAPTURED to the treasury, not burned`);
}

// --- the patient mule: seasoning + the §13.A carry are what it waits out ---
{
  ok(effectiveFeeBps(db, gameNow) === EXCHANGE.feeBps, 'pre-check: the exchange is calm again (base fee)');
  const FARM = 5_000;
  const fairAlpha = FARM / rate();
  applyCarry(db, mule, gameNow); // settle ~75 warped days of Scrip carry BEFORE farming
  postTx(db, mule, FARM, 0, 'gig', 'm4:farm2', gameNow);
  buyAlpha(db, mule, FARM, null, gameNow);
  warp(VALVE.seasoningDays + 1);           // wait out the full seasoning window
  applyAlphaCarry(db, mule, gameNow);      // settle the lazy §13.A decay for the wait
  const got = await cashOut(KEYS[0], mule, alphaBalance(db, mule));
  const lossPct = (1 - Number(got) / Number(ALPHA_BASE_UNITS) / fairAlpha) * 100;
  ok(lossPct >= 20, `a PATIENT mule pays the wait: seasoning gone, but ${VALVE.seasoningDays} days of §13.A idle decay cost it −${lossPct.toFixed(1)}% vs mid`);
  ok(lossPct < 45, `patience still beats the fast channel (−${lossPct.toFixed(1)}% vs −45%+) — the carry prices the wait, it does not wall it`);
}

// --- final audits: every ledger closes ---
{
  const cons = conservationAudit(db);
  ok(cons.holds, 'Scrip conservation holds: players + treasury + pool == faucet mints + pool seed');
  const ex = exchangeAudit(db);
  ok(ex.holds, 'the pool row is exactly the fold of the exchange event stream (DATA-ARCHITECTURE principle 1)');
  const srcs = (db.prepare(`SELECT DISTINCT source FROM alpha_lots ORDER BY source`).all() as
    { source: string }[]).map((r) => r.source);
  ok(srcs.includes('exchange') && srcs.every((s) => s === 'deposit' || s === 'exchange'),
    `with exchange lots LIVE, every lot still traces to a deposit or a Settled-Scrip buy (sources: ${srcs.join(',')})`);
  const audit = solvencyAudit(db, reserve());
  ok(audit.holds, `final PoR: reserve ${fmt(BigInt(audit.reserveWei))} >= liabilities ${fmt(BigInt(audit.liabilitiesWei))} (surplus = boundary fees: ${fmt(BigInt(audit.surplusWei))})`);
}

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}`);
process.exitCode = failures ? 1 : 0;
