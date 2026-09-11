/**
 * Holding costs, applied lazily on touch (ARCHITECTURE.md §5): the Scrip carry
 * (demurrage, ECONOMY.md §2.1) and the $ALPHA carry (§13.A idle decay + §13.D
 * progressive levy). One catch-up per touch, one ledger row, capture to the treasury.
 */
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import { DAY_MS } from '../core/time.js';
import { getPlayer, postTx, treasuryAdd } from '../ledger/scrip.js';
import { postAlpha, treasuryAlphaAdd } from '../ledger/alpha.js';
import { ALPHA_BASE_UNITS, ALPHA_CARRY, DEMURRAGE } from '@outfox/shared';

// ----- Scrip: demurrage ----------------------------------------------------------

/** Applies daily carry (demurrage) lazily. One ledger row per catch-up. */
export function applyCarry(db: DB, playerId: number, now = Date.now()): void {
  const p = getPlayer(db, playerId);
  const days = Math.floor((now - p.carry_at) / DAY_MS);
  if (days <= 0) return;
  const keep = (1 - DEMURRAGE.ratePerDay) ** days;
  const decayOf = (bal: number) => {
    const taxable = Math.max(bal - DEMURRAGE.floor, 0);
    return Math.floor(taxable * (1 - keep));
  };
  // Note: the exemption floor applies per settlement class, matching the calibrated
  // reference model (sim/simulation.py demurrage loop over C_clean/C_bound) — the
  // ~one-extra-floor shelter is priced into every passing gate run, not a divergence.
  const dS = decayOf(p.scrip_settled);
  const dU = decayOf(p.scrip_unsettled);
  withTx(db, () => {
    db.prepare(`UPDATE players SET carry_at = carry_at + ? WHERE id = ?`).run(days * DAY_MS, playerId);
    if (dS > 0 || dU > 0) {
      postTx(db, playerId, -dS, -dU, 'carry', `carry:${days}d`, now);
      treasuryAdd(db, dS + dU); // decay is CAPTURE, not burn (ECONOMY.md §2.1)
    }
  });
}

// ----- $ALPHA: idle decay + progressive levy (ECONOMY.md §13.A + §13.D) ----------

const BPS = 10_000n;
const IDLE_BPS = BigInt(ALPHA_CARRY.idleRatePerDayBps);
const PROG_BPS = BigInt(ALPHA_CARRY.progRatePerDayBps);
const SHELTER_WEI = BigInt(ALPHA_CARRY.progShelterAlpha) * ALPHA_BASE_UNITS;

/** (1 − idle rate)^days with the same per-day floor rounding as applyAlphaCarry —
 * used to charge held (unclaimed) deposits their waiting time at claim. */
export function idleDecayCompound(wei: bigint, days: number): bigint {
  let w = wei;
  for (let d = 0; d < days; d++) w -= (w * IDLE_BPS) / BPS;
  return w;
}

/**
 * The ALPHA holding cost — the build-vs-model gap named in sim/M4-CONTRACT-LOOP.md,
 * closed here. Lazy like the Scrip carry: one catch-up per touch, one ledger row.
 * Per elapsed day, matching the sim's §13.A/§13.D blocks:
 *   1. every lot decays by the idle rate — proportional across lots, which preserves
 *      the seasoned/unseasoned mix exactly as the sim's proportional unseasoned
 *      decay does; no exemption floor (the sim applies none to ALPHA);
 *   2. the TOTAL position above the published shelter pays the progressive rate on
 *      the excess, deducted pro-rata across lots (the sim deducts staked-first; the
 *      build has no staking yet, so the whole position is liquid). Per-lot flooring
 *      leaves any division dust with the player.
 * Proceeds → treasury_alpha (CAPTURE, never burn). Every lot mutation settles this
 * clock FIRST, so the constant-balance assumption inside a catch-up holds by
 * construction. Withdrawals in flight are exempt by design: a voucher is a fixed
 * obligation priced at request time, not a hoard. Dormancy is NOT a shelter (§13.D):
 * the charge accrues while untouched and the full catch-up posts on the next touch.
 */
export function applyAlphaCarry(db: DB, playerId: number, now = Date.now()): void {
  const p = db.prepare(`SELECT alpha_carry_at FROM players WHERE id = ?`).get(playerId) as
    { alpha_carry_at: number } | undefined;
  if (!p) throw new EngineError('no_player', 'unknown player');
  const days = Math.floor((now - p.alpha_carry_at) / DAY_MS);
  if (days <= 0) return;
  withTx(db, () => {
    db.prepare(`UPDATE players SET alpha_carry_at = alpha_carry_at + ? WHERE id = ?`)
      .run(days * DAY_MS, playerId);
    const lots = db.prepare(
      `SELECT id, remaining_wei FROM alpha_lots WHERE player_id = ?`
    ).all(playerId) as { id: number; remaining_wei: string }[];
    if (lots.length === 0) return; // fast-forward the clock over an empty position
    const bal = lots.map((l) => BigInt(l.remaining_wei));
    let captured = 0n;
    for (let d = 0; d < days; d++) {
      let total = 0n;
      for (let i = 0; i < bal.length; i++) {
        const dec = (bal[i] * IDLE_BPS) / BPS;
        bal[i] -= dec;
        captured += dec;
        total += bal[i];
      }
      if (total > SHELTER_WEI) {
        const levy = ((total - SHELTER_WEI) * PROG_BPS) / BPS;
        for (let i = 0; i < bal.length; i++) {
          const take = (levy * bal[i]) / total;
          bal[i] -= take;
          captured += take;
        }
      }
    }
    if (captured === 0n) return;
    treasuryAlphaAdd(db, captured);
    postAlpha(db, playerId, -captured, 'carry', `carry:${days}d`, now, {
      rebalance: lots.map((l, i) => ({ id: l.id, remainingWei: bal[i] })),
    });
  });
}
