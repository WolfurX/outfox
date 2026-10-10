/**
 * The Scrip ledger (ECONOMY.md §6/§7, DATA-ARCHITECTURE.md principle 1).
 *
 * Invariants (tested in test/engine.test.ts):
 *  I1 — Provenance firewall: Unsettled Scrip (chance origin) can NEVER move between
 *       players or fund a market purchase. It is spendable on sinks only. There is no
 *       code path that converts Unsettled to Settled.
 *  I2 — Single mutation gate: every balance change goes through postTx(), which writes
 *       a provenance-tagged ledger row and rejects overdrafts atomically.
 *  I3 — Conservation: sum(player balances) + treasury + pool == sum(faucet mints). Fees,
 *       sinks, and carry (demurrage) move value to the treasury (CAPTURE) — nothing
 *       vanishes, nothing appears outside a mint.
 *  I4 — Chance pays Unsettled only; deterministic work (Gigs) pays Settled only.
 */
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import type { Provenance, LedgerRow } from '@outfox/shared';

export interface PlayerRow {
  id: number; handle: string; created_at: number;
  focus: number; focus_at: number; risk: number; risk_at: number;
  scrip_settled: number; scrip_unsettled: number;
  gig_count: number; carry_at: number;
  rung: number; email: string | null;
}

export function getPlayer(db: DB, id: number): PlayerRow {
  const p = db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
  if (!p) throw new EngineError('no_player', 'unknown player');
  return p;
}

// ----- I2: the single mutation gate ----------------------------------------

export function postTx(
  db: DB, playerId: number, dSettled: number, dUnsettled: number,
  kind: Provenance, ref: string, now = Date.now(),
): void {
  if (!Number.isInteger(dSettled) || !Number.isInteger(dUnsettled)) {
    throw new EngineError('bad_amount', 'money is integer ¢');
  }
  const p = getPlayer(db, playerId);
  const s = p.scrip_settled + dSettled;
  const u = p.scrip_unsettled + dUnsettled;
  if (s < 0 || u < 0) throw new EngineError('insufficient', 'insufficient Scrip');
  withTx(db, () => {
    db.prepare(`UPDATE players SET scrip_settled = ?, scrip_unsettled = ? WHERE id = ?`)
      .run(s, u, playerId);
    db.prepare(
      `INSERT INTO ledger (player_id, d_settled, d_unsettled, kind, ref, at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(playerId, dSettled, dUnsettled, kind, ref, now);
  });
}

/** The Scrip CAPTURE primitive — fees, carry, and exchange fees all land here. */
export function treasuryAdd(db: DB, amount: number): void {
  db.prepare(`UPDATE treasury SET scrip = scrip + ? WHERE id = 1`).run(amount);
}

export function ledgerView(db: DB, playerId: number, limit = 50): LedgerRow[] {
  const rows = db.prepare(
    `SELECT id, d_settled, d_unsettled, kind, ref, at FROM ledger
     WHERE player_id = ? ORDER BY id DESC LIMIT ?`
  ).all(playerId, limit) as { id: number; d_settled: number; d_unsettled: number; kind: Provenance; ref: string; at: number }[];
  return rows.map((r) => ({
    id: r.id, settled: r.d_settled, unsettled: r.d_unsettled, kind: r.kind, ref: r.ref, at: r.at,
  }));
}

// ----- I3: conservation audit (used by tests and a debug endpoint) -------------

export function conservationAudit(db: DB): { holds: boolean; playerTotal: number; treasury: number; minted: number } {
  const bal = db.prepare(
    `SELECT COALESCE(SUM(scrip_settled + scrip_unsettled), 0) AS t FROM players`
  ).get() as { t: number };
  const treas = (db.prepare(`SELECT scrip FROM treasury WHERE id = 1`).get() as { scrip: number }).scrip;
  // Mints: the faucets (Calls, Gigs, the Wire), plus the exchange pool's protocol-minted Scrip side (the
  // sim books pool liquidity as an in-ledger mint — audit-2). Pool Scrip counts as a
  // holder below; trades only move value between players, treasury, and the pool.
  const minted = db.prepare(
    `SELECT (SELECT COALESCE(SUM(d_settled + d_unsettled), 0) FROM ledger WHERE kind IN ('call','gig','wire'))
          + (SELECT COALESCE(SUM(credit_in), 0) FROM exchange_events WHERE kind = 'seed') AS t`
  ).get() as { t: number };
  const pool = db.prepare(
    `SELECT COALESCE((SELECT credit_cents FROM exchange_pool WHERE id = 1), 0) AS t`
  ).get() as { t: number };
  // per-player ledger ↔ balance agreement
  const drift = db.prepare(
    `SELECT COUNT(*) AS n FROM players p WHERE
       (SELECT COALESCE(SUM(d_settled), 0) FROM ledger WHERE player_id = p.id) != p.scrip_settled
    OR (SELECT COALESCE(SUM(d_unsettled), 0) FROM ledger WHERE player_id = p.id) != p.scrip_unsettled`
  ).get() as { n: number };
  const holds = bal.t + treas + pool.t === minted.t && drift.n === 0;
  return { holds, playerTotal: bal.t, treasury: treas, minted: minted.t };
}
