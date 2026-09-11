/** Gigs: deterministic work (GDD §5.2). Pays SETTLED (I4); every Nth completion yields a tool. */
import type { DB } from '../../core/db.js';
import { withTx } from '../../core/tx.js';
import { getPlayer, postTx } from '../../ledger/scrip.js';
import { applyCarry } from '../../economy/carry.js';
import { spendBar, checkCooldown, setCooldown } from '../pacing.js';
import { GIG, type ItemKind } from '@outfox/shared';

export function runGig(db: DB, playerId: number, now = Date.now()): { toolAwarded?: ItemKind } {
  return withTx(db, () => {
    applyCarry(db, playerId, now);
    checkCooldown(db, playerId, GIG.id, now);
    const p = getPlayer(db, playerId);
    spendBar(db, p, 'focus', GIG.focusCost, now);
    postTx(db, playerId, GIG.payout, 0, 'gig', GIG.id, now);
    const count = p.gig_count + 1;
    db.prepare(`UPDATE players SET gig_count = ? WHERE id = ?`).run(count, playerId);
    setCooldown(db, playerId, GIG.id, now + GIG.cooldownSec * 1000);
    if (count % GIG.toolEvery === 0) {
      db.prepare(`INSERT INTO items (owner_id, kind, origin) VALUES (?, 'signal_booster', 'gig')`).run(playerId);
      return { toolAwarded: 'signal_booster' };
    }
    return {};
  });
}
