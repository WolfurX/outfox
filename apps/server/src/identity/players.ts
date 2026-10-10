/** The Fox: account creation, the rung check, and the player view every route returns. */
import { randomInt } from 'node:crypto';
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import { getPlayer } from '../ledger/scrip.js';
import { applyCarry } from '../economy/carry.js';
import { computeBar } from '../systems/pacing.js';
import { REGEN, type PlayerView, type ItemKind } from '@outfox/shared';

export function createPlayer(db: DB, now = Date.now()): number {
  return withTx(db, () => {
    // 36^4 handles collide (birthday bound ~1.5k players) — retry, then widen.
    for (let attempt = 0; ; attempt++) {
      const chars = attempt < 8 ? 4 : 6;
      const handle = `Fox-${randomInt(0, 36 ** chars).toString(36).padStart(chars, '0').toUpperCase()}`;
      try {
        const r = db.prepare(
          `INSERT INTO players (handle, created_at, focus, focus_at, risk, risk_at, carry_at, alpha_carry_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(handle, now, REGEN.focusMax, now, REGEN.riskMax, now, now, now);
        const id = Number(r.lastInsertRowid);
        // Starter tool (deterministic origin, market-eligible) — the slice's trade good.
        db.prepare(`INSERT INTO items (owner_id, kind, origin) VALUES (?, 'terminal_mk1', 'starter')`).run(id);
        return id;
      } catch (e) {
        if (attempt < 20 && e instanceof Error && e.message.includes('UNIQUE')) continue;
        throw e;
      }
    }
  });
}

/** Actions that require R1 (registered) — the market write surfaces. Reads stay R0.
 * (DESIGN-SYSTEM-WEB §10.1: listings/sales are R1; the demanding surface triggers the
 * upgrade.) */
export function requireRung(db: DB, playerId: number, min: number): void {
  const p = getPlayer(db, playerId);
  if (p.rung < min) throw new EngineError('rung_required', 'register to trade on the Open Market');
}

/** NOTE: deliberately side-effectful read — carry (demurrage) applies lazily on first
 * touch of the day, so any state-returning endpoint may post a Carry ledger row. This is
 * the designed lazy-decay model; the /api/ledger route applies it too for consistency. */
export function playerView(db: DB, playerId: number, now = Date.now()): PlayerView {
  applyCarry(db, playerId, now);
  const p = getPlayer(db, playerId);
  const items = db.prepare(`SELECT id, kind, listed FROM items WHERE owner_id = ? AND consumed_at IS NULL`).all(playerId) as
    { id: number; kind: ItemKind; listed: number }[];
  const cds = db.prepare(
    `SELECT action_id, ready_at FROM cooldowns WHERE player_id = ? AND ready_at > ?`
  ).all(playerId, now) as { action_id: string; ready_at: number }[];
  return {
    handle: p.handle,
    rung: Math.max(0, Math.min(3, p.rung)) as 0 | 1 | 2 | 3,
    email: p.email,
    focus: Math.floor(computeBar(p.focus, p.focus_at, REGEN.focusPerSec, REGEN.focusMax, now)),
    risk: Math.floor(computeBar(p.risk, p.risk_at, REGEN.riskPerSec, REGEN.riskMax, now)),
    focusMax: REGEN.focusMax,
    riskMax: REGEN.riskMax,
    scripSettled: p.scrip_settled,
    scripUnsettled: p.scrip_unsettled,
    items: items.map((i) => ({ id: i.id, kind: i.kind, listed: !!i.listed })),
    cooldowns: Object.fromEntries(cds.map((c) => [c.action_id, c.ready_at])),
    gigCount: p.gig_count,
    serverTime: now,
  };
}
