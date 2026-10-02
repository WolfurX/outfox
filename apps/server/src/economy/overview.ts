/**
 * The public economy overview (GET /api/economy): the aggregates the design commits to
 * publishing (ECONOMY.md §10), read from the same ledger the game runs on.
 *
 * Aggregates only. No player row, handle, wallet, session, or per-player amount leaves
 * through here (DATA-ARCHITECTURE.md §5). The audits are the ledger's own audit
 * functions; only their verdicts are published. This is a summary, not the §10
 * dashboards: velocity, the price index and concentration come with the metric jobs.
 *
 * Balances are as last settled: the carry is assessed lazily on a player's next
 * action, so idle balances here have not yet paid it.
 */
import type { EconomyView } from '@outfox/shared';
import type { DB } from '../core/db.js';
import { conservationAudit } from '../ledger/scrip.js';
import { alphaDriftAudit } from '../ledger/alpha.js';
import { exchangeAudit, exchangeView, getPool } from './exchange.js';
import { outstandingNet, solvencyAudit } from './valve.js';

const DAY = 86_400_000;

/** Everything the ledger alone can say. `reserveWei` is the escrow balance on chain, or
 * null when the chain edge is off or unreachable: the ledger side is published either way. */
export function economyOverview(db: DB, reserveWei: bigint | null, now = Date.now()): EconomyView {
  const since = now - DAY;
  const one = <T>(sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args) as T;

  const players = one<{ total: number; registered: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(rung >= 1), 0) AS registered FROM players`);
  const active = one<{ n: number }>(`SELECT COUNT(DISTINCT player_id) AS n FROM ledger WHERE at >= ?`, since);
  const held = one<{ settled: number; unsettled: number }>(
    `SELECT COALESCE(SUM(scrip_settled), 0) AS settled, COALESCE(SUM(scrip_unsettled), 0) AS unsettled FROM players`);
  const conservation = conservationAudit(db);
  const pool = getPool(db);

  // faucets: what play minted. sinks: what the treasury captured (refills, the carry,
  // the Open Market fee as the gap between what buyers paid and sellers received, and
  // the exchange's buy-leg fee).
  const minted24h = one<{ t: number }>(
    `SELECT COALESCE(SUM(d_settled + d_unsettled), 0) AS t FROM ledger WHERE kind IN ('call','gig') AND at >= ?`, since).t;
  const captured24h = -one<{ t: number }>(
    `SELECT COALESCE(SUM(d_settled + d_unsettled), 0) AS t FROM ledger
     WHERE kind IN ('refill','carry','market_buy','market_sale') AND at >= ?`, since).t
    + one<{ t: number }>(`SELECT COALESCE(SUM(fee_credit), 0) AS t FROM exchange_events WHERE at >= ?`, since).t;

  const alphaHeld = (db.prepare(`SELECT remaining_wei AS w FROM alpha_lots`).all() as { w: string }[])
    .reduce((a, r) => a + BigInt(r.w), 0n);
  const alphaTreasury = BigInt(one<{ wei: string }>(`SELECT wei FROM treasury_alpha WHERE id = 1`).wei);

  return {
    asOf: now,
    players: { total: players.total, registered: players.registered, active24h: active.n },
    scrip: {
      settled: held.settled, unsettled: held.unsettled,
      treasury: conservation.treasury, exchangePool: pool ? Number(pool.creditCents) : 0,
      minted: conservation.minted, minted24h, captured24h,
    },
    alpha: {
      held: alphaHeld.toString(), exchangePool: (pool?.alphaWei ?? 0n).toString(),
      treasury: alphaTreasury.toString(), cashingOut: outstandingNet(db).toString(),
      reserve: reserveWei === null ? null : reserveWei.toString(),
    },
    exchange: pool ? {
      rateCentsPerAlpha: exchangeView(db, now).rateCentsPerAlpha,
      // the G9 series, ~daily closes, as on the Clearinghouse
      points: (db.prepare(
        `SELECT MAX(at) AS at, rate_after AS rate FROM exchange_events
         WHERE kind != 'seed' GROUP BY at / 86400000 ORDER BY at ASC`
      ).all() as { at: number; rate: number }[]).slice(-30),
    } : null,
    audits: {
      conservation: conservation.holds,
      alphaLedger: alphaDriftAudit(db).holds,
      exchange: pool ? exchangeAudit(db).holds : null,
      solvency: reserveWei === null ? null : solvencyAudit(db, reserveWei).holds,
    },
  };
}
