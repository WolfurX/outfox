import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { createPlayer, postTx, conservationAudit, EngineError } from '../src/engine.js';
import {
  creditDeposit, linkWallet, alphaBalance, unseasonedBalance, solvencyAudit,
} from '../src/settlement.js';
import {
  seedExchange, poolSeedFromDeposit, getPool, buyAlpha, sellAlpha, quoteExchange,
  exchangeView, exchangeAudit, effectiveFeeBps, rollEma, buyCapacityCents, sellCapacityWei,
} from '../src/exchange.js';
import { ALPHA_BASE_UNITS, EXCHANGE } from '@outfox/shared';

const DAY = 86_400_000;
const A = (n: number | bigint) => BigInt(n) * ALPHA_BASE_UNITS;
const W1 = '0x1111111111111111111111111111111111111111';

// the sim's calibrated POL depth: e0 = 100 ¢ per ALPHA
const SEED_C = 3_000_000;
const SEED_A = A(30_000);
const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

let db: DB;
let p: number;
let now: number;

/** Settled Scrip via the deterministic faucet — a real mint, so conservation holds. */
function fund(id: number, cents: number) {
  postTx(db, id, cents, 0, 'gig', 'test-fund', now);
}
function rung(id: number, r: number) {
  db.prepare(`UPDATE players SET rung = ? WHERE id = ?`).run(r, id);
}

beforeEach(() => {
  db = openDb(':memory:');
  // pinned mid-day (2025-06-15 ~15:06 UTC): day-roll tests must not depend on where the
  // wall clock happens to sit relative to a UTC day boundary
  now = 1_750_000_000_000;
  p = createPlayer(db, now);
  rung(p, 1);
});

describe('seeding', () => {
  it('opens the pool at e0 with the seed event and calm EMAs', () => {
    seedExchange(db, SEED_C, SEED_A, 'test-genesis', now);
    const pool = getPool(db)!;
    expect(pool.creditCents).toBe(BigInt(SEED_C));
    expect(pool.alphaWei).toBe(SEED_A);
    expect(exchangeView(db, now).rateCentsPerAlpha).toBe('100.0000');
    expect(effectiveFeeBps(db, now)).toBe(EXCHANGE.feeBps); // e_fast == e_slow at genesis
    expect(exchangeAudit(db).holds).toBe(true);
  });

  it('cannot be seeded twice', () => {
    seedExchange(db, SEED_C, SEED_A, 'test-genesis', now);
    expect(() => seedExchange(db, 1, 1n, 'again', now)).toThrow(/already open/);
  });

  it('trades are refused before the pool opens', () => {
    fund(p, 10_000);
    expect(() => buyAlpha(db, p, 1_000, null, now)).toThrow(/not open/);
  });

  it('E6: poolSeedFromDeposit consumes the held treasury deposit — it can never ALSO be claimed by a wallet link', () => {
    creditDeposit(db, W1, SEED_A, '0xseed', 0, now); // W1 unlinked → held
    poolSeedFromDeposit(db, '0xseed', 0, SEED_C, now);
    expect(getPool(db)!.alphaWei).toBe(SEED_A);
    linkWallet(db, p, W1, now); // linking later claims NOTHING — the row is gone
    expect(alphaBalance(db, p)).toBe(0n);
    // reserve exactly the seed deposit ⇒ solvency holds with the pool as a liability
    expect(solvencyAudit(db, SEED_A).holds).toBe(true);
    expect(solvencyAudit(db, SEED_A - 1n).holds).toBe(false);
  });

  it('poolSeedFromDeposit demands a real held deposit', () => {
    expect(() => poolSeedFromDeposit(db, '0xnope', 0, SEED_C, now)).toThrow(/no held deposit/);
  });
});

describe('buys (Scrip → ALPHA)', () => {
  beforeEach(() => seedExchange(db, SEED_C, SEED_A, 'test-genesis', now));

  it('prices through the constant product, fee input-side to the treasury, lot unseasoned', () => {
    fund(p, 10_000);
    const { outWei, feeCents } = buyAlpha(db, p, 10_000, null, now);

    const fee = ceilDiv(10_000n * 150n, 10_000n); // 150¢ at the base fee
    const dc = 10_000n - fee;
    const k = BigInt(SEED_C) * SEED_A;
    const expectedOut = SEED_A - ceilDiv(k, BigInt(SEED_C) + dc);
    expect(feeCents).toBe(Number(fee));
    expect(outWei).toBe(expectedOut);

    const treas = (db.prepare(`SELECT scrip FROM treasury WHERE id = 1`).get() as { scrip: number }).scrip;
    expect(treas).toBe(150);
    const pool = getPool(db)!;
    expect(pool.creditCents).toBe(BigInt(SEED_C) + dc);
    expect(pool.alphaWei).toBe(SEED_A - expectedOut);

    // §13.C: the bought lot is fresh — fully unseasoned, source='exchange'
    expect(alphaBalance(db, p)).toBe(expectedOut);
    expect(unseasonedBalance(db, p, now)).toBe(expectedOut);
    const src = db.prepare(`SELECT source FROM alpha_lots WHERE player_id = ?`).get(p) as { source: string };
    expect(src.source).toBe('exchange');
  });

  it('quote and execution cannot drift', () => {
    fund(p, 10_000);
    const q = quoteExchange(db, 'buy', 10_000n, now);
    const r = buyAlpha(db, p, 10_000, null, now);
    expect(r.outWei.toString()).toBe(q.amountOut);
    expect(String(r.feeCents)).toBe(q.fee);
  });

  it('G10: Unsettled Scrip cannot reach the exchange — no code path exists', () => {
    postTx(db, p, 0, 1_000_000, 'call', 'chance', now); // rich, but only in Unsettled
    expect(() => buyAlpha(db, p, 1_000, null, now)).toThrow(/not enough Settled/);
    expect(alphaBalance(db, p)).toBe(0n);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM exchange_events WHERE kind = 'buy'`).get())
      .toEqual({ n: 0 });
  });

  it('R0 guests cannot trade (the demanding surface gates at R1)', () => {
    const guest = createPlayer(db, now);
    fund(guest, 10_000);
    expect(() => buyAlpha(db, guest, 1_000, null, now)).toThrow(/register/);
  });

  it('minOut protects a stale quote (the rate moved)', () => {
    const q2 = createPlayer(db, now);
    rung(q2, 1);
    fund(p, 50_000);
    fund(q2, 50_000);
    const quote = quoteExchange(db, 'buy', 10_000n, now);
    buyAlpha(db, q2, 50_000, null, now); // someone buys first — ALPHA got pricier
    expect(() => buyAlpha(db, p, 10_000, BigInt(quote.amountOut), now)).toThrow(/rate moved/);
  });

  it('rejects dust that would round to nothing', () => {
    fund(p, 10);
    expect(() => buyAlpha(db, p, 1, null, now)).toThrow(/too small/);
  });
});

describe('sells (ALPHA → Settled Scrip)', () => {
  beforeEach(() => {
    seedExchange(db, SEED_C, SEED_A, 'test-genesis', now);
    linkWallet(db, p, W1, now); // rung → 2
  });

  it('prices exactly; the ALPHA fee is CAPTURED to treasury_alpha; proceeds are Settled', () => {
    creditDeposit(db, W1, A(100), '0xtx1', 0, now);
    const { outCents, feeWei } = sellAlpha(db, p, A(100), null, now);

    const fee = (A(100) * 150n) / 10_000n;
    const dv = A(100) - fee;
    const k = BigInt(SEED_C) * SEED_A;
    const expectedOut = BigInt(SEED_C) - ceilDiv(k, SEED_A + dv);
    expect(feeWei).toBe(fee);
    expect(BigInt(outCents)).toBe(expectedOut);

    const t = db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string };
    expect(BigInt(t.wei)).toBe(fee);
    const row = db.prepare(`SELECT scrip_settled, scrip_unsettled FROM players WHERE id = ?`).get(p) as
      { scrip_settled: number; scrip_unsettled: number };
    expect(row.scrip_settled).toBe(outCents); // Settled, never Unsettled
    expect(row.scrip_unsettled).toBe(0);
    expect(alphaBalance(db, p)).toBe(0n);
  });

  it('E2: consumes YOUNGEST lots first — seasoned stock survives for cash-out', () => {
    const old = now - 90 * DAY;
    creditDeposit(db, W1, A(30), '0xold', 0, old);   // seasoned
    creditDeposit(db, W1, A(100), '0xnew', 0, now);  // fresh
    sellAlpha(db, p, A(50), null, now);
    // 50 came out of the fresh lot; the seasoned 30 is untouched
    expect(alphaBalance(db, p)).toBe(A(80));
    expect(unseasonedBalance(db, p, now)).toBe(A(50));
    const oldLot = db.prepare(
      `SELECT remaining_wei FROM alpha_lots WHERE player_id = ? AND acquired_at = ?`
    ).get(p, old) as { remaining_wei: string };
    expect(BigInt(oldLot.remaining_wei)).toBe(A(30));
  });

  it('rejects selling more than the balance', () => {
    creditDeposit(db, W1, A(5), '0xtx1', 0, now);
    expect(() => sellAlpha(db, p, A(10), null, now)).toThrow(/not enough ALPHA/);
  });
});

describe('E4: rolling flow caps (the batch-auction proxy)', () => {
  beforeEach(() => {
    seedExchange(db, SEED_C, SEED_A, 'test-genesis', now);
    linkWallet(db, p, W1, now);
  });

  it('buy side: 2% of the Scrip reserve per rolling 24h, then it frees up', () => {
    fund(p, 200_000);
    expect(buyCapacityCents(db, now)).toBe(60_000n); // 2% of 3,000,000
    buyAlpha(db, p, 60_000, null, now);              // exactly the cap — fills
    expect(() => buyAlpha(db, p, 60_000, null, now + 1)).toThrow(/capacity/);
    // a day later the window has rolled — the same order fills
    const later = now + DAY + 60_000;
    expect(buyAlpha(db, p, 60_000, null, later).outWei > 0n).toBe(true);
  });

  it('sell side: 2% of the ALPHA reserve per rolling 24h', () => {
    creditDeposit(db, W1, A(2_000), '0xtx1', 0, now);
    expect(sellCapacityWei(db, now)).toBe(A(600)); // 2% of 30,000
    sellAlpha(db, p, A(600), null, now);
    expect(() => sellAlpha(db, p, A(600), null, now + 1)).toThrow(/capacity/);
    const later = now + DAY + 60_000;
    expect(sellAlpha(db, p, A(600), null, later).outCents).toBeGreaterThan(0);
  });
});

describe('E5: the circuit-breaker fee', () => {
  beforeEach(() => seedExchange(db, SEED_C, SEED_A, 'test-genesis', now));

  function setEma(eFast: number, eSlow: number) {
    db.prepare(`UPDATE exchange_ema SET e_fast = ?, e_slow = ?, day = ? WHERE id = 1`)
      .run(eFast, eSlow, Math.floor(now / DAY));
  }

  it('calm trade pays the base fee; deviation inside the band never escalates', () => {
    setEma(100, 100);
    expect(effectiveFeeBps(db, now)).toBe(150);
    setEma(119, 100); // dev 19% < band 20%
    expect(effectiveFeeBps(db, now)).toBe(150);
  });

  it('sustained deviation beyond the band escalates linearly and caps at 4×', () => {
    setEma(130, 100); // dev 30% → mult 1 + 8·(0.10) = 1.8
    expect(effectiveFeeBps(db, now)).toBe(Math.round(150 * 1.8));
    setEma(300, 100); // dev 200% → capped at 4×
    expect(effectiveFeeBps(db, now)).toBe(600);
    setEma(50, 100);  // symmetric: a crash escalates too (|dev| = 50%)
    expect(effectiveFeeBps(db, now)).toBe(Math.round(150 * Math.min(1 + 8 * 0.3, 4)));
  });

  it('the escalated toll is charged, and recorded on the event', () => {
    fund(p, 10_000);
    rung(p, 1);
    setEma(300, 100);
    const { feeCents } = buyAlpha(db, p, 10_000, null, now);
    expect(feeCents).toBe(600); // 6% of 10,000 — 4× the base 1.5%
    const ev = db.prepare(`SELECT fee_mult FROM exchange_events WHERE kind = 'buy'`).get() as
      { fee_mult: number };
    expect(ev.fee_mult).toBe(4);
  });

  it('EMAs roll once per elapsed day from the close — a trade never moves its own fee', () => {
    fund(p, 200_000);
    rung(p, 1);
    buyAlpha(db, p, 60_000, null, now); // moves e up ~4%
    // same day: EMA state untouched by the trade
    const before = db.prepare(`SELECT e_fast, e_slow FROM exchange_ema WHERE id = 1`).get() as
      { e_fast: number; e_slow: number };
    expect(before.e_fast).toBe(100);
    expect(before.e_slow).toBe(100);
    // three days later: rolled forward with the standard recurrence toward the close
    const later = now + 3 * DAY;
    const pool = getPool(db)!;
    const e = (Number(pool.creditCents) * Number(ALPHA_BASE_UNITS)) / Number(pool.alphaWei);
    let f = 100, s = 100;
    const aF = 2 / (EXCHANGE.emaFastDays + 1), aS = 2 / (EXCHANGE.emaSlowDays + 1);
    for (let i = 0; i < 3; i++) { f += aF * (e - f); s += aS * (e - s); }
    const rolled = rollEma(db, later);
    expect(rolled.eFast).toBeCloseTo(f, 9);
    expect(rolled.eSlow).toBeCloseTo(s, 9);
  });
});

describe('conservation + the exchange audit', () => {
  it('Scrip is conserved across seed, buys, and sells (players + treasury + pool == mints)', () => {
    seedExchange(db, SEED_C, SEED_A, 'test-genesis', now);
    linkWallet(db, p, W1, now);
    fund(p, 50_000);
    creditDeposit(db, W1, A(200), '0xtx1', 0, now);
    buyAlpha(db, p, 20_000, null, now);
    sellAlpha(db, p, A(150), null, now);
    buyAlpha(db, p, 5_000, null, now);
    expect(conservationAudit(db).holds).toBe(true);
    expect(exchangeAudit(db).holds).toBe(true);
  });

  it('the exchange audit catches a tampered pool', () => {
    seedExchange(db, SEED_C, SEED_A, 'test-genesis', now);
    db.prepare(`UPDATE exchange_pool SET credit_cents = credit_cents + 1 WHERE id = 1`).run();
    expect(exchangeAudit(db).holds).toBe(false);
  });

  it('solvency counts the pool and the ALPHA treasury at every step', () => {
    // back the pool with a real held deposit, then trade against it
    creditDeposit(db, W1, SEED_A, '0xseed', 0, now);
    poolSeedFromDeposit(db, '0xseed', 0, SEED_C, now);
    const reserve = SEED_A + A(100);
    const q2 = createPlayer(db, now);
    linkWallet(db, q2, '0x3333333333333333333333333333333333333333', now);
    creditDeposit(db, '0x3333333333333333333333333333333333333333', A(100), '0xtx2', 0, now);
    fund(q2, 50_000);
    expect(solvencyAudit(db, reserve).holds).toBe(true);
    buyAlpha(db, q2, 20_000, null, now);
    expect(solvencyAudit(db, reserve).holds).toBe(true);
    sellAlpha(db, q2, A(80), null, now);
    const audit = solvencyAudit(db, reserve);
    expect(audit.holds).toBe(true);
    // ledger-side ALPHA never exceeds the chain: player lots + pool + fee treasury == reserve
    expect(BigInt(audit.liabilitiesWei)).toBe(reserve);
  });
});
