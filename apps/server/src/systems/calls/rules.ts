/** Calls: the chance action (GDD §5.1). Pays UNSETTLED only (I4). The server resolves. */
import { randomInt } from 'node:crypto';
import type { DB } from '../../core/db.js';
import { EngineError } from '../../core/errors.js';
import { withTx } from '../../core/tx.js';
import { getPlayer, postTx } from '../../ledger/scrip.js';
import { applyCarry } from '../../economy/carry.js';
import { spendBar, checkCooldown, setCooldown } from '../pacing.js';
import { BOOSTER, CALLS } from '@outfox/shared';

/** Uniform [0,1) from crypto randomness — Math.random (xorshift128+) is state-recoverable
 * from observed payouts, which is unacceptable for money-bearing outcomes.
 * (crypto.randomInt requires range < 2^48, hence 2^48 − 1.) */
const ROLL_RANGE = 2 ** 48 - 1;
const cryptoRoll = () => randomInt(0, ROLL_RANGE) / ROLL_RANGE;

export interface CallOutcome { ok: boolean; payout: number; nicked: boolean; boosted: boolean }

/** Clean chance with one Signal Booster: +pp, never above the published cap. */
export const boostedP = (p: number) => Math.min(p + BOOSTER.pp, BOOSTER.maxP);

export function runCall(
  db: DB, playerId: number, callId: string, now = Date.now(),
  roll: () => number = cryptoRoll, boost = false,
): CallOutcome {
  const call = CALLS.find((c) => c.id === callId);
  if (!call) throw new EngineError('bad_action', 'unknown Call');
  return withTx(db, () => {
    applyCarry(db, playerId, now);
    checkCooldown(db, playerId, call.id, now);
    // Fail closed: a boosted Call needs a Booster in play (owned, not on the book, not
    // used). It is found before anything is spent, and used up inside the same
    // transaction as the roll, so a refused Call changes nothing.
    const booster = boost
      ? db.prepare(`SELECT id FROM items WHERE owner_id = ? AND kind = ? AND listed = 0
                    AND consumed_at IS NULL ORDER BY id LIMIT 1`).get(playerId, BOOSTER.item) as
          { id: number } | undefined
      : undefined;
    if (boost && !booster) throw new EngineError('no_booster', 'no Signal Booster to use');
    const p = getPlayer(db, playerId);
    spendBar(db, p, 'risk', call.riskCost, now);
    if (booster) db.prepare(`UPDATE items SET consumed_at = ? WHERE id = ?`).run(now, booster.id);
    const ok = roll() < (booster ? boostedP(call.successP) : call.successP);
    if (ok) {
      const [lo, hi] = call.payout;
      const payout = lo + Math.floor(roll() * (hi - lo + 1));
      postTx(db, playerId, 0, payout, 'call', call.id, now); // chance → Unsettled ONLY
      setCooldown(db, playerId, call.id, now + call.cooldownOkSec * 1000);
      return { ok: true, payout, nicked: false, boosted: !!booster };
    }
    setCooldown(db, playerId, call.id, now + call.cooldownNickedSec * 1000);
    return { ok: false, payout: 0, nicked: true, boosted: !!booster };
  });
}
