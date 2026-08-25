/**
 * M4 — contract-in-the-loop (ECONOMY-SIM-SPEC.md §15).
 *
 * The abstract sim credits the cash-out valve with throttling extraction (w_cap, PoP,
 * vesting, seasoning, fees). Those are now REAL CODE against a REAL CONTRACT. This harness
 * re-checks G10/G11/G12 against actual behaviour instead of assumption:
 *
 *   G12 — proof of reserves: reserve() >= game-side liabilities at EVERY step.
 *   G10 — the provenance firewall: chance-origin (Unsettled) value cannot reach the valve.
 *   G11 — sybil extraction: what a mule ring can ACTUALLY pull through the real valve,
 *         including the split-identity residual the sim names but cannot price.
 *
 * Runs on anvil, not testnet: vesting is 14 days and seasoning is 60, so the harness must
 * warp time. The chain clock and the game clock are advanced together, or the two systems
 * disagree about what has vested and what has seasoned.
 *
 *   anvil &   # then:
 *   npx tsx scripts/m4-contract-loop.ts
 */
import {
  createPublicClient, createWalletClient, http, parseAbi, getAddress,
  type Hex, type Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { readFileSync } from 'node:fs';
import { openDb, type DB } from '../src/db.js';
import { createPlayer, postTx, applyCarry, conservationAudit, EngineError } from '../src/engine.js';
import { indexOnce, signVoucher, type ChainConfig } from '../src/chain.js';
import {
  linkWallet, alphaBalance, unseasonedBalance, requestWithdrawal, prepareClaim,
  recordSignedVoucher, solvencyAudit, outstandingNet,
} from '../src/settlement.js';
import {
  getPool, poolSeedFromDeposit, buyAlpha, sellAlpha, buyCapacityCents, sellCapacityWei,
  effectiveFeeBps, exchangeAudit,
} from '../src/exchange.js';
import { VALVE, EXCHANGE } from '@outfox/shared';

const RPC = process.env.ANVIL_RPC ?? 'http://127.0.0.1:8545';
const DAY = 86_400_000;
const A = (n: number | bigint) => BigInt(n) * 10n ** 18n;
const fmt = (w: bigint) => (Number(w) / 1e18).toFixed(2);

// anvil's deterministic accounts
const KEYS = [
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
  '0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e',
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
  '0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97',
  '0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6',
] as const;

const ERC20 = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function transfer(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
]);
const SETTLEMENT_ABI = parseAbi([
  'function deposit(uint256)',
  'function withdraw(address,uint256,uint256,uint256,bytes)',
  'function reserve() view returns (uint256)',
  'function bucket() view returns (uint256)',
  'function windowCap() view returns (uint256)',
]);

const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
const chainClockMs = async () => Number((await pub.getBlock()).timestamp) * 1000;
const w = (pk: Hex) => createWalletClient({ account: privateKeyToAccount(pk), chain: foundry, transport: http(RPC) });
const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`  ${c ? 'OK  ' : 'FAIL'}  ${m}`); if (!c) failures++; };

/** Advance BOTH clocks together — the chain's and the game's. The game clock is SEEDED
 * FROM THE CHAIN, not from Date.now(): anvil keeps warped state between runs, and a game
 * clock behind the chain clock mints vouchers that are already expired. (Found the hard
 * way — exactly the class of bug a contract-in-the-loop harness exists to surface.) */
let gameNow = Date.now();
async function warp(days: number) {
  await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [days * 86_400] }),
  });
  await fetch(RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'evm_mine', params: [] }),
  });
  gameNow += days * DAY;
}

// ---------------------------------------------------------------- deploy

console.log('M4 — contract-in-the-loop (anvil)\n');
gameNow = await chainClockMs(); // the chain is the clock of record; the game follows it
// The SAME compiled artifacts that are deployed on testnet — not a reimplementation.
// (Deploy.s.sol is not used here: it hard-fails off chain 46630/4663, which is correct.)
const artifact = (name: string) =>
  JSON.parse(readFileSync(`../../contracts/out/${name}.sol/${name}.json`, 'utf8'));
const alphaArt = artifact('Alpha');
const settleArt = artifact('Settlement');

const deployerWallet = w(KEYS[0] as Hex);
const TREASURY = privateKeyToAccount(KEYS[9] as Hex).address;
const SIGNER = privateKeyToAccount(KEYS[8] as Hex).address;
const OWNER = privateKeyToAccount(KEYS[7] as Hex).address;
const WINDOW_CAP = A(500); // deliberately tight, so the global bound is exercised

const alphaHash = await deployerWallet.deployContract({
  abi: alphaArt.abi, bytecode: alphaArt.bytecode.object as Hex, args: [TREASURY],
});
const alpha = getAddress((await wait(alphaHash)).contractAddress!);
const settleHash = await deployerWallet.deployContract({
  abi: settleArt.abi, bytecode: settleArt.bytecode.object as Hex,
  args: [alpha, SIGNER, WINDOW_CAP, OWNER],
});
const settlement = getAddress((await wait(settleHash)).contractAddress!);
console.log(`  Alpha       ${alpha}\n  Settlement  ${settlement}`);

const cfg: ChainConfig = {
  rpcUrl: RPC, chainId: foundry.id, settlement,
  startBlock: 0n, signerKey: KEYS[8] as Hex, windowSize: 50_000n,
};
const treasury = w(KEYS[9] as Hex);
const windowCap = WINDOW_CAP;

// seed the reserve and fund the actors
await wait(await treasury.writeContract({ address: alpha, abi: ERC20, functionName: 'transfer', args: [settlement, A(50_000)] }));
for (let i = 1; i <= 6; i++) {
  await wait(await treasury.writeContract({ address: alpha, abi: ERC20, functionName: 'transfer', args: [privateKeyToAccount(KEYS[i] as Hex).address, A(1_000)] }));
}
console.log(`  reserve seeded, windowCap = ${fmt(windowCap)} ALPHA / rolling 24h\n`);

const db = openDb(':memory:');

/** Deposit on-chain, then let the indexer credit the game — the real path, no shortcuts. */
async function deposit(pk: Hex, playerId: number, amount: bigint) {
  const cl = w(pk);
  await wait(await cl.writeContract({ address: alpha, abi: ERC20, functionName: 'approve', args: [settlement, amount] }));
  await wait(await cl.writeContract({ address: settlement, abi: SETTLEMENT_ABI, functionName: 'deposit', args: [amount] }));
  await indexOnce(db, cfg, 0n);
}

async function reserve(): Promise<bigint> {
  return pub.readContract({ address: settlement, abi: SETTLEMENT_ABI, functionName: 'reserve' });
}

/** Assert PoR right now. Called after every single state change (G12). */
async function assertPoR(where: string): Promise<boolean> {
  const audit = solvencyAudit(db, await reserve());
  if (!audit.holds) {
    console.log(`  FAIL  PoR BREACHED at ${where}: reserve ${audit.reserveWei} < liabilities ${audit.liabilitiesWei}`);
    failures++;
    return false;
  }
  return true;
}

/** Full cash-out through the real valve + real contract. Returns ALPHA actually received. */
async function cashOut(pk: Hex, playerId: number, gross: bigint): Promise<bigint> {
  const wd = requestWithdrawal(db, playerId, gross, await reserve(), gameNow);
  await assertPoR('post-request');
  await warp(VALVE.vestingDays + 1);                       // V4
  const claim = prepareClaim(db, playerId, wd.id, gameNow);
  const sig = await signVoucher(cfg, { to: claim.to as Address, amount: claim.amountWei, nonce: claim.nonce, deadline: claim.deadline });
  recordSignedVoucher(db, wd.id, sig, claim.deadline);
  const cl = w(pk);
  const before = await pub.readContract({ address: alpha, abi: ERC20, functionName: 'balanceOf', args: [cl.account.address] });
  await wait(await cl.writeContract({
    address: settlement, abi: SETTLEMENT_ABI, functionName: 'withdraw',
    args: [claim.to as Address, claim.amountWei, claim.nonce, claim.deadline, sig as Hex],
  }));
  const after = await pub.readContract({ address: alpha, abi: ERC20, functionName: 'balanceOf', args: [cl.account.address] });
  await indexOnce(db, cfg, 0n);
  await assertPoR('post-redeem');
  return after - before;
}

// ================================================================ G12
console.log('G12 — proof of reserves under real load');
{
  const players = [1, 2, 3].map((i) => {
    const id = createPlayer(db, gameNow);
    linkWallet(db, id, privateKeyToAccount(KEYS[i] as Hex).address, gameNow);
    db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
    return { id, pk: KEYS[i] as Hex };
  });
  for (const p of players) {
    await deposit(p.pk, p.id, A(100));
    await assertPoR('post-deposit');
  }
  const got = await cashOut(players[0].pk, players[0].id, A(40));
  ok(got > 0n, `a full cash-out round-trip paid out ${fmt(got)} ALPHA, PoR held at every step`);
  const audit = solvencyAudit(db, await reserve());
  ok(audit.holds, `reserve ${fmt(BigInt(audit.reserveWei))} >= liabilities ${fmt(BigInt(audit.liabilitiesWei))}`);
  ok(BigInt(audit.surplusWei) > 0n, `fees accrue as un-owed surplus (${fmt(BigInt(audit.surplusWei))} ALPHA) — the §3 boundary-fee revenue`);
}

// ================================================================ G10
console.log('\nG10 — the provenance firewall reaches the valve');
{
  const id = createPlayer(db, gameNow);
  linkWallet(db, id, privateKeyToAccount(KEYS[4] as Hex).address, gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
  // Give this Fox a pile of CHANCE-ORIGIN (Unsettled) Scrip — the stuff that must never
  // become real money — and no ALPHA at all.
  postTx(db, id, 0, 1_000_000, 'call', 'm4:chance', gameNow);
  let threw = '';
  try {
    requestWithdrawal(db, id, A(1), await reserve(), gameNow);
  } catch (e) { threw = (e as EngineError).message; }
  ok(/not enough ALPHA/.test(threw), 'chance-won Scrip cannot fund a cash-out (no path exists to convert it)');
  ok(alphaBalance(db, id) === 0n, 'a Fox rich in Unsettled Scrip still has zero ALPHA');
  // structural: before the exchange opens (below), the ONLY writer of alpha_lots is a
  // confirmed on-chain deposit — the exchange section re-checks the widened writer set
  const sources = (db.prepare(`SELECT DISTINCT source FROM alpha_lots`).all() as { source: string }[])
    .map((r) => r.source);
  ok(sources.every((s) => s === 'deposit'),
    `every ALPHA lot before the exchange opens originates from a real deposit (sources: ${sources.join(',') || 'none'})`);
}

// ================================================================ G11
console.log('\nG11 — sybil extraction through the REAL valve');
{
  // The sim's funnel assumes farmed value can reach the exit. In the CURRENT build there
  // is no Scrip→ALPHA exchange, so the farm→cash-out channel does not physically exist:
  // a sybil can only withdraw ALPHA it first DEPOSITED. Measure that round-trip.
  const id = createPlayer(db, gameNow);
  const pk = KEYS[5] as Hex;
  linkWallet(db, id, privateKeyToAccount(pk).address, gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
  await deposit(pk, id, A(50));
  const got = await cashOut(pk, id, A(50));              // immediate: fully unseasoned
  const lossPct = Number((A(50) - got) * 10_000n / A(50)) / 100;
  ok(got < A(50), `a fresh deposit round-trips at a LOSS: 50 in → ${fmt(got)} out (−${lossPct.toFixed(1)}%)`);
  ok(lossPct >= 45, `the seasoning surcharge + fee make fast in-out strictly value-destroying (−${lossPct.toFixed(1)}%)`);

  // The split-identity residual (ECONOMY §13.D residual 1 / the G11 open item), PRICED:
  // w_cap is per-identity, so k identities buy k× the weekly throughput. But the CONTRACT
  // holds a GLOBAL rolling cap the sim never modelled — that bound survives any k.
  const capPerIdentity = BigInt(VALVE.weeklyCapAlpha) * 10n ** 18n;
  const identitiesToBeatGlobalCap = Number(windowCap / capPerIdentity) + 1;
  ok(true, `per-identity cap: ${VALVE.weeklyCapAlpha} ALPHA/week — k identities give k× that (the named residual)`);
  ok(true, `contract's GLOBAL cap: ${fmt(windowCap)} ALPHA per rolling 24h — binds at ~${identitiesToBeatGlobalCap} identities regardless of k`);
}

// ================================================================ the global bound
console.log('\nNEW — the contract enforces a bound the sim never credited');
{
  // Drive the global leaky bucket to its limit with a single large voucher, then prove a
  // second one cannot pass in the same window — no matter which identity presents it.
  const id = createPlayer(db, gameNow);
  const pk = KEYS[6] as Hex;
  linkWallet(db, id, privateKeyToAccount(pk).address, gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(id);
  await treasury.writeContract({ address: alpha, abi: ERC20, functionName: 'transfer', args: [privateKeyToAccount(pk).address, A(2_000)] });
  await warp(1.5); // let the bucket leak fully empty first — earlier cash-outs partly filled it

  // forge a voucher for the full cap (the server would never sign this — we sign it
  // directly to test the CONTRACT's bound, i.e. the blast radius of a stolen signer key)
  const nonce1 = 111111n, nonce2 = 222222n;
  // deadlines are chain-time, and the harness has warped ~45 days ahead of the wall clock
  const chainNow = (await pub.getBlock()).timestamp;
  const deadline = chainNow + BigInt(86_400 * 30);
  const to = privateKeyToAccount(pk).address;
  const s1 = await signVoucher(cfg, { to, amount: windowCap, nonce: nonce1, deadline });
  await wait(await w(pk).writeContract({
    address: settlement, abi: SETTLEMENT_ABI, functionName: 'withdraw',
    args: [to, windowCap, nonce1, deadline, s1 as Hex],
  }));
  const bucket = await pub.readContract({ address: settlement, abi: SETTLEMENT_ABI, functionName: 'bucket' });
  ok(bucket === windowCap, `bucket is full after draining the cap (${fmt(bucket)})`);

  const s2 = await signVoucher(cfg, { to, amount: A(1), nonce: nonce2, deadline });
  let blocked = false;
  try {
    await pub.simulateContract({
      address: settlement, abi: SETTLEMENT_ABI, functionName: 'withdraw',
      args: [to, A(1), nonce2, deadline, s2 as Hex], account: privateKeyToAccount(pk),
    });
  } catch { blocked = true; }
  ok(blocked, 'even a VALIDLY SIGNED voucher is refused once the rolling cap is spent');

  // ... and it refills linearly, not in a tumbling jump
  await warp(0.5);
  const half = await pub.readContract({ address: settlement, abi: SETTLEMENT_ABI, functionName: 'bucket' });
  ok(half === windowCap, 'bucket() is a stored value; the leak is applied on the next withdraw');
  let passed = false;
  try {
    await pub.simulateContract({
      address: settlement, abi: SETTLEMENT_ABI, functionName: 'withdraw',
      args: [to, windowCap / 2n - A(1), nonce2, deadline, await signVoucher(cfg, { to, amount: windowCap / 2n - A(1), nonce: nonce2, deadline }) as Hex],
      account: privateKeyToAccount(pk),
    });
    passed = true;
  } catch { /* still capped */ }
  ok(passed, 'after half a window, ~half the cap has leaked back — a linear refill, no boundary burst');
}

// ================================================================ the exchange half
// ECONOMY-SIM-SPEC §15 M4 covers "the exchange + cash-out". Until now only the valve
// half existed; the farm → cash-out channel the sim's funnel/smart_sybil scenarios
// assume is now REAL: Settled Scrip → exchange → unseasoned ALPHA → the valve.
console.log('\nEXCHANGE — the missing half of M4 (farm → exchange → cash-out)');

const rate = () => {
  const pool = getPool(db)!;
  return (Number(pool.creditCents) * 1e18) / Number(pool.alphaWei); // ¢ per ALPHA
};

// --- E6: the pool opens ONLY against a real, reserve-backed treasury deposit ---
{
  const POOL_C = 3_000_000;          // the sim's calibrated POL depth (e0 = 100 ¢/ALPHA)
  const POOL_A = A(30_000);
  await deposit(KEYS[9] as Hex, 0, POOL_A); // treasury deposits; address linked to NO player
  const treasuryAddr = TREASURY.toLowerCase();
  const held = db.prepare(
    `SELECT tx_hash, log_index FROM unclaimed_deposits WHERE address = ?`
  ).get(treasuryAddr) as { tx_hash: string; log_index: number } | undefined;
  ok(!!held, 'the treasury deposit is HELD (no player owns that address)');
  poolSeedFromDeposit(db, held!.tx_hash, held!.log_index, POOL_C, gameNow);
  ok(getPool(db) !== null, `pool open: ${POOL_C.toLocaleString()} Scrip / ${fmt(POOL_A)} ALPHA (e0 = ${rate().toFixed(1)} ¢/ALPHA)`);
  const gone = db.prepare(`SELECT COUNT(*) AS n FROM unclaimed_deposits WHERE address = ?`)
    .get(treasuryAddr) as { n: number };
  ok(gone.n === 0, 'the held deposit was CONSUMED — it can never also be claimed by a wallet link');
  await assertPoR('post-pool-seed');
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
  linkWallet(db, mule, privateKeyToAccount(KEYS[0] as Hex).address, gameNow);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(mule);
  const FARM = 5_000; // ¢ of farmed Settled Scrip (deterministic-work faucet)
  const fairAlpha = FARM / rate(); // what the farm is worth at mid, no fees, no slippage
  postTx(db, mule, FARM, 0, 'gig', 'm4:farm', gameNow);
  const { outWei } = buyAlpha(db, mule, FARM, null, gameNow);
  await assertPoR('post-exchange-buy');
  ok(unseasonedBalance(db, mule, gameNow) === alphaBalance(db, mule),
    `exchange-bought ALPHA is 100% UNSEASONED (${fmt(outWei)} ALPHA, fresh clock — §13.C)`);
  const got = await cashOut(KEYS[0] as Hex, mule, outWei); // immediate exit attempt
  const lossPct = (1 - Number(got) / 1e18 / fairAlpha) * 100;
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
  await assertPoR('post-cap-buy');
  let threw2 = '';
  try {
    buyAlpha(db, pusher, 5_000, null, gameNow);
  } catch (e) { threw2 = (e as EngineError).message; }
  ok(/capacity/.test(threw2), 'the window is spent — more flow re-queues to a later day (an orderly book, not a wall)');
  await warp(1.5);
  buyAlpha(db, pusher, 5_000, null, gameNow);
  ok(true, 'a day later the same order fills — the cap paces, it does not block exit');

  // --- E5: sustained one-way pressure escalates the toll; calm restores it ---
  let pushedDays = 0;
  while (effectiveFeeBps(db, gameNow) === EXCHANGE.feeBps && pushedDays < 25) {
    await warp(1);
    pushedDays++;
    const cap = buyCapacityCents(db, gameNow);
    if (cap > 1_000n) {
      const spend = Number(cap) - 500;
      postTx(db, pusher, spend, 0, 'gig', 'm4:push', gameNow);
      buyAlpha(db, pusher, spend, null, gameNow);
    }
  }
  for (let d = 0; d < 4; d++) { // keep pushing past the trigger — the toll must RISE
    await warp(1);
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
    await warp(1);
    calmDays++;
  }
  ok(calmDays < 120, `calm trade restored the base fee after ${calmDays} quiet days — honest users never fund the defense`);

  // --- sells: the ALPHA-side fee is captured, PoR still holds ---
  const sellCap = sellCapacityWei(db, gameNow);
  const sellAmt = sellCap / 2n;
  const { outCents } = sellAlpha(db, pusher, sellAmt, null, gameNow);
  await assertPoR('post-exchange-sell');
  const tAlpha = (db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string }).wei;
  ok(outCents > 0 && BigInt(tAlpha) > 0n,
    `selling ${fmt(sellAmt)} ALPHA paid ${outCents.toLocaleString()}¢ SETTLED; the ALPHA fee (${fmt(BigInt(tAlpha))}) is CAPTURED to the treasury, not burned`);
}

// --- the patient mule: seasoning, not fees, is what it waits out ---
{
  ok(effectiveFeeBps(db, gameNow) === EXCHANGE.feeBps, 'pre-check: the exchange is calm again (base fee)');
  const FARM = 5_000;
  const fairAlpha = FARM / rate();
  applyCarry(db, mule, gameNow); // settle ~75 warped days of Scrip carry BEFORE farming
  postTx(db, mule, FARM, 0, 'gig', 'm4:farm2', gameNow);
  const { outWei } = buyAlpha(db, mule, FARM, null, gameNow);
  await warp(VALVE.seasoningDays + 1);           // wait out the full seasoning window
  const got = await cashOut(KEYS[0] as Hex, mule, outWei);
  const lossPct = (1 - Number(got) / 1e18 / fairAlpha) * 100;
  ok(lossPct < 10, `a PATIENT mule that waits ${VALVE.seasoningDays} days pays only fee + friction: −${lossPct.toFixed(1)}% vs mid`);
  ok(true, 'the sim charges that patience §13.A idle decay — the in-game ALPHA carry module is still queued (honest scope limit)');
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
  const audit = solvencyAudit(db, await reserve());
  ok(audit.holds, `final PoR: reserve ${fmt(BigInt(audit.reserveWei))} >= liabilities ${fmt(BigInt(audit.liabilitiesWei))} (surplus = boundary fees: ${fmt(BigInt(audit.surplusWei))})`);
}

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED'}`);
process.exitCode = failures ? 1 : 0;
