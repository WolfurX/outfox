/** The two bars and the cooldowns: the throttle every action spends (GDD §3.1). */
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import type { PlayerRow } from '../ledger/scrip.js';
import { REGEN } from '@outfox/shared';

export function computeBar(stored: number, at: number, perSec: number, max: number, now: number): number {
  return Math.min(max, stored + ((now - at) / 1000) * perSec);
}

export function spendBar(db: DB, p: PlayerRow, bar: 'focus' | 'risk', cost: number, now: number): void {
  const perSec = bar === 'focus' ? REGEN.focusPerSec : REGEN.riskPerSec;
  const max = bar === 'focus' ? REGEN.focusMax : REGEN.riskMax;
  const cur = computeBar(p[bar], p[`${bar}_at`], perSec, max, now);
  if (cur < cost) throw new EngineError('low_bar', bar === 'focus' ? 'not enough Focus' : 'not enough Risk Appetite');
  db.prepare(`UPDATE players SET ${bar} = ?, ${bar}_at = ? WHERE id = ?`).run(cur - cost, now, p.id);
}

export function checkCooldown(db: DB, playerId: number, actionId: string, now: number): void {
  const row = db.prepare(
    `SELECT ready_at FROM cooldowns WHERE player_id = ? AND action_id = ?`
  ).get(playerId, actionId) as { ready_at: number } | undefined;
  if (row && row.ready_at > now) throw new EngineError('cooldown', 'still cooling down');
}

export function setCooldown(db: DB, playerId: number, actionId: string, readyAt: number): void {
  db.prepare(
    `INSERT INTO cooldowns (player_id, action_id, ready_at) VALUES (?, ?, ?)
     ON CONFLICT (player_id, action_id) DO UPDATE SET ready_at = excluded.ready_at`
  ).run(playerId, actionId, readyAt);
}
