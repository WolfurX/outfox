/** Calls: the chance action (GDD §5.1). Pays UNSETTLED only (I4). The server resolves. */
import { randomInt } from 'node:crypto';
import type { DB } from '../../core/db.js';
import { EngineError } from '../../core/errors.js';
import { withTx } from '../../core/tx.js';
import { getPlayer, postTx } from '../../ledger/scrip.js';
import { applyCarry } from '../../economy/carry.js';
import { spendBar, checkCooldown, setCooldown } from '../pacing.js';
import { CALLS } from '@outfox/shared';

/** Uniform [0,1) from crypto randomness — Math.random (xorshift128+) is state-recoverable
 * from observed payouts, which is unacceptable for money-bearing outcomes.
 * (crypto.randomInt requires range < 2^48, hence 2^48 − 1.) */
const ROLL_RANGE = 2 ** 48 - 1;
const cryptoRoll = () => randomInt(0, ROLL_RANGE) / ROLL_RANGE;

export interface CallOutcome { ok: boolean; payout: number; nicked: boolean }

export function runCall(
  db: DB, playerId: number, callId: string, now = Date.now(),
  roll: () => number = cryptoRoll,
): CallOutcome {
  const call = CALLS.find((c) => c.id === callId);
  if (!call) throw new EngineError('bad_action', 'unknown Call');
  return withTx(db, () => {
    applyCarry(db, playerId, now);
    checkCooldown(db, playerId, call.id, now);
    const p = getPlayer(db, playerId);
    spendBar(db, p, 'risk', call.riskCost, now);
    const ok = roll() < call.successP;
    if (ok) {
      const [lo, hi] = call.payout;
      const payout = lo + Math.floor(roll() * (hi - lo + 1));
      postTx(db, playerId, 0, payout, 'call', call.id, now); // chance → Unsettled ONLY
      setCooldown(db, playerId, call.id, now + call.cooldownOkSec * 1000);
      return { ok: true, payout, nicked: false };
    }
    setCooldown(db, playerId, call.id, now + call.cooldownNickedSec * 1000);
    return { ok: false, payout: 0, nicked: true };
  });
}
