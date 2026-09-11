/** Refills: a SINK (GDD §5.6). Unsettled is spendable here (allowed destination), used first. */
import type { DB } from '../../core/db.js';
import { EngineError } from '../../core/errors.js';
import { withTx } from '../../core/tx.js';
import { getPlayer, postTx, treasuryAdd } from '../../ledger/scrip.js';
import { applyCarry } from '../../economy/carry.js';
import { computeBar } from '../pacing.js';
import { REGEN, REFILL } from '@outfox/shared';

export function refill(db: DB, playerId: number, bar: 'focus' | 'risk', now = Date.now()): void {
  if (bar !== 'focus' && bar !== 'risk') throw new EngineError('bad_action', 'unknown bar');
  withTx(db, () => {
    applyCarry(db, playerId, now);
    const p = getPlayer(db, playerId);
    const total = p.scrip_settled + p.scrip_unsettled;
    if (total < REFILL.cost) throw new EngineError('insufficient', 'insufficient Scrip');
    const fromU = Math.min(p.scrip_unsettled, REFILL.cost);
    const fromS = REFILL.cost - fromU;
    postTx(db, playerId, -fromS, -fromU, 'refill', bar, now);
    treasuryAdd(db, REFILL.cost); // sink value is captured, not burned
    const perSec = bar === 'focus' ? REGEN.focusPerSec : REGEN.riskPerSec;
    const max = bar === 'focus' ? REGEN.focusMax : REGEN.riskMax;
    const cur = computeBar(p[bar], p[`${bar}_at`], perSec, max, now);
    db.prepare(`UPDATE players SET ${bar} = ?, ${bar}_at = ? WHERE id = ?`)
      .run(Math.min(max, cur + REFILL.amount), now, playerId);
  });
}
