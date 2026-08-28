/**
 * End-to-end proof against a LIVE Settlement deployment on a real Solana cluster
 * (devnet, or a local validator as the rehearsal). Port of the EVM-era
 * e2e-testnet.ts, plus the on-chain guard checks the roadmap's phase-1 exit names:
 *
 *   on-chain deposit → indexer credits the game → withdraw request (every §9 gate) →
 *   vest → claim (server signs the voucher) → FORGERY rejected → redeem on-chain →
 *   REPLAY rejected → PAUSE blocks deposits → indexer confirms → solvency holds.
 *
 * Only the game clock is simulated (vesting is 14 days); every value movement is
 * real, through the same server-built transactions the client relays
 * (prepareDepositTx / prepareRedeemTx).
 *
 *   OUTFOX_RPC_URL=… OUTFOX_CHAIN_ID=… OUTFOX_PROGRAM_ID=… OUTFOX_SIGNER_KEY=… \
 *   GENESIS_PAYER=… GENESIS_ADMIN=… GENESIS_TREASURY=… E2E_PLAYER=… \
 *   npx tsx scripts/e2e-devnet.ts
 */
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
} from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import bs58 from 'bs58';
import { openDb } from '../src/db.js';
import { createPlayer } from '../src/engine.js';
import {
  chainConfigFromEnv, indexOnce, signVoucher, alphaMintFor, reserveFor,
  prepareDepositTx, prepareRedeemTx, ataFor, statePda, TOKEN_PROGRAM, ATA_PROGRAM,
} from '../src/chain.js';
import {
  linkWallet, alphaBalance, unseasonedBalance, requestWithdrawal, prepareClaim,
  recordSignedVoucher, alphaView, solvencyAudit,
} from '../src/settlement.js';
import { ALPHA_BASE_UNITS, VALVE } from '@outfox/shared';

const DAY = 86_400_000;
const cfg = chainConfigFromEnv();
if (!cfg || !cfg.signerSeed) throw new Error('chain env not configured');
const conn = new Connection(cfg.rpcUrl, 'confirmed');

const loadKp = (env: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env[env]!, 'utf8'))));
const PAYER = loadKp('GENESIS_PAYER');
const ADMIN = loadKp('GENESIS_ADMIN');
const TREASURY = loadKp('GENESIS_TREASURY');
const player = loadKp('E2E_PLAYER');

const A = (n: bigint) => n * ALPHA_BASE_UNITS;
const fmt = (w: bigint) => `${(Number(w) / Number(ALPHA_BASE_UNITS)).toFixed(4)} ALPHA`;
const ok = (c: boolean, m: string) => { console.log(`${c ? '  OK  ' : ' FAIL '} ${m}`); if (!c) process.exitCode = 1; };

async function confirm(sig: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const st = await conn.getSignatureStatus(sig);
    if (st.value?.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(st.value.err)}`);
    const c = st.value?.confirmationStatus;
    if (c === 'confirmed' || c === 'finalized') return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`tx ${sig} not confirmed in time`);
}

/** Sign and send a server-built base64 transaction — exactly what the client relays. */
async function sendServerTx(txBase64: string, signers: Keypair[]): Promise<string> {
  const tx = Transaction.from(Buffer.from(txBase64, 'base64'));
  // the server stamps a recent blockhash; re-stamp in case this test paused between build and send
  tx.recentBlockhash = (await conn.getLatestBlockhash('confirmed')).blockhash;
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize());
  await confirm(sig);
  return sig;
}

async function sendIxs(ixs: TransactionInstruction[], feePayer: Keypair, signers: Keypair[]): Promise<string> {
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight: 0 });
  tx.add(...ixs);
  tx.sign(feePayer, ...signers.filter((s) => !s.publicKey.equals(feePayer.publicKey)));
  const sig = await conn.sendRawTransaction(tx.serialize());
  await confirm(sig);
  return sig;
}

async function expectFail(fn: () => Promise<unknown>): Promise<string> {
  try { await fn(); return ''; } catch (e) { return (e as Error).message || 'failed'; }
}

async function tokenBalance(addr: PublicKey): Promise<bigint> {
  const acc = await conn.getAccountInfo(addr);
  if (!acc || acc.data.length < 72) return 0n;
  return Buffer.from(acc.data).readBigUInt64LE(64);
}

function adminIx(name: 'pause' | 'unpause'): TransactionInstruction {
  return new TransactionInstruction({
    programId: cfg!.programId,
    keys: [
      { pubkey: statePda(cfg!), isSigner: false, isWritable: true },
      { pubkey: ADMIN.publicKey, isSigner: true, isWritable: false },
    ],
    data: createHash('sha256').update(`global:${name}`).digest().subarray(0, 8),
  });
}

const MINT = await alphaMintFor(cfg);
const playerAta = ataFor(player.publicKey, MINT);

// fresh in-memory game DB, but a real chain
const db = openDb(':memory:');
const p = createPlayer(db);
linkWallet(db, p, player.publicKey.toBase58());                 // R2
db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(p);  // R3 (PoP stands here)
console.log(`player ${p} linked to ${player.publicKey.toBase58()}, verified (R3)`);

// index from the current head so we only fold OUR events
const head = await conn.getSignaturesForAddress(cfg.programId, { limit: 1 }, 'finalized');
const headSig = head[0]?.signature ?? null;
if (headSig) {
  db.prepare(`INSERT INTO chain_cursor_sig (id, last_sig) VALUES (1, ?)`).run(headSig);
}

// ---- 0. fund the player: fee SOL from the payer, 20 ALPHA from the treasury ------
const DEPOSIT = A(20n);
{
  const bal = await conn.getBalance(player.publicKey);
  if (bal < 50_000_000) {
    await sendIxs([SystemProgram.transfer({
      fromPubkey: PAYER.publicKey, toPubkey: player.publicKey, lamports: 50_000_000,
    })], PAYER, []);
  }
  if (await tokenBalance(playerAta) < DEPOSIT) {
    const createAta = new TransactionInstruction({
      programId: ATA_PROGRAM,
      keys: [
        { pubkey: PAYER.publicKey, isSigner: true, isWritable: true },
        { pubkey: playerAta, isSigner: false, isWritable: true },
        { pubkey: player.publicKey, isSigner: false, isWritable: false },
        { pubkey: MINT, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]), // CreateIdempotent
    });
    const xfer = new TransactionInstruction({
      programId: TOKEN_PROGRAM,
      keys: [
        { pubkey: ataFor(TREASURY.publicKey, MINT), isSigner: false, isWritable: true },
        { pubkey: playerAta, isSigner: false, isWritable: true },
        { pubkey: TREASURY.publicKey, isSigner: true, isWritable: false },
      ],
      data: (() => { const d = Buffer.alloc(9); d.writeUInt8(3, 0); d.writeBigUInt64LE(DEPOSIT, 1); return d; })(),
    });
    await sendIxs([createAta, xfer], PAYER, [TREASURY]);
  }
  console.log(`player funded: ${fmt(await tokenBalance(playerAta))} on-chain + fee SOL\n`);
}

// ---- 1. deposit on-chain through the server-built transaction -------------------
console.log(`1) depositing ${fmt(DEPOSIT)} on-chain (one tx, no approve step)…`);
await sendServerTx(await prepareDepositTx(cfg, player.publicKey, DEPOSIT), [player]);

// ---- 2. the indexer credits the game --------------------------------------------
let credited = 0n;
for (let i = 0; i < 60 && credited === 0n; i++) {
  await indexOnce(db, cfg);
  credited = alphaBalance(db, p);
  if (credited === 0n) await new Promise((r) => setTimeout(r, 2000));
}
ok(credited === DEPOSIT, `indexer credited the game: ${fmt(credited)}`);
ok(unseasonedBalance(db, p) === DEPOSIT, 'the deposit lot is UNSEASONED (§13.C)');

// re-index the same range: must NOT double-credit
if (headSig) db.prepare(`UPDATE chain_cursor_sig SET last_sig = ? WHERE id = 1`).run(headSig);
else db.prepare(`DELETE FROM chain_cursor_sig WHERE id = 1`).run();
await indexOnce(db, cfg);
ok(alphaBalance(db, p) === DEPOSIT, 'replaying the same events does not double-credit (idempotent)');

// ---- 3. withdraw request: the §9 gates ------------------------------------------
const reserve = await reserveFor(cfg);
const GROSS = A(10n);
const wd = requestWithdrawal(db, p, GROSS, reserve);
console.log(`\n3) requested ${fmt(GROSS)} → fee ${fmt(BigInt(wd.feeWei))}, net ${fmt(BigInt(wd.netWei))}`);
ok(BigInt(wd.feeWei) === (GROSS * 4500n) / 10_000n, 'fee = 5% + 40% unseasoned surcharge');
ok(wd.status === 'vesting', 'status is vesting (V4)');
let threw = '';
try { prepareClaim(db, p, wd.id); } catch (e) { threw = (e as Error).message; }
ok(/vest/i.test(threw), 'cannot claim while vesting');

// ---- 4. vest, claim, sign --------------------------------------------------------
const later = Date.now() + (VALVE.vestingDays + 1) * DAY;
const claim = prepareClaim(db, p, wd.id, later);
const sig = await signVoucher(cfg, {
  to: claim.to, amount: claim.amountWei, nonce: claim.nonce, deadline: claim.deadline,
});
recordSignedVoucher(db, wd.id, sig, claim.deadline);
console.log(`4) vested → server signed voucher (nonce ${claim.nonce.toString().slice(0, 12)}…) for ${fmt(claim.amountWei)}`);

// ---- 5. forgery rejected ---------------------------------------------------------
const tampered = (() => { const b = bs58.decode(sig); b[13] ^= 0xff; return bs58.encode(b); })();
const forgeErr = await expectFail(async () => sendServerTx(
  await prepareRedeemTx(cfg, player.publicKey, {
    to: claim.to, amount: claim.amountWei, nonce: claim.nonce,
    deadline: claim.deadline, signature: tampered,
  }), [player]));
ok(forgeErr !== '', `forged voucher signature REJECTED on-chain (${forgeErr.slice(0, 60)}…)`);

// ---- 6. redeem on-chain through the server-built transaction --------------------
const before = await tokenBalance(playerAta);
const redeemTx = await prepareRedeemTx(cfg, player.publicKey, {
  to: claim.to, amount: claim.amountWei, nonce: claim.nonce,
  deadline: claim.deadline, signature: sig,
});
await sendServerTx(redeemTx, [player]);
const after = await tokenBalance(playerAta);
ok(after - before === claim.amountWei, `on-chain payout matches the voucher: +${fmt(after - before)}`);

// ---- 7. replay rejected ----------------------------------------------------------
const replayErr = await expectFail(async () => sendServerTx(await prepareRedeemTx(cfg, player.publicKey, {
  to: claim.to, amount: claim.amountWei, nonce: claim.nonce,
  deadline: claim.deadline, signature: sig,
}), [player]));
ok(replayErr !== '', `replaying the same voucher REJECTED (nonce single-use: ${replayErr.slice(0, 50)}…)`);

// ---- 8. pause blocks the edge ----------------------------------------------------
await sendIxs([adminIx('pause')], PAYER, [ADMIN]);
const pausedErr = await expectFail(async () => sendServerTx(
  await prepareDepositTx(cfg, player.publicKey, A(1n)), [player]));
ok(pausedErr !== '', 'PAUSED: deposit refused on-chain');
await sendIxs([adminIx('unpause')], PAYER, [ADMIN]);
await sendServerTx(await prepareDepositTx(cfg, player.publicKey, A(1n)), [player]);
ok(true, 'unpaused: deposits flow again');

// ---- 9. indexer confirms + solvency ---------------------------------------------
for (let i = 0; i < 60; i++) {
  await indexOnce(db, cfg);
  if (alphaView(db, p, later).withdrawals[0].status === 'confirmed') break;
  await new Promise((r) => setTimeout(r, 2000));
}
const v = alphaView(db, p, later).withdrawals[0];
ok(v.status === 'confirmed', `indexer marked it confirmed (tx ${v.txHash?.slice(0, 12)}…)`);

const audit = solvencyAudit(db, await reserveFor(cfg));
console.log(`\n9) solvency: reserve ${fmt(BigInt(audit.reserveWei))} >= liabilities ${fmt(BigInt(audit.liabilitiesWei))}`);
ok(audit.holds, 'proof of reserves holds (escrow covers every game-side claim)');
console.log(process.exitCode ? '\nFAILED' : '\nALL CHECKS PASSED');
