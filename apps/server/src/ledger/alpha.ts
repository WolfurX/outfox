/**
 * The $ALPHA ledger — decision A15 (ARCHITECTURE.md §18): ONE mutation gate.
 *
 * `postAlpha` is the only writer of `alpha_lots` and `alpha_ledger`. It writes both in
 * the same transaction and refuses any call where the lot operation does not balance
 * the ledger delta, so the ledger fold always equals the lots fold per player
 * (`alphaDriftAudit`, the $ALPHA twin of the Scrip conservation audit's drift check).
 * Overdrafts are refused HERE, not by whichever pricing function happened to run first.
 *
 * ALPHA is BigInt base units (9 dp) everywhere; columns are TEXT decimal. Nothing is a float.
 */
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import { DAY_MS } from '../core/time.js';
import { VALVE } from '@outfox/shared';

export type LotRow = { id: number; remaining_wei: string; acquired_at: number };
export type LotSource = 'deposit' | 'exchange';

/** What the gate does to lots alongside the ledger row. */
export type LotOp =
  /** a new acquisition: the lot's clock starts at acquiredAt (§13.C seasoning) */
  | { credit: { wei: bigint; acquiredAt: number; source: LotSource } }
  /** a consumption plan (withdrawal: seasoned first; sale: youngest first) */
  | { consume: { id: number; take: bigint }[] }
  /** new balances for existing lots (the carry's proportional decay); may only shrink the position */
  | { rebalance: { id: number; remainingWei: bigint }[] };

/**
 * Post a ledger row and apply the matching lot operation atomically.
 * Returns the new lot id on a credit. A non-zero delta with no lot op is refused; a
 * zero delta with no op is the one informational row (the withdrawal fee memo).
 */
export function postAlpha(
  db: DB, playerId: number, deltaWei: bigint, kind: string, ref: string, now: number,
  op?: LotOp,
): number | undefined {
  return withTx(db, () => {
    let lotId: number | undefined;
    if (!op) {
      if (deltaWei !== 0n) throw new EngineError('bad_amount', 'ledger delta without a lot operation');
    } else if ('credit' in op) {
      const { wei, acquiredAt, source } = op.credit;
      if (wei <= 0n || wei !== deltaWei) throw new EngineError('bad_amount', 'credit does not match the ledger delta');
      const r = db.prepare(
        `INSERT INTO alpha_lots (player_id, remaining_wei, acquired_at, source) VALUES (?, ?, ?, ?)`
      ).run(playerId, wei.toString(), acquiredAt, source);
      lotId = Number(r.lastInsertRowid);
    } else if ('consume' in op) {
      let sum = 0n;
      for (const step of op.consume) {
        if (step.take <= 0n) throw new EngineError('bad_amount', 'consume step must be positive');
        const lot = db.prepare(`SELECT player_id, remaining_wei FROM alpha_lots WHERE id = ?`).get(step.id) as
          { player_id: number; remaining_wei: string } | undefined;
        if (!lot || lot.player_id !== playerId) throw new EngineError('not_yours', 'lot does not belong to this player');
        const rest = BigInt(lot.remaining_wei) - step.take;
        if (rest < 0n) throw new EngineError('insufficient_alpha', 'not enough ALPHA');
        if (rest === 0n) db.prepare(`DELETE FROM alpha_lots WHERE id = ?`).run(step.id);
        else db.prepare(`UPDATE alpha_lots SET remaining_wei = ? WHERE id = ?`).run(rest.toString(), step.id);
        sum += step.take;
      }
      if (sum !== -deltaWei) throw new EngineError('bad_amount', 'consumption does not match the ledger delta');
    } else {
      let before = 0n, after = 0n;
      for (const e of op.rebalance) {
        if (e.remainingWei < 0n) throw new EngineError('bad_amount', 'lot cannot go negative');
        const lot = db.prepare(`SELECT player_id, remaining_wei FROM alpha_lots WHERE id = ?`).get(e.id) as
          { player_id: number; remaining_wei: string } | undefined;
        if (!lot || lot.player_id !== playerId) throw new EngineError('not_yours', 'lot does not belong to this player');
        before += BigInt(lot.remaining_wei);
        after += e.remainingWei;
        if (e.remainingWei === 0n) db.prepare(`DELETE FROM alpha_lots WHERE id = ?`).run(e.id);
        else db.prepare(`UPDATE alpha_lots SET remaining_wei = ? WHERE id = ?`).run(e.remainingWei.toString(), e.id);
      }
      if (after > before) throw new EngineError('bad_amount', 'rebalance cannot create value');
      if (after - before !== deltaWei) throw new EngineError('bad_amount', 'rebalance does not match the ledger delta');
    }
    db.prepare(
      `INSERT INTO alpha_ledger (player_id, delta_wei, kind, ref, at) VALUES (?, ?, ?, ?, ?)`
    ).run(playerId, deltaWei.toString(), kind, ref, now);
    return lotId;
  });
}

// ----- balances (a fold over lots) -------------------------------------------

export function alphaBalance(db: DB, playerId: number): bigint {
  const rows = db.prepare(`SELECT remaining_wei FROM alpha_lots WHERE player_id = ?`)
    .all(playerId) as { remaining_wei: string }[];
  return rows.reduce((a, r) => a + BigInt(r.remaining_wei), 0n);
}

export function unseasonedBalance(db: DB, playerId: number, now = Date.now()): bigint {
  const cutoff = now - VALVE.seasoningDays * DAY_MS;
  const rows = db.prepare(
    `SELECT remaining_wei FROM alpha_lots WHERE player_id = ? AND acquired_at > ?`
  ).all(playerId, cutoff) as { remaining_wei: string }[];
  return rows.reduce((a, r) => a + BigInt(r.remaining_wei), 0n);
}

export function lotsOf(db: DB, playerId: number): LotRow[] {
  return db.prepare(
    `SELECT id, remaining_wei, acquired_at FROM alpha_lots WHERE player_id = ?`
  ).all(playerId) as unknown as LotRow[];
}

/** The ALPHA CAPTURE primitive (sell-leg fees, the §13.A/§13.D carry). Policy
 * ammunition, never operator revenue (ECONOMY.md §3.4). */
export function treasuryAlphaAdd(db: DB, wei: bigint): void {
  const t = db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string };
  db.prepare(`UPDATE treasury_alpha SET wei = ? WHERE id = 1`)
    .run((BigInt(t.wei) + wei).toString());
}

// ----- the drift audit (A15, tested) ------------------------------------------

/** Per player: the ledger fold must equal the lots fold. Any writer that bypasses the
 * gate, or any gate bug, shows up here as a named player. BigInt fold in JS — SQLite's
 * SUM over TEXT would silently coerce. */
export function alphaDriftAudit(db: DB): { holds: boolean; drifted: { playerId: number; ledgerWei: string; lotsWei: string }[] } {
  const ledger = new Map<number, bigint>();
  for (const r of db.prepare(`SELECT player_id, delta_wei FROM alpha_ledger`).all() as { player_id: number; delta_wei: string }[]) {
    ledger.set(r.player_id, (ledger.get(r.player_id) ?? 0n) + BigInt(r.delta_wei));
  }
  const lots = new Map<number, bigint>();
  for (const r of db.prepare(`SELECT player_id, remaining_wei FROM alpha_lots`).all() as { player_id: number; remaining_wei: string }[]) {
    lots.set(r.player_id, (lots.get(r.player_id) ?? 0n) + BigInt(r.remaining_wei));
  }
  const drifted: { playerId: number; ledgerWei: string; lotsWei: string }[] = [];
  for (const id of new Set([...ledger.keys(), ...lots.keys()])) {
    const l = ledger.get(id) ?? 0n;
    const t = lots.get(id) ?? 0n;
    if (l !== t) drifted.push({ playerId: id, ledgerWei: l.toString(), lotsWei: t.toString() });
  }
  return { holds: drifted.length === 0, drifted };
}
