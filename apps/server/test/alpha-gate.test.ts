/**
 * A15 — the single $ALPHA mutation gate (ledger/alpha.ts). Expected values are stated
 * independently of the code (hand-computed), never read back from it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../src/core/db.js';
import { EngineError } from '../src/core/errors.js';
import { createPlayer } from '../src/identity/players.js';
import { postTx } from '../src/ledger/scrip.js';
import { postAlpha, alphaBalance, alphaDriftAudit, lotsOf } from '../src/ledger/alpha.js';
import { linkWallet } from '../src/identity/wallets.js';
import { applyAlphaCarry } from '../src/economy/carry.js';
import { creditDeposit, requestWithdrawal } from '../src/economy/valve.js';
import { seedExchange, buyAlpha, sellAlpha } from '../src/economy/exchange.js';
import { ALPHA_BASE_UNITS } from '@outfox/shared';

const A = ALPHA_BASE_UNITS; // 1 whole ALPHA in base units
const DAY = 86_400_000;
const ADDR = 'F1oxWaLLetAddr111111111111111111111111111111';
let db: DB;
let me: number;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  db = openDb(':memory:');
  me = createPlayer(db, T0);
});

describe('the gate refuses what does not balance', () => {
  it('a non-zero delta with no lot operation', () => {
    expect(() => postAlpha(db, me, 5n * A, 'deposit', 'x', T0)).toThrow(EngineError);
    expect(alphaDriftAudit(db).holds).toBe(true);
  });
  it('a credit whose wei differs from the ledger delta', () => {
    expect(() => postAlpha(db, me, 5n * A, 'deposit', 'x', T0,
      { credit: { wei: 4n * A, acquiredAt: T0, source: 'deposit' } })).toThrow(EngineError);
    expect(lotsOf(db, me)).toHaveLength(0);
  });
  it('a consumption plan larger than the lot holds, and one that does not sum to the delta', () => {
    const lot = postAlpha(db, me, 3n * A, 'deposit', 'd', T0,
      { credit: { wei: 3n * A, acquiredAt: T0, source: 'deposit' } })!;
    expect(() => postAlpha(db, me, -4n * A, 'withdraw_request', 'w', T0,
      { consume: [{ id: lot, take: 4n * A }] })).toThrow(/not enough ALPHA/);
    expect(() => postAlpha(db, me, -2n * A, 'withdraw_request', 'w', T0,
      { consume: [{ id: lot, take: 1n * A }] })).toThrow(EngineError);
    // nothing partial survived either refusal
    expect(alphaBalance(db, me)).toBe(3n * A);
    expect(alphaDriftAudit(db).holds).toBe(true);
  });
  it('a lot that belongs to another Fox', () => {
    const other = createPlayer(db, T0);
    const lot = postAlpha(db, other, 2n * A, 'deposit', 'd', T0,
      { credit: { wei: 2n * A, acquiredAt: T0, source: 'deposit' } })!;
    expect(() => postAlpha(db, me, -1n * A, 'exchange_sell', 's', T0,
      { consume: [{ id: lot, take: 1n * A }] })).toThrow(/does not belong/);
    expect(alphaBalance(db, other)).toBe(2n * A);
  });
  it('a rebalance cannot create value, even when it balances the ledger delta (review finding 1)', () => {
    const lot = postAlpha(db, me, 10n * A, 'deposit', 'd', T0,
      { credit: { wei: 10n * A, acquiredAt: T0, source: 'deposit' } })!;
    expect(() => postAlpha(db, me, 5n * A, 'carry', 'mint', T0,
      { rebalance: [{ id: lot, remainingWei: 15n * A }] })).toThrow(/cannot create value/);
    expect(alphaBalance(db, me)).toBe(10n * A);
    expect(alphaDriftAudit(db).holds).toBe(true);
  });
  it('zero-sized steps: a 0n credit and a 0n take are both refused', () => {
    expect(() => postAlpha(db, me, 0n, 'deposit', 'z', T0,
      { credit: { wei: 0n, acquiredAt: T0, source: 'deposit' } })).toThrow(EngineError);
    const lot = postAlpha(db, me, 1n * A, 'deposit', 'd', T0,
      { credit: { wei: 1n * A, acquiredAt: T0, source: 'deposit' } })!;
    expect(() => postAlpha(db, me, 0n, 'withdraw_request', 'w', T0,
      { consume: [{ id: lot, take: 0n }] })).toThrow(EngineError);
    expect(lotsOf(db, me)).toHaveLength(1);
  });
  it('a plan naming the same lot twice is applied step by step against the live row', () => {
    const lot = postAlpha(db, me, 3n * A, 'deposit', 'd', T0,
      { credit: { wei: 3n * A, acquiredAt: T0, source: 'deposit' } })!;
    postAlpha(db, me, -3n * A, 'withdraw_request', 'w', T0,
      { consume: [{ id: lot, take: 1n * A }, { id: lot, take: 2n * A }] });
    expect(alphaBalance(db, me)).toBe(0n);
    const again = postAlpha(db, me, 2n * A, 'deposit', 'e', T0,
      { credit: { wei: 2n * A, acquiredAt: T0, source: 'deposit' } })!;
    // the first step empties and deletes the lot; the second reference finds no row and
    // the whole plan rolls back (the balance below proves the first step did not stick)
    expect(() => postAlpha(db, me, -3n * A, 'withdraw_request', 'w2', T0,
      { consume: [{ id: again, take: 2n * A }, { id: again, take: 1n * A }] })).toThrow(EngineError);
    expect(alphaBalance(db, me)).toBe(2n * A);
    expect(alphaDriftAudit(db).holds).toBe(true);
  });
  it('a rebalance that does not match the delta, or drives a lot negative', () => {
    const lot = postAlpha(db, me, 10n * A, 'deposit', 'd', T0,
      { credit: { wei: 10n * A, acquiredAt: T0, source: 'deposit' } })!;
    expect(() => postAlpha(db, me, -1n * A, 'carry', 'c', T0,
      { rebalance: [{ id: lot, remainingWei: 8n * A }] })).toThrow(EngineError);
    expect(() => postAlpha(db, me, -11n * A, 'carry', 'c', T0,
      { rebalance: [{ id: lot, remainingWei: -1n * A }] })).toThrow(EngineError);
    expect(alphaBalance(db, me)).toBe(10n * A);
  });
});

describe('the drift audit', () => {
  it('holds across deposit, held-deposit claim, carry, withdrawal, buy and sell', () => {
    // a held deposit (no wallet yet), then the link claims it 3 days later: the lot is
    // credited at the arrival clock and the held wait pays 3 days of idle decay
    creditDeposit(db, ADDR, 100n * A, 'tx1', 0, T0);
    linkWallet(db, me, ADDR, T0 + 3 * DAY);
    expect(alphaDriftAudit(db).holds).toBe(true);
    // a direct deposit once linked
    creditDeposit(db, ADDR, 50n * A, 'tx2', 0, T0 + 3 * DAY);
    // the carry over 5 more days (idle + progressive above the 250 shelter is not hit)
    applyAlphaCarry(db, me, T0 + 8 * DAY);
    expect(alphaDriftAudit(db).holds).toBe(true);
    // the exchange, both legs
    seedExchange(db, 3_000_000, 30_000n * A, 'seed', T0 + 8 * DAY);
    db.prepare(`UPDATE players SET rung = 3 WHERE id = ?`).run(me);
    postTx(db, me, 10_000, 0, 'gig', 'seed-scrip', T0 + 8 * DAY);
    buyAlpha(db, me, 5_000, null, T0 + 8 * DAY);
    sellAlpha(db, me, 1n * A, null, T0 + 8 * DAY);
    expect(alphaDriftAudit(db).holds).toBe(true);
    // a withdrawal request (seasoned lots first): once the carry for the wait is settled,
    // the position drops by exactly the gross
    applyAlphaCarry(db, me, T0 + 70 * DAY);
    const before = alphaBalance(db, me);
    requestWithdrawal(db, me, 10n * A, 1_000_000n * A, T0 + 70 * DAY);
    expect(alphaBalance(db, me)).toBe(before - 10n * A);
    const audit = alphaDriftAudit(db);
    expect(audit.holds).toBe(true);
    expect(audit.drifted).toEqual([]);
  });
  it('names the player when a lot is written behind the gate', () => {
    postAlpha(db, me, 7n * A, 'deposit', 'd', T0,
      { credit: { wei: 7n * A, acquiredAt: T0, source: 'deposit' } });
    // simulate a bypass: a lot row appears without a ledger row
    db.prepare(`INSERT INTO alpha_lots (player_id, remaining_wei, acquired_at, source) VALUES (?, ?, ?, 'deposit')`)
      .run(me, (1n * A).toString(), T0);
    const audit = alphaDriftAudit(db);
    expect(audit.holds).toBe(false);
    expect(audit.drifted).toEqual([{ playerId: me, ledgerWei: (7n * A).toString(), lotsWei: (8n * A).toString() }]);
  });
  it('is atomic: a failing consume step rolls back the earlier steps of the same plan', () => {
    const a = postAlpha(db, me, 2n * A, 'deposit', 'a', T0, { credit: { wei: 2n * A, acquiredAt: T0, source: 'deposit' } })!;
    const b = postAlpha(db, me, 2n * A, 'deposit', 'b', T0, { credit: { wei: 2n * A, acquiredAt: T0, source: 'deposit' } })!;
    expect(() => postAlpha(db, me, -5n * A, 'withdraw_request', 'w', T0,
      { consume: [{ id: a, take: 2n * A }, { id: b, take: 3n * A }] })).toThrow(EngineError);
    expect(lotsOf(db, me).map((l) => l.remaining_wei)).toEqual([(2n * A).toString(), (2n * A).toString()]);
    expect(alphaDriftAudit(db).holds).toBe(true);
  });
});

describe('rungs never demote (PRD FR-ID-5)', () => {
  it('the dev adapter keeps R2 on a re-registration', async () => {
    const { startRegister, verifyRegister } = await import('../src/identity/rungs.js');
    linkWallet(db, me, ADDR, T0); // R2
    const code = startRegister(db, 'fox@example.com', T0);
    verifyRegister(db, me, 'fox@example.com', code, T0);
    const r = db.prepare(`SELECT rung FROM players WHERE id = ?`).get(me) as { rung: number };
    expect(r.rung).toBe(2);
  });
});
