/**
 * Wire Calls: a Call on a real Panta market (GDD §5.1). Pure over the DB: no HTTP here, the
 * job fills wire_markets and this file only reads it. Pays UNSETTLED only (I4), at the odds
 * taken, fixed when the call is made. Fail closed: every refusal happens before anything is
 * spent.
 */
import type { DB } from '../../core/db.js';
import { EngineError } from '../../core/errors.js';
import { withTx } from '../../core/tx.js';
import { getPlayer, postTx } from '../../ledger/scrip.js';
import { applyCarry } from '../../economy/carry.js';
import { spendBar } from '../pacing.js';
import { WIRE, wirePayout } from '@outfox/shared';
import type { WireMarketView, WirePositionView, WireSide } from '@outfox/shared';

interface MarketRow {
  market_id: string; title: string; category: string; ends_at: number; settles_at: number;
  yes_price: number | null; quoted_at: number | null; listed: number; outcome: string | null;
}
interface PositionRow {
  id: number; market_id: string; title: string; settles_at: number; side: WireSide;
  price: number; payout: number; opened_at: number; status: WirePositionView['status'];
  settled_at: number | null;
}

const toPositionView = (r: PositionRow): WirePositionView => ({
  id: r.id, marketId: r.market_id, title: r.title, side: r.side, price: r.price,
  payout: r.payout, openedAt: r.opened_at, settlesAt: r.settles_at, status: r.status,
  settledAt: r.settled_at,
});

const positionById = (db: DB, id: number): WirePositionView =>
  toPositionView(db.prepare(
    `SELECT p.id, p.market_id, m.title, m.settles_at, p.side, p.price, p.payout, p.opened_at,
            p.status, p.settled_at
     FROM wire_positions p JOIN wire_markets m ON m.market_id = p.market_id WHERE p.id = ?`
  ).get(id) as unknown as PositionRow);

export function openWireCall(
  db: DB, playerId: number, marketId: string, side: WireSide, now = Date.now(),
): WirePositionView {
  if (side !== 'yes' && side !== 'no') throw new EngineError('bad_action', 'take YES or NO');
  return withTx(db, () => {
    applyCarry(db, playerId, now);
    const m = db.prepare(`SELECT * FROM wire_markets WHERE market_id = ?`).get(marketId) as unknown as MarketRow | undefined;
    // Closed unless listed, undecided, still trading, and quoted recently enough to show as live.
    if (!m || m.listed !== 1 || m.outcome !== null || m.ends_at <= now
        || m.yes_price === null || m.quoted_at === null
        || m.quoted_at < now - WIRE.quoteStaleSec * 1000) {
      throw new EngineError('wire_closed', 'that market is closed on the Wire');
    }
    if (db.prepare(`SELECT 1 FROM wire_positions WHERE player_id = ? AND market_id = ?`).get(playerId, marketId)) {
      throw new EngineError('wire_taken', 'you already have a call on that market');
    }
    const open = db.prepare(
      `SELECT COUNT(*) AS n FROM wire_positions WHERE player_id = ? AND status = 'open'`
    ).get(playerId) as { n: number };
    if (open.n >= WIRE.maxOpen) throw new EngineError('wire_full', 'too many open Wire calls');
    spendBar(db, getPlayer(db, playerId), 'risk', WIRE.riskCost, now);
    const price = side === 'yes' ? m.yes_price : 1 - m.yes_price;
    const r = db.prepare(
      `INSERT INTO wire_positions (player_id, market_id, side, price, payout, opened_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(playerId, marketId, side, price, wirePayout(price), now);
    return positionById(db, Number(r.lastInsertRowid));
  });
}

/** Settles every open position whose market has an outcome (all players when playerId is
 * null). Idempotent: the status guard inside the transaction means a position pays once. */
export function settleWire(db: DB, playerId: number | null, now = Date.now()): number {
  const due = db.prepare(
    `SELECT p.id, p.player_id, p.market_id, p.side, p.payout, m.outcome
     FROM wire_positions p JOIN wire_markets m ON m.market_id = p.market_id
     WHERE p.status = 'open' AND m.outcome IS NOT NULL AND (? IS NULL OR p.player_id = ?)
     ORDER BY p.id`
  ).all(playerId, playerId) as
    { id: number; player_id: number; market_id: string; side: WireSide; payout: number; outcome: string }[];
  let settled = 0;
  for (const d of due) {
    withTx(db, () => {
      const still = db.prepare(`SELECT status FROM wire_positions WHERE id = ?`).get(d.id) as { status: string };
      if (still.status !== 'open') return;
      const status = d.outcome === 'cancelled' ? 'void' : d.outcome === d.side ? 'won' : 'nicked';
      if (status === 'won') {
        applyCarry(db, d.player_id, now); // carry on what was held, not on the payout just earned
        postTx(db, d.player_id, 0, d.payout, 'wire', d.market_id, now); // chance -> Unsettled ONLY
      }
      db.prepare(`UPDATE wire_positions SET status = ?, settled_at = ? WHERE id = ?`).run(status, now, d.id);
      settled++;
    });
  }
  return settled;
}

export function wireView(db: DB, playerId: number, now = Date.now()): { markets: WireMarketView[]; positions: WirePositionView[] } {
  // Same gate as openWireCall: a quote past quoteStaleSec is never shown as live (Panta Terms §5).
  const rows = db.prepare(
    `SELECT * FROM wire_markets WHERE listed = 1 AND outcome IS NULL AND ends_at > ?
       AND yes_price IS NOT NULL AND quoted_at >= ? ORDER BY ends_at, market_id`
  ).all(now, now - WIRE.quoteStaleSec * 1000) as unknown as MarketRow[];
  const markets = rows.map((m): WireMarketView => ({
    marketId: m.market_id, title: m.title, category: m.category, endsAt: m.ends_at,
    settlesAt: m.settles_at, yesPrice: m.yes_price!, quotedAt: m.quoted_at!,
    payoutYes: wirePayout(m.yes_price!), payoutNo: wirePayout(1 - m.yes_price!),
  }));
  const positions = (db.prepare(
    `SELECT p.id, p.market_id, m.title, m.settles_at, p.side, p.price, p.payout, p.opened_at,
            p.status, p.settled_at
     FROM wire_positions p JOIN wire_markets m ON m.market_id = p.market_id
     WHERE p.player_id = ? AND (p.status = 'open' OR p.id IN
       (SELECT id FROM wire_positions WHERE player_id = ? ORDER BY id DESC LIMIT 20))
     ORDER BY p.id DESC`
  ).all(playerId, playerId) as unknown as PositionRow[]).map(toPositionView);
  return { markets, positions };
}
