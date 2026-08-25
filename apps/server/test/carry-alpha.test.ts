import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import { createPlayer, postTx } from '../src/engine.js';
import {
  creditDeposit, linkWallet, alphaBalance, unseasonedBalance, requestWithdrawal,
  alphaView, applyAlphaCarry, idleDecayCompound, solvencyAudit,
} from '../src/settlement.js';
import { seedExchange, buyAlpha } from '../src/exchange.js';
import { ALPHA_CARRY, VALVE } from '@outfox/shared';

// The ALPHA carry (ECONOMY.md §13.A idle decay + §13.D progressive carry) — the
// build-vs-model gap named in sim/M4-CONTRACT-LOOP.md. These tests pin the arithmetic
// (per-day floor rounding, proportional deduction) and the adversarial closures
// (the patient mule pays for the wait; held deposits cannot dodge the holding cost).

const DAY = 86_400_000;
const WEI = 10n ** 18n;
const A = (n: number | bigint) => BigInt(n) * WEI;
const W1 = '0x1111111111111111111111111111111111111111';
const BIG_RESERVE = A(1_000_000);
const SHELTER = A(ALPHA_CARRY.progShelterAlpha);

// pinned mid-day (exchange.test.ts precedent): no wall-clock dependence
const T0 = 1_750_000_000_000;

/** Reference model: the same per-day schedule, reimplemented independently of the
 * engine's storage/write path. Any drift in rounding or application order fails here. */
function refCarry(lotsWei: bigint[], days: number): { bal: bigint[]; captured: bigint } {
  const bal = [...lotsWei];
  let captured = 0n;
  for (let d = 0; d < days; d++) {
    let total = 0n;
    for (let i = 0; i < bal.length; i++) {
      const dec = (bal[i] * BigInt(ALPHA_CARRY.idleRatePerDayBps)) / 10_000n;
      bal[i] -= dec; captured += dec; total += bal[i];
    }
    if (total > SHELTER) {
      const levy = ((total - SHELTER) * BigInt(ALPHA_CARRY.progRatePerDayBps)) / 10_000n;
      for (let i = 0; i < bal.length; i++) {
        const take = (levy * bal[i]) / total;
        bal[i] -= take; captured += take;
      }
    }
  }
  return { bal, captured };
}

let db: DB;
let p: number;

function treasuryAlpha(): bigint {
  return BigInt((db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string }).wei);
}

function carryRows(id: number): { delta_wei: string; ref: string }[] {
  return db.prepare(
    `SELECT delta_wei, ref FROM alpha_ledger WHERE player_id = ? AND kind = 'carry'`
  ).all(id) as { delta_wei: string; ref: string }[];
}

beforeEach(() => {
  db = openDb(':memory:');
  p = createPlayer(db, T0);
  linkWallet(db, p, W1, T0);
});

describe('§13.A idle decay', () => {
  it('charges nothing inside the same day', () => {
    creditDeposit(db, W1, A(100), '0xtx1', 0, T0);
    applyAlphaCarry(db, p, T0 + DAY - 1);
    expect(alphaBalance(db, p)).toBe(A(100));
    expect(carryRows(p)).toEqual([]);
  });

  it('one day below the shelter: exactly the idle rate, captured to the ALPHA treasury', () => {
    creditDeposit(db, W1, A(100), '0xtx1', 0, T0);
    applyAlphaCarry(db, p, T0 + DAY);
    // 100 ALPHA × 45 bps = 0.45 ALPHA
    expect(alphaBalance(db, p)).toBe(9955n * 10n ** 16n);
    expect(treasuryAlpha()).toBe(45n * 10n ** 16n);
    expect(carryRows(p)).toEqual([{ delta_wei: (-(45n * 10n ** 16n)).toString(), ref: 'carry:1d' }]);
  });

  it('multi-day catch-up compounds per day with floor rounding, in ONE ledger row', () => {
    creditDeposit(db, W1, A(100), '0xtx1', 0, T0);
    applyAlphaCarry(db, p, T0 + 10 * DAY);
    const ref = refCarry([A(100)], 10);
    expect(alphaBalance(db, p)).toBe(ref.bal[0]);
    expect(treasuryAlpha()).toBe(ref.captured);
    expect(carryRows(p)).toEqual([{ delta_wei: (-ref.captured).toString(), ref: 'carry:10d' }]);
  });

  it('decays proportionally across lots — the seasoned/unseasoned mix is preserved', () => {
    const old = T0 - (VALVE.seasoningDays + 5) * DAY;
    creditDeposit(db, W1, A(100), '0xold', 0, old);  // seasoned
    creditDeposit(db, W1, A(100), '0xnew', 0, T0);   // fresh
    applyAlphaCarry(db, p, T0 + DAY);
    const bal = alphaBalance(db, p);
    expect(unseasonedBalance(db, p, T0 + DAY)).toBe(bal / 2n); // equal lots stay equal
  });

  it('dormancy is not a shelter: an untouched account pays the full catch-up on next read', () => {
    creditDeposit(db, W1, A(100), '0xtx1', 0, T0);
    const view = alphaView(db, p, T0 + 30 * DAY); // the read itself settles the carry
    const ref = refCarry([A(100)], 30);
    expect(BigInt(view.balanceWei)).toBe(ref.bal[0]);
    expect(carryRows(p)).toEqual([{ delta_wei: (-ref.captured).toString(), ref: 'carry:30d' }]);
  });

  it('fast-forwards an empty position without posting anything', () => {
    applyAlphaCarry(db, p, T0 + 400 * DAY);
    expect(carryRows(p)).toEqual([]);
    // the clock advanced: a deposit now is NOT retroactively decayed
    creditDeposit(db, W1, A(50), '0xtx1', 0, T0 + 400 * DAY);
    applyAlphaCarry(db, p, T0 + 400 * DAY + DAY - 1);
    expect(alphaBalance(db, p)).toBe(A(50));
  });
});

describe('§13.D progressive carry', () => {
  it('the shelter is free; the excess pays the progressive rate on top of base', () => {
    creditDeposit(db, W1, A(1000), '0xtx1', 0, T0);
    applyAlphaCarry(db, p, T0 + DAY);
    // base: 1000 × 45 bps = 4.5 → 995.5; excess 745.5 × 450 bps = 33.5475
    const expected = A(1000) - 45n * 10n ** 17n - 335_475n * 10n ** 14n;
    expect(alphaBalance(db, p)).toBe(expected);
    expect(treasuryAlpha()).toBe(A(1000) - expected);
  });

  it('a position below the shelter never pays the progressive component', () => {
    creditDeposit(db, W1, A(200), '0xtx1', 0, T0);
    applyAlphaCarry(db, p, T0 + 20 * DAY);
    // base-only reference: 20 days of 45 bps, no levy anywhere (200 < 250 throughout)
    let w = A(200);
    for (let d = 0; d < 20; d++) w -= (w * 45n) / 10_000n;
    expect(alphaBalance(db, p)).toBe(w);
  });

  it('multi-lot, multi-day agrees with the reference schedule exactly', () => {
    const old = T0 - 100 * DAY;
    creditDeposit(db, W1, A(300), '0xold', 0, old);
    creditDeposit(db, W1, A(700), '0xnew', 0, T0);
    applyAlphaCarry(db, p, T0 + 7 * DAY);
    const ref = refCarry([A(300), A(700)], 7);
    expect(alphaBalance(db, p)).toBe(ref.bal[0] + ref.bal[1]);
    expect(treasuryAlpha()).toBe(ref.captured);
  });
});

describe('adversarial closures', () => {
  it('the patient mule pays the holding cost for waiting out seasoning (the M4 gap)', () => {
    db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(p);
    creditDeposit(db, W1, A(100), '0xtx1', 0, T0);
    const later = T0 + (VALVE.seasoningDays + 1) * DAY;
    const wd = requestWithdrawal(db, p, A(10), BIG_RESERVE, later);
    // seasoned: no surcharge — but the wait itself was charged before pricing
    expect(BigInt(wd.feeWei)).toBe((A(10) * BigInt(VALVE.feeBps)) / 10_000n);
    const ref = refCarry([A(100)], VALVE.seasoningDays + 1);
    expect(alphaBalance(db, p)).toBe(ref.bal[0] - A(10)); // decayed, then withdrawn
    expect(carryRows(p)).toEqual([
      { delta_wei: (-ref.captured).toString(), ref: `carry:${VALVE.seasoningDays + 1}d` },
    ]);
  });

  it('a held (unclaimed) deposit cannot dodge the carry: the wait is charged at claim', () => {
    const q = createPlayer(db, T0);
    const W2 = '0x2222222222222222222222222222222222222222';
    creditDeposit(db, W2, A(100), '0xheld', 0, T0); // nobody has linked W2 yet
    const later = T0 + 90 * DAY;
    linkWallet(db, q, W2, later);
    const net = idleDecayCompound(A(100), 90);
    expect(net).toBeLessThan(A(100));
    expect(alphaBalance(db, q)).toBe(net);
    expect(unseasonedBalance(db, q, later)).toBe(0n); // seasoning keeps the arrival clock
    expect(treasuryAlpha()).toBe(A(100) - net);
    expect(carryRows(q)).toEqual([{ delta_wei: (net - A(100)).toString(), ref: 'carry:held:90d' }]);
  });

  it('carry moves value, never destroys it: solvency liabilities are unchanged', () => {
    creditDeposit(db, W1, A(1000), '0xtx1', 0, T0);
    const before = solvencyAudit(db, BIG_RESERVE);
    alphaView(db, p, T0 + 30 * DAY); // triggers a large catch-up
    const after = solvencyAudit(db, BIG_RESERVE);
    expect(after.liabilitiesWei).toBe(before.liabilitiesWei);
    expect(after.holds).toBe(true);
  });
});

describe('exchange integration', () => {
  it('a swap settles the carry clock before the bought lot lands', () => {
    db.prepare(`UPDATE players SET rung = 1 WHERE id = ?`).run(p);
    postTx(db, p, 200_000, 0, 'gig', 'test-fund', T0);
    seedExchange(db, 3_000_000, A(30_000), 'test-genesis', T0);
    buyAlpha(db, p, 10_000, null, T0);
    const firstLot = alphaBalance(db, p);
    const later = T0 + 2 * DAY;
    buyAlpha(db, p, 10_000, null, later);
    // the first lot paid 2 days of carry (below shelter → base only); the second is fresh
    const ref = refCarry([firstLot], 2);
    expect(carryRows(p)).toEqual([{ delta_wei: (-ref.captured).toString(), ref: 'carry:2d' }]);
  });
});
