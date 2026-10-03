/**
 * The cash-out valve, game side (ECONOMY.md §9). The program enforces only what the
 * chain must; EVERY economic gate lives here and runs BEFORE a voucher is ever signed:
 *
 *   V1 — Rung gate: cash-out requires R3 (verified). Deposits/linking need only R2.
 *   V2 — Seasoning (§13.C): withdrawals consume SEASONED lots first; any unseasoned
 *        remainder pays the surcharge. Every acquisition path starts a fresh clock, so
 *        taint cannot be wash-traded away — time is the thing that can't be laundered.
 *   V3 — Fee: phi_wd on the gross (a sink + spam/sybil disincentive).
 *   V4 — Vesting: the voucher is unclaimable until it vests (damps hot-potato dumping,
 *        gives anti-fraud a window). Price risk is borne through the wait.
 *   V5 — Per-identity rolling weekly cap (w_cap).
 *   V6 — Solvency: the game can never owe more ALPHA than the Settlement reserve holds.
 *
 * Invariant (tested): reserve() >= sum(player balances) + sum(unconfirmed withdrawal net).
 * The fee stays inside the escrow as un-owed surplus — that is the boundary-fee revenue
 * of ECONOMY.md §3, and it is exactly why the reserve is a >= and not an ==.
 *
 * Every lot movement goes through the A15 gate (`ledger/alpha.ts`). ALPHA is BigInt
 * base units everywhere. Nothing is stored as a float.
 */
import { randomBytes } from 'node:crypto';
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import { DAY_MS, WEEK_MS } from '../core/time.js';
import {
  postAlpha, alphaBalance, unseasonedBalance, lotsOf, type LotRow,
} from '../ledger/alpha.js';
import { applyAlphaCarry } from './carry.js';
import { ALPHA_BASE_UNITS, VALVE, type WithdrawalStatus, type AlphaView, type WithdrawalView } from '@outfox/shared';

const WEI_PER_ALPHA = ALPHA_BASE_UNITS;

type WdRow = {
  id: number; nonce: string; player_id: number; to_address: string;
  gross_wei: string; fee_wei: string; net_wei: string;
  status: WithdrawalStatus; requested_at: number; vests_at: number;
  deadline: number | null; signature: string | null; tx_hash: string | null;
};

/** A voucher nonce must be unique in the PROGRAM's permanent nonce space, not just in
 * this database — a row id would collide with an already-burned nonce after a DB restore
 * or across two instances of the server. Random u64 (the program's nonce PDA seed). */
function newNonce(): string {
  return BigInt('0x' + randomBytes(8).toString('hex')).toString();
}

// ----- deposits (called by the indexer) ---------------------------------------

/** Credit a confirmed on-chain deposit. Idempotency is the indexer's (tx_hash, log_index)
 * key — this function assumes the event is fresh. A deposit from an address no player has
 * linked is HELD (unclaimed_deposits), never lost: linking the wallet later claims it. */
export function creditDeposit(
  db: DB, address: string, amountWei: bigint, txHash: string, logIndex: number,
  now = Date.now(),
): void {
  // base58 is case-sensitive: callers pass the canonical form (PublicKey.toBase58()),
  // and it is stored and compared verbatim.
  const addr = address;
  withTx(db, () => {
    const w = db.prepare(`SELECT player_id FROM wallets WHERE address = ?`).get(addr) as
      { player_id: number } | undefined;
    if (!w) {
      db.prepare(
        `INSERT OR IGNORE INTO unclaimed_deposits (tx_hash, log_index, address, amount_wei, at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(txHash, logIndex, addr, amountWei.toString(), now);
      return;
    }
    // Settle the carry clock BEFORE the lot lands — a stale clock would decay the
    // fresh deposit for idle days that preceded it (the buyListing precedent).
    applyAlphaCarry(db, w.player_id, now);
    // §13.C: a deposit is a NEW acquisition — the lot starts unseasoned.
    postAlpha(db, w.player_id, amountWei, 'deposit', `${txHash}:${logIndex}`, now, {
      credit: { wei: amountWei, acquiredAt: now, source: 'deposit' },
    });
  });
}

// ----- V5: the rolling weekly cap ---------------------------------------------

export function weeklyWithdrawn(db: DB, playerId: number, now = Date.now()): bigint {
  const rows = db.prepare(
    `SELECT gross_wei FROM withdrawals
     WHERE player_id = ? AND requested_at > ? AND status != 'cancelled'`
  ).all(playerId, now - WEEK_MS) as { gross_wei: string }[];
  return rows.reduce((a, r) => a + BigInt(r.gross_wei), 0n);
}

export function weeklyRemaining(db: DB, playerId: number, now = Date.now()): bigint {
  const cap = BigInt(VALVE.weeklyCapAlpha) * WEI_PER_ALPHA;
  const used = weeklyWithdrawn(db, playerId, now);
  return used >= cap ? 0n : cap - used;
}

// ----- the withdrawal request (all gates) --------------------------------------

/** V2+V3: split the gross across seasoned/unseasoned lots and price the fee. Pure — takes
 * the lots, returns the fee and the lot consumption plan. */
export function priceWithdrawal(
  lots: LotRow[], grossWei: bigint, now: number,
): { feeWei: bigint; unseasonedWei: bigint; plan: { id: number; take: bigint }[] } {
  const cutoff = now - VALVE.seasoningDays * DAY_MS;
  // seasoned first (attacker-optimal for the PLAYER is to keep unseasoned; the house
  // takes seasoned first so the surcharge bites exactly the freshly-acquired value)
  const ordered = [...lots].sort((a, b) => a.acquired_at - b.acquired_at);
  let left = grossWei;
  let unseasoned = 0n;
  const plan: { id: number; take: bigint }[] = [];
  for (const lot of ordered) {
    if (left === 0n) break;
    const avail = BigInt(lot.remaining_wei);
    if (avail === 0n) continue;
    const take = avail < left ? avail : left;
    plan.push({ id: lot.id, take });
    if (lot.acquired_at > cutoff) unseasoned += take;
    left -= take;
  }
  if (left > 0n) throw new EngineError('insufficient_alpha', 'not enough ALPHA');
  const base = (grossWei * BigInt(VALVE.feeBps)) / 10_000n;
  const surcharge = (unseasoned * BigInt(VALVE.unseasonedSurchargeBps)) / 10_000n;
  return { feeWei: base + surcharge, unseasonedWei: unseasoned, plan };
}

export function requestWithdrawal(
  db: DB, playerId: number, grossWei: bigint, reserveWei: bigint, now = Date.now(),
): WithdrawalView {
  if (grossWei <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
  return withTx(db, () => {
    // Settle the carry BEFORE pricing: the patient route pays §13.A/§13.D for the
    // wait (the M4 patient-mule gap — sim/M4-CONTRACT-LOOP.md scope limits).
    applyAlphaCarry(db, playerId, now);
    const p = db.prepare(`SELECT rung FROM players WHERE id = ?`).get(playerId) as
      { rung: number } | undefined;
    if (!p) throw new EngineError('no_player', 'unknown player');
    // V1 — the identity gate. The ONLY surface that ever demands verification.
    if (p.rung < VALVE.minRung) {
      throw new EngineError('rung_required', 'verify your identity to cash out');
    }
    const w = db.prepare(`SELECT address FROM wallets WHERE player_id = ?`).get(playerId) as
      { address: string } | undefined;
    if (!w) throw new EngineError('no_wallet', 'link a wallet first');

    // V5 — rolling weekly cap
    const remaining = weeklyRemaining(db, playerId, now);
    if (grossWei > remaining) {
      throw new EngineError('cap_exceeded', 'that exceeds your weekly cash-out limit');
    }

    // V2 + V3 — seasoning split and fee
    const { feeWei, plan } = priceWithdrawal(lotsOf(db, playerId), grossWei, now);
    const netWei = grossWei - feeWei;

    // V6 — solvency: never promise more than the reserve can pay. Counts what is already
    // owed to OTHER unconfirmed vouchers, so concurrent requests cannot oversubscribe it.
    const owed = outstandingNet(db) + netWei;
    if (owed > reserveWei) {
      throw new EngineError('reserve_low', 'cash-out is temporarily unavailable — try later');
    }

    const vestsAt = now + VALVE.vestingDays * DAY_MS;
    const r = db.prepare(
      `INSERT INTO withdrawals
         (nonce, player_id, to_address, gross_wei, fee_wei, net_wei, status, requested_at, vests_at)
       VALUES (?, ?, ?, ?, ?, ?, 'vesting', ?, ?)`
    ).run(newNonce(), playerId, w.address, grossWei.toString(), feeWei.toString(),
          netWei.toString(), now, vestsAt);
    const id = Number(r.lastInsertRowid);

    // the lots leave the position through the gate, on the plan priced above
    postAlpha(db, playerId, -grossWei, 'withdraw_request', `wd:${id}`, now, { consume: plan });
    postAlpha(db, playerId, 0n, 'withdraw_fee', `wd:${id}:fee:${feeWei}`, now);
    return withdrawalView(db, id, now);
  });
}

/** Net ALPHA the game still owes on vouchers that have not been redeemed on-chain. */
export function outstandingNet(db: DB): bigint {
  const rows = db.prepare(
    `SELECT net_wei FROM withdrawals WHERE status != 'confirmed'`
  ).all() as { net_wei: string }[];
  return rows.reduce((a, r) => a + BigInt(r.net_wei), 0n);
}

// ----- V4: claim (sign the voucher) --------------------------------------------

/** Marks vested rows claimable. Called lazily on read, like carry. */
export function refreshVesting(db: DB, playerId: number, now = Date.now()): void {
  db.prepare(
    `UPDATE withdrawals SET status = 'claimable'
     WHERE player_id = ? AND status = 'vesting' AND vests_at <= ?`
  ).run(playerId, now);
}

export function getWithdrawal(db: DB, id: number): WdRow {
  const r = db.prepare(`SELECT * FROM withdrawals WHERE id = ?`).get(id) as WdRow | undefined;
  if (!r) throw new EngineError('gone', 'withdrawal not found');
  return r;
}

/** Prepare the claim: validates the gates and returns what must be signed. The signature
 * itself is produced in chain/adapter.ts (the only holder of the key), then stored via
 * recordSignedVoucher — so the engine stays synchronous and testable without a key. */
export function prepareClaim(
  db: DB, playerId: number, id: number, now = Date.now(),
): { to: string; amountWei: bigint; nonce: bigint; deadline: bigint } {
  refreshVesting(db, playerId, now);
  const wd = getWithdrawal(db, id);
  if (wd.player_id !== playerId) throw new EngineError('not_yours', 'not your withdrawal');
  if (wd.status === 'confirmed') throw new EngineError('already_paid', 'already cashed out');
  if (wd.status === 'vesting') throw new EngineError('vesting', 'still vesting');
  // 'signed' is re-signable: a voucher can expire unredeemed (or be stranded by a pause),
  // and the player must be able to get a fresh one. The nonce is fixed per row, so a
  // re-sign cannot double-pay — the program burns that nonce exactly once.
  const deadline = BigInt(Math.floor(now / 1000) + VALVE.voucherTtlSec);
  return { to: wd.to_address, amountWei: BigInt(wd.net_wei), nonce: BigInt(wd.nonce), deadline };
}

export function recordSignedVoucher(
  db: DB, id: number, signature: string, deadline: bigint,
): void {
  db.prepare(
    `UPDATE withdrawals SET status = 'signed', signature = ?, deadline = ? WHERE id = ?`
  ).run(signature, Number(deadline), id);
}

/** Called by the indexer when the on-chain Withdrawn event lands. Looked up by the voucher
 * nonce (unique per row). A nonce we never issued — e.g. from a prior deployment sharing
 * this program — simply matches nothing, which is the correct no-op. */
export function markWithdrawalConfirmed(db: DB, nonce: string, txHash: string): void {
  db.prepare(
    `UPDATE withdrawals SET status = 'confirmed', tx_hash = ?
     WHERE nonce = ? AND status != 'confirmed'`
  ).run(txHash, nonce);
}

// ----- views -------------------------------------------------------------------

export function withdrawalView(db: DB, id: number, now = Date.now()): WithdrawalView {
  const w = getWithdrawal(db, id);
  void now;
  return {
    id: w.id,
    grossWei: w.gross_wei,
    feeWei: w.fee_wei,
    netWei: w.net_wei,
    to: w.to_address,
    status: w.status,
    requestedAt: w.requested_at,
    vestsAt: w.vests_at,
    txHash: w.tx_hash ?? undefined,
  };
}

/** Side-effectful read, like playerView: the daily ALPHA carry and vesting refresh
 * both apply lazily on first touch — a state-returning read may post a Carry row. */
export function alphaView(db: DB, playerId: number, now = Date.now()): AlphaView {
  applyAlphaCarry(db, playerId, now);
  refreshVesting(db, playerId, now);
  const wallet = db.prepare(`SELECT address, linked_at FROM wallets WHERE player_id = ?`)
    .get(playerId) as { address: string; linked_at: number } | undefined;
  const wds = db.prepare(
    `SELECT id FROM withdrawals WHERE player_id = ? ORDER BY id DESC LIMIT 20`
  ).all(playerId) as { id: number }[];
  return {
    balanceWei: alphaBalance(db, playerId).toString(),
    unseasonedWei: unseasonedBalance(db, playerId, now).toString(),
    weeklyRemainingWei: weeklyRemaining(db, playerId, now).toString(),
    wallet: wallet ? { address: wallet.address, linkedAt: wallet.linked_at } : null,
    withdrawals: wds.map((w) => withdrawalView(db, w.id, now)),
  };
}

// ----- the solvency audit (V6, tested) ------------------------------------------

/** Proof of reserves, game side: the chain must always hold at least what the game owes.
 * "Owes" counts EVERY ledger-recorded ALPHA holder — player lots, unredeemed vouchers,
 * deposits held for wallets not yet linked, the exchange pool's inventory, and the
 * ALPHA treasury — so nothing in the ledger is ever unbacked. Fees the program keeps are un-owed surplus (ECONOMY.md §3 boundary-fee
 * revenue), so a healthy system runs reserve > liabilities, never below. */
export function solvencyAudit(db: DB, reserveWei: bigint): {
  holds: boolean; reserveWei: string; liabilitiesWei: string; surplusWei: string;
} {
  const balances = (db.prepare(
    `SELECT COALESCE(remaining_wei, '0') AS w FROM alpha_lots`
  ).all() as { w: string }[]).reduce((a, r) => a + BigInt(r.w), 0n);
  const pool = db.prepare(`SELECT alpha_wei FROM exchange_pool WHERE id = 1`).get() as
    { alpha_wei: string } | undefined;
  const treasury = db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as
    { wei: string } | undefined;
  // deposits held for a wallet nobody has linked yet are owed to whoever links it
  const unclaimed = (db.prepare(`SELECT amount_wei AS w FROM unclaimed_deposits`).all() as { w: string }[])
    .reduce((a, r) => a + BigInt(r.w), 0n);
  const liabilities = balances + outstandingNet(db) + unclaimed
    + BigInt(pool?.alpha_wei ?? '0') + BigInt(treasury?.wei ?? '0');
  return {
    holds: reserveWei >= liabilities,
    reserveWei: reserveWei.toString(),
    liabilitiesWei: liabilities.toString(),
    surplusWei: (reserveWei - liabilities).toString(),
  };
}
