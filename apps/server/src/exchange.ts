/**
 * The Exchange — the ONLY bridge between Scrip and ALPHA (ECONOMY.md §2.2/§4/§8).
 * A floating, never-pegged, protocol-owned constant-product pool, implementing the
 * exact mechanics the sim validated (sim/simulation.py _exchange_step):
 *
 *   E1 — Provenance firewall (G10): buys draw on SETTLED Scrip only. postTx enforces
 *        it structurally — there is no code path from Unsettled into the pool.
 *   E2 — Seasoning (§13.C): ALPHA bought here is a fresh UNSEASONED lot
 *        (source='exchange'); the withdrawal surcharge prices any fast exit.
 *        Sells consume YOUNGEST lots first — the sim's attacker-optimal assumption,
 *        and the player-favorable rule (seasoned stock is preserved for cash-out).
 *   E3 — Fees are CAPTURE, input-side: buy-leg fee in Scrip → treasury; sell-leg fee
 *        in ALPHA → treasury_alpha. Policy ammunition, never operator revenue (§3.4).
 *   E4 — Flow caps (§13.B(d), the batch-auction proxy): gross inflow per side per
 *        rolling 24h ≤ flowCapBps of that side's reserve. Bounds any cartel's or
 *        panic's daily price impact; unfilled flow simply retries later.
 *   E5 — Circuit-breaker fee (§13.B): the fee multiplier grows with sustained
 *        fast-vs-slow EMA deviation beyond the band, capped. EMAs roll once per day
 *        from the close — a trade can never move the fee it pays (no feedback loop).
 *   E6 — Pool ALPHA is reserve-backed: production seeding consumes a REAL on-chain
 *        treasury deposit (poolSeedFromDeposit), and solvencyAudit counts the pool
 *        and the ALPHA treasury as liabilities. Rounding always favors the pool, so
 *        the product k never decreases and the pool cannot be drained by dust.
 *
 * Rate convention: e = Scrip ¢ per whole ALPHA = credit_cents / (alpha_wei / 1e18).
 */
import type { DB } from './db.js';
import { withTx, EngineError, postTx, treasuryAdd, requireRung, applyCarry } from './engine.js';
import { postAlpha, applyAlphaCarry } from './settlement.js';
import { EXCHANGE, type ExchangeView, type ExchangeQuote } from '@outfox/shared';

const DAY_MS = 86_400_000;
const WEI_PER_ALPHA = 10n ** 18n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

function toSafeCents(v: bigint, what: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new EngineError('overflow', `${what} out of range`);
  return Number(v);
}

// ----- pool state ------------------------------------------------------------

export interface Pool { creditCents: bigint; alphaWei: bigint }

export function getPool(db: DB): Pool | null {
  const r = db.prepare(`SELECT credit_cents, alpha_wei FROM exchange_pool WHERE id = 1`).get() as
    { credit_cents: number; alpha_wei: string } | undefined;
  return r ? { creditCents: BigInt(r.credit_cents), alphaWei: BigInt(r.alpha_wei) } : null;
}

function requirePool(db: DB): Pool {
  const p = getPool(db);
  if (!p) throw new EngineError('exchange_off', 'the exchange is not open yet');
  return p;
}

function writePool(db: DB, p: Pool): void {
  db.prepare(`UPDATE exchange_pool SET credit_cents = ?, alpha_wei = ? WHERE id = 1`)
    .run(toSafeCents(p.creditCents, 'pool Scrip'), p.alphaWei.toString());
}

/** ¢ per whole ALPHA, as a float — a derived metric (G9 series), never money math. */
function rateOf(p: Pool): number {
  return (Number(p.creditCents) * 1e18) / Number(p.alphaWei);
}

// ----- seeding ---------------------------------------------------------------

/**
 * One-time genesis of the pool (protocol-owned liquidity). The Scrip side is a
 * protocol MINT, in-ledger — conservationAudit reads it back from the seed event.
 * Production callers use poolSeedFromDeposit so the ALPHA side is reserve-backed;
 * this raw form is for chainless dev and the genesis of test worlds.
 * Depth at launch is a pending owner decision (wiki/state.md) — the dev default
 * elsewhere mirrors the sim's calibrated amm_credit0/amm_vig0.
 */
export function seedExchange(
  db: DB, creditCents: number, alphaWei: bigint, ref: string, now = Date.now(),
): void {
  if (!Number.isInteger(creditCents) || creditCents <= 0 || alphaWei <= 0n) {
    throw new EngineError('bad_amount', 'seed amounts must be positive');
  }
  withTx(db, () => {
    if (getPool(db)) throw new EngineError('already_seeded', 'the exchange is already open');
    db.prepare(`INSERT INTO exchange_pool (id, credit_cents, alpha_wei) VALUES (1, ?, ?)`)
      .run(creditCents, alphaWei.toString());
    db.prepare(
      `INSERT INTO exchange_events (player_id, kind, credit_in, alpha_in, rate_after, ref, at)
       VALUES (NULL, 'seed', ?, ?, ?, ?, ?)`
    ).run(creditCents, alphaWei.toString(), rateOf({ creditCents: BigInt(creditCents), alphaWei }), ref, now);
    db.prepare(`INSERT INTO exchange_ema (id, e_fast, e_slow, day) VALUES (1, ?, ?, ?)`)
      .run(rateOf({ creditCents: BigInt(creditCents), alphaWei }),
           rateOf({ creditCents: BigInt(creditCents), alphaWei }),
           Math.floor(now / DAY_MS));
  });
}

/**
 * Production seeding (E6): consume a specific on-chain deposit — one the treasury made
 * to the Settlement contract from an address no player has linked — as the pool's ALPHA
 * inventory. Deleting the unclaimed row is what makes the backing single-spend: that
 * deposit can never ALSO be claimed by a later wallet link.
 */
export function poolSeedFromDeposit(
  db: DB, txHash: string, logIndex: number, creditCents: number, now = Date.now(),
): void {
  withTx(db, () => {
    const held = db.prepare(
      `SELECT amount_wei FROM unclaimed_deposits WHERE tx_hash = ? AND log_index = ?`
    ).get(txHash, logIndex) as { amount_wei: string } | undefined;
    if (!held) throw new EngineError('no_deposit', 'no held deposit under that key');
    db.prepare(`DELETE FROM unclaimed_deposits WHERE tx_hash = ? AND log_index = ?`)
      .run(txHash, logIndex);
    seedExchange(db, creditCents, BigInt(held.amount_wei), `pool:${txHash}:${logIndex}`, now);
  });
}

// ----- E5: the daily EMA roll + circuit-breaker fee ---------------------------

/** Lazily roll the fast/slow EMAs forward one step per elapsed day, from the close
 * (the current pool rate — unchanged since the last trade, which IS the close).
 * Matches the sim: fee deviation is judged on the PREVIOUS tick's EMAs. */
export function rollEma(db: DB, now = Date.now()): { eFast: number; eSlow: number } {
  const r = db.prepare(`SELECT e_fast, e_slow, day FROM exchange_ema WHERE id = 1`).get() as
    { e_fast: number; e_slow: number; day: number } | undefined;
  if (!r) throw new EngineError('exchange_off', 'the exchange is not open yet');
  const today = Math.floor(now / DAY_MS);
  let { e_fast: eFast, e_slow: eSlow } = r;
  if (today > r.day) {
    const e = rateOf(requirePool(db));
    const aFast = 2 / (EXCHANGE.emaFastDays + 1);
    const aSlow = 2 / (EXCHANGE.emaSlowDays + 1);
    for (let d = r.day; d < today; d++) {
      eFast += aFast * (e - eFast);
      eSlow += aSlow * (e - eSlow);
    }
    db.prepare(`UPDATE exchange_ema SET e_fast = ?, e_slow = ?, day = ? WHERE id = 1`)
      .run(eFast, eSlow, today);
  }
  return { eFast, eSlow };
}

export function effectiveFeeBps(db: DB, now = Date.now()): number {
  const { eFast, eSlow } = rollEma(db, now);
  const dev = Math.abs(eFast - eSlow) / Math.max(eSlow, 1e-9);
  const mult = Math.min(1 + EXCHANGE.volFeeK * Math.max(0, dev - EXCHANGE.volBand),
                        EXCHANGE.volFeeMultMax);
  return Math.round(EXCHANGE.feeBps * mult);
}

// ----- E4: rolling flow caps ---------------------------------------------------

function grossInflow24h(db: DB, kind: 'buy' | 'sell', now: number): { credit: bigint; alpha: bigint } {
  const rows = db.prepare(
    `SELECT credit_in, alpha_in FROM exchange_events WHERE kind = ? AND at > ?`
  ).all(kind, now - DAY_MS) as { credit_in: number; alpha_in: string }[];
  return {
    credit: rows.reduce((a, r) => a + BigInt(r.credit_in), 0n),
    alpha: rows.reduce((a, r) => a + BigInt(r.alpha_in), 0n),
  };
}

export function buyCapacityCents(db: DB, now = Date.now()): bigint {
  const pool = requirePool(db);
  const cap = (pool.creditCents * BigInt(EXCHANGE.flowCapBps)) / 10_000n;
  const used = grossInflow24h(db, 'buy', now).credit;
  return used >= cap ? 0n : cap - used;
}

export function sellCapacityWei(db: DB, now = Date.now()): bigint {
  const pool = requirePool(db);
  const cap = (pool.alphaWei * BigInt(EXCHANGE.flowCapBps)) / 10_000n;
  const used = grossInflow24h(db, 'sell', now).alpha;
  return used >= cap ? 0n : cap - used;
}

// ----- pricing (shared by quote and execution — no drift possible) -------------

/** Buy leg: fee out of the input in Scrip; the net moves the constant product.
 * Output rounds DOWN (ceilDiv on the residual) — the pool keeps the dust. */
function priceBuy(pool: Pool, effBps: number, amountCents: bigint) {
  const fee = ceilDiv(amountCents * BigInt(effBps), 10_000n); // Scrip fees round up (market precedent)
  const dc = amountCents - fee;
  if (dc <= 0n) throw new EngineError('too_small', 'that amount is too small to trade');
  const k = pool.creditCents * pool.alphaWei;
  const credit2 = pool.creditCents + dc;
  const out = pool.alphaWei - ceilDiv(k, credit2);
  if (out <= 0n) throw new EngineError('too_small', 'that amount is too small to trade');
  return { fee, dc, out };
}

/** Sell leg: fee out of the input in ALPHA (floor — valve precedent); net moves k. */
function priceSell(pool: Pool, effBps: number, amountWei: bigint) {
  const fee = (amountWei * BigInt(effBps)) / 10_000n;
  const dv = amountWei - fee;
  if (dv <= 0n) throw new EngineError('too_small', 'that amount is too small to trade');
  const k = pool.creditCents * pool.alphaWei;
  const alpha2 = pool.alphaWei + dv;
  const out = pool.creditCents - ceilDiv(k, alpha2);
  if (out <= 0n) throw new EngineError('too_small', 'that amount is too small to trade');
  return { fee, dv, out };
}

// ----- trades ------------------------------------------------------------------

/** Scrip → ALPHA. Settled only (E1); the bought lot is unseasoned (E2). */
export function buyAlpha(
  db: DB, playerId: number, amountCents: number, minOutWei: bigint | null = null,
  now = Date.now(),
): { outWei: bigint; feeCents: number; effBps: number } {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new EngineError('bad_amount', 'amount must be a positive whole number of Scrip');
  }
  return withTx(db, () => {
    requireRung(db, playerId, 1); // a value surface — same rung as Open Market writes
    applyCarry(db, playerId, now);
    applyAlphaCarry(db, playerId, now); // settle before the bought lot lands
    const pool = requirePool(db);
    const effBps = effectiveFeeBps(db, now);

    const cap = buyCapacityCents(db, now);
    if (BigInt(amountCents) > cap) {
      throw new EngineError('exchange_capacity', 'exchange capacity is used up for now — try again later');
    }
    const p = db.prepare(`SELECT scrip_settled FROM players WHERE id = ?`).get(playerId) as
      { scrip_settled: number } | undefined;
    if (!p) throw new EngineError('no_player', 'unknown player');
    if (p.scrip_settled < amountCents) {
      // Deliberately NOT total-balance: Unsettled cannot reach the exchange (E1/G10).
      throw new EngineError('insufficient_settled', 'not enough Settled Scrip');
    }

    const { fee, dc, out } = priceBuy(pool, effBps, BigInt(amountCents));
    if (minOutWei !== null && out < minOutWei) {
      throw new EngineError('rate_moved', 'the rate moved — refresh the quote');
    }

    postTx(db, playerId, -amountCents, 0, 'exchange_buy', `ex:${amountCents}c`, now);
    treasuryAdd(db, toSafeCents(fee, 'fee'));
    writePool(db, { creditCents: pool.creditCents + dc, alphaWei: pool.alphaWei - out });
    // §13.C: bought ALPHA is a NEW acquisition — the lot starts unseasoned.
    db.prepare(
      `INSERT INTO alpha_lots (player_id, remaining_wei, acquired_at, source)
       VALUES (?, ?, ?, 'exchange')`
    ).run(playerId, out.toString(), now);
    postAlpha(db, playerId, out, 'exchange_buy', `ex:${amountCents}c`, now);
    const after = { creditCents: pool.creditCents + dc, alphaWei: pool.alphaWei - out };
    db.prepare(
      `INSERT INTO exchange_events
         (player_id, kind, credit_in, alpha_out, fee_credit, fee_mult, rate_after, at)
       VALUES (?, 'buy', ?, ?, ?, ?, ?, ?)`
    ).run(playerId, amountCents, out.toString(), toSafeCents(fee, 'fee'),
          effBps / EXCHANGE.feeBps, rateOf(after), now);
    return { outWei: out, feeCents: toSafeCents(fee, 'fee'), effBps };
  });
}

/** ALPHA → Settled Scrip. Consumes YOUNGEST lots first (E2). */
export function sellAlpha(
  db: DB, playerId: number, amountWei: bigint, minOutCents: number | null = null,
  now = Date.now(),
): { outCents: number; feeWei: bigint; effBps: number } {
  if (amountWei <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
  return withTx(db, () => {
    requireRung(db, playerId, 1);
    applyCarry(db, playerId, now); // settle carry BEFORE crediting (buyListing precedent)
    applyAlphaCarry(db, playerId, now); // the consumption plan must see post-carry lots
    const pool = requirePool(db);
    const effBps = effectiveFeeBps(db, now);

    const cap = sellCapacityWei(db, now);
    if (amountWei > cap) {
      throw new EngineError('exchange_capacity', 'exchange capacity is used up for now — try again later');
    }

    // youngest-first consumption plan
    const lots = db.prepare(
      `SELECT id, remaining_wei FROM alpha_lots WHERE player_id = ?
       ORDER BY acquired_at DESC, id DESC`
    ).all(playerId) as { id: number; remaining_wei: string }[];
    let left = amountWei;
    const plan: { id: number; take: bigint }[] = [];
    for (const lot of lots) {
      if (left === 0n) break;
      const avail = BigInt(lot.remaining_wei);
      if (avail === 0n) continue;
      const take = avail < left ? avail : left;
      plan.push({ id: lot.id, take });
      left -= take;
    }
    if (left > 0n) throw new EngineError('insufficient_alpha', 'not enough ALPHA');

    const { fee, dv, out } = priceSell(pool, effBps, amountWei);
    const outCents = toSafeCents(out, 'proceeds');
    if (minOutCents !== null && outCents < minOutCents) {
      throw new EngineError('rate_moved', 'the rate moved — refresh the quote');
    }

    for (const step of plan) {
      const lot = db.prepare(`SELECT remaining_wei FROM alpha_lots WHERE id = ?`).get(step.id) as
        { remaining_wei: string };
      const rest = BigInt(lot.remaining_wei) - step.take;
      if (rest === 0n) db.prepare(`DELETE FROM alpha_lots WHERE id = ?`).run(step.id);
      else db.prepare(`UPDATE alpha_lots SET remaining_wei = ? WHERE id = ?`).run(rest.toString(), step.id);
    }
    postAlpha(db, playerId, -amountWei, 'exchange_sell', `ex:${amountWei}w`, now);
    const t = db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string };
    db.prepare(`UPDATE treasury_alpha SET wei = ? WHERE id = 1`)
      .run((BigInt(t.wei) + fee).toString());
    writePool(db, { creditCents: pool.creditCents - out, alphaWei: pool.alphaWei + dv });
    postTx(db, playerId, outCents, 0, 'exchange_sell', `ex:${amountWei}w`, now);
    const after = { creditCents: pool.creditCents - out, alphaWei: pool.alphaWei + dv };
    db.prepare(
      `INSERT INTO exchange_events
         (player_id, kind, alpha_in, credit_out, fee_alpha, fee_mult, rate_after, at)
       VALUES (?, 'sell', ?, ?, ?, ?, ?, ?)`
    ).run(playerId, amountWei.toString(), outCents, fee.toString(),
          effBps / EXCHANGE.feeBps, rateOf(after), now);
    return { outCents, feeWei: fee, effBps };
  });
}

// ----- views -------------------------------------------------------------------

/** NOTE: side-effectful read, like playerView — the daily EMA roll applies lazily on
 * the first exchange touch of the day. */
export function exchangeView(db: DB, now = Date.now()): ExchangeView {
  const pool = requirePool(db);
  return {
    rateCentsPerAlpha: rateOf(pool).toFixed(4),
    effectiveFeeBps: effectiveFeeBps(db, now),
    baseFeeBps: EXCHANGE.feeBps,
    poolScripCents: toSafeCents(pool.creditCents, 'pool Scrip'),
    poolAlphaWei: pool.alphaWei.toString(),
    buyCapacityCents: toSafeCents(buyCapacityCents(db, now), 'capacity'),
    sellCapacityWei: sellCapacityWei(db, now).toString(),
  };
}

export function quoteExchange(
  db: DB, side: 'buy' | 'sell', amount: bigint, now = Date.now(),
): ExchangeQuote {
  const pool = requirePool(db);
  const effBps = effectiveFeeBps(db, now);
  if (side === 'buy') {
    const { fee, out } = priceBuy(pool, effBps, amount);
    return {
      side, amountIn: amount.toString(), fee: fee.toString(),
      amountOut: out.toString(), effectiveFeeBps: effBps,
    };
  }
  const { fee, out } = priceSell(pool, effBps, amount);
  return {
    side, amountIn: amount.toString(), fee: fee.toString(),
    amountOut: out.toString(), effectiveFeeBps: effBps,
  };
}

// ----- the exchange audit (tested; a debug endpoint alongside the others) --------

/** The pool row must be exactly the fold of the event stream, and the ALPHA treasury
 * exactly the captured sell-leg fees (its only writer today — revisit when the §13.A/D
 * ALPHA carry lands). DATA-ARCHITECTURE.md principle 1 made checkable. */
export function exchangeAudit(db: DB): {
  holds: boolean; poolScripCents: string; poolAlphaWei: string;
  foldScripCents: string; foldAlphaWei: string; treasuryAlphaWei: string;
} {
  const pool = requirePool(db);
  const rows = db.prepare(
    `SELECT kind, credit_in, credit_out, alpha_in, alpha_out, fee_credit, fee_alpha
     FROM exchange_events`
  ).all() as { kind: string; credit_in: number; credit_out: number; alpha_in: string;
               alpha_out: string; fee_credit: number; fee_alpha: string }[];
  let credit = 0n, alpha = 0n, feesAlpha = 0n;
  for (const r of rows) {
    credit += BigInt(r.credit_in) - BigInt(r.fee_credit) - BigInt(r.credit_out);
    alpha += BigInt(r.alpha_in) - BigInt(r.fee_alpha) - BigInt(r.alpha_out);
    feesAlpha += BigInt(r.fee_alpha);
  }
  const treasury = BigInt((db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string }).wei);
  const holds = credit === pool.creditCents && alpha === pool.alphaWei && treasury === feesAlpha;
  return {
    holds,
    poolScripCents: pool.creditCents.toString(), poolAlphaWei: pool.alphaWei.toString(),
    foldScripCents: credit.toString(), foldAlphaWei: alpha.toString(),
    treasuryAlphaWei: treasury.toString(),
  };
}
