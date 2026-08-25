/**
 * The cash-out valve, game side (ECONOMY.md §9). The contract enforces only what the
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
 * The fee stays inside the contract as un-owed surplus — that is the boundary-fee revenue
 * of ECONOMY.md §3, and it is exactly why the reserve is a >= and not an ==.
 *
 * ALPHA is BigInt wei everywhere. Nothing is stored as a float.
 */
import { randomBytes } from 'node:crypto';
import type { DB } from './db.js';
import { withTx, EngineError } from './engine.js';
import { ALPHA_BASE_UNITS, VALVE, ALPHA_CARRY, type WithdrawalStatus, type AlphaView, type WithdrawalView } from '@outfox/shared';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const WEI_PER_ALPHA = ALPHA_BASE_UNITS;

interface LotRow { id: number; remaining_wei: string; acquired_at: number }
interface WdRow {
  id: number; nonce: string; player_id: number; to_address: string;
  gross_wei: string; fee_wei: string; net_wei: string;
  status: WithdrawalStatus; requested_at: number; vests_at: number;
  deadline: number | null; signature: string | null; tx_hash: string | null;
}

/** A voucher nonce must be unique in the CONTRACT's permanent nonce space, not just in
 * this database — a row id would collide with an already-burned nonce after a DB restore
 * or across two instances of the server. 256 random bits cannot collide in practice. */
function newNonce(): string {
  // u64: the settlement program's nonce space (a PDA seed on Solana)
  return BigInt('0x' + randomBytes(8).toString('hex')).toString();
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

/** The single alpha_ledger writer — settlement and the exchange both post through it. */
export function postAlpha(
  db: DB, playerId: number, deltaWei: bigint, kind: string, ref: string, now: number,
): void {
  db.prepare(
    `INSERT INTO alpha_ledger (player_id, delta_wei, kind, ref, at) VALUES (?, ?, ?, ?, ?)`
  ).run(playerId, deltaWei.toString(), kind, ref, now);
}

// ----- the ALPHA carry (ECONOMY.md §13.A + §13.D) ------------------------------

const BPS = 10_000n;
const IDLE_BPS = BigInt(ALPHA_CARRY.idleRatePerDayBps);
const PROG_BPS = BigInt(ALPHA_CARRY.progRatePerDayBps);
const SHELTER_WEI = BigInt(ALPHA_CARRY.progShelterAlpha) * WEI_PER_ALPHA;

function treasuryAlphaAdd(db: DB, wei: bigint): void {
  const t = db.prepare(`SELECT wei FROM treasury_alpha WHERE id = 1`).get() as { wei: string };
  db.prepare(`UPDATE treasury_alpha SET wei = ? WHERE id = 1`)
    .run((BigInt(t.wei) + wei).toString());
}

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
    for (let i = 0; i < lots.length; i++) {
      if (bal[i].toString() === lots[i].remaining_wei) continue;
      if (bal[i] === 0n) db.prepare(`DELETE FROM alpha_lots WHERE id = ?`).run(lots[i].id);
      else db.prepare(`UPDATE alpha_lots SET remaining_wei = ? WHERE id = ?`)
        .run(bal[i].toString(), lots[i].id);
    }
    treasuryAlphaAdd(db, captured);
    postAlpha(db, playerId, -captured, 'carry', `carry:${days}d`, now);
  });
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
    db.prepare(
      `INSERT INTO alpha_lots (player_id, remaining_wei, acquired_at, source)
       VALUES (?, ?, ?, 'deposit')`
    ).run(w.player_id, amountWei.toString(), now);
    postAlpha(db, w.player_id, amountWei, 'deposit', `${txHash}:${logIndex}`, now);
  });
}

// ----- R2: wallet linking ------------------------------------------------------

export function issueLinkNonce(db: DB, playerId: number, now = Date.now()): string {
  const nonce = randomBytes(16).toString('hex');
  db.prepare(
    `INSERT INTO wallet_nonces (nonce, player_id, expires_at) VALUES (?, ?, ?)`
  ).run(nonce, playerId, now + 10 * 60 * 1000);
  return nonce;
}

export function consumeLinkNonce(db: DB, playerId: number, nonce: string, now = Date.now()): void {
  const row = db.prepare(`SELECT player_id, expires_at FROM wallet_nonces WHERE nonce = ?`)
    .get(nonce) as { player_id: number; expires_at: number } | undefined;
  if (!row || row.player_id !== playerId) throw new EngineError('bad_nonce', 'link request not found');
  if (row.expires_at < now) throw new EngineError('bad_nonce', 'link request expired — try again');
  db.prepare(`DELETE FROM wallet_nonces WHERE nonce = ?`).run(nonce);
}

/** Link a proven-controlled wallet and promote to R2. Claims any deposits that arrived at
 * this address before it was linked. One wallet ↔ one player: an address already linked
 * elsewhere is rejected rather than silently re-pointed. */
export function linkWallet(db: DB, playerId: number, address: string, now = Date.now()): void {
  // base58 is case-sensitive: callers pass the canonical form (PublicKey.toBase58()),
  // and it is stored and compared verbatim.
  const addr = address;
  withTx(db, () => {
    const taken = db.prepare(`SELECT player_id FROM wallets WHERE address = ?`).get(addr) as
      { player_id: number } | undefined;
    if (taken && taken.player_id !== playerId) {
      throw new EngineError('wallet_taken', 'that wallet is already linked to another Fox');
    }
    const mine = db.prepare(`SELECT address FROM wallets WHERE player_id = ?`).get(playerId) as
      { address: string } | undefined;
    if (mine && mine.address !== addr) {
      throw new EngineError('already_linked', 'this account already has a linked wallet');
    }
    if (!taken) {
      db.prepare(`INSERT INTO wallets (address, player_id, linked_at) VALUES (?, ?, ?)`)
        .run(addr, playerId, now);
    }
    const p = db.prepare(`SELECT rung FROM players WHERE id = ?`).get(playerId) as { rung: number };
    if (p.rung < 2) db.prepare(`UPDATE players SET rung = 2 WHERE id = ?`).run(playerId);

    // claim deposits that landed before the link (held, not lost)
    applyAlphaCarry(db, playerId, now); // settle existing lots before new ones land
    const held = db.prepare(
      `SELECT tx_hash, log_index, amount_wei, at FROM unclaimed_deposits WHERE address = ?`
    ).all(addr) as { tx_hash: string; log_index: number; amount_wei: string; at: number }[];
    for (const h of held) {
      // The lot keeps its arrival clock for seasoning (§13.C), but the held wait pays
      // the §13.A idle decay — otherwise "deposit unlinked, link once seasoned" would
      // age out the surcharge while dodging the holding cost the sim charges for that
      // patience. Base rate only: unclaimed value belongs to no identity, and a
      // per-address progressive would be trivially split-dodged anyway.
      const heldDays = Math.floor((now - h.at) / DAY_MS);
      const net = idleDecayCompound(BigInt(h.amount_wei), heldDays);
      const decay = BigInt(h.amount_wei) - net;
      db.prepare(
        `INSERT INTO alpha_lots (player_id, remaining_wei, acquired_at, source)
         VALUES (?, ?, ?, 'deposit')`
      ).run(playerId, net.toString(), h.at);
      postAlpha(db, playerId, BigInt(h.amount_wei), 'deposit', `${h.tx_hash}:${h.log_index}`, h.at);
      if (decay > 0n) {
        treasuryAlphaAdd(db, decay);
        postAlpha(db, playerId, -decay, 'carry', `carry:held:${heldDays}d`, now);
      }
      db.prepare(`DELETE FROM unclaimed_deposits WHERE tx_hash = ? AND log_index = ?`)
        .run(h.tx_hash, h.log_index);
    }
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
    const lots = db.prepare(
      `SELECT id, remaining_wei, acquired_at FROM alpha_lots WHERE player_id = ?`
    ).all(playerId) as LotRow[];
    const { feeWei, plan } = priceWithdrawal(lots, grossWei, now);
    const netWei = grossWei - feeWei;

    // V6 — solvency: never promise more than the reserve can pay. Counts what is already
    // owed to OTHER unconfirmed vouchers, so concurrent requests cannot oversubscribe it.
    const owed = outstandingNet(db) + netWei;
    if (owed > reserveWei) {
      throw new EngineError('reserve_low', 'cash-out is temporarily unavailable — try later');
    }

    for (const step of plan) {
      const lot = db.prepare(`SELECT remaining_wei FROM alpha_lots WHERE id = ?`).get(step.id) as
        { remaining_wei: string };
      const rest = BigInt(lot.remaining_wei) - step.take;
      if (rest === 0n) db.prepare(`DELETE FROM alpha_lots WHERE id = ?`).run(step.id);
      else db.prepare(`UPDATE alpha_lots SET remaining_wei = ? WHERE id = ?`).run(rest.toString(), step.id);
    }

    const vestsAt = now + VALVE.vestingDays * DAY_MS;
    const r = db.prepare(
      `INSERT INTO withdrawals
         (nonce, player_id, to_address, gross_wei, fee_wei, net_wei, status, requested_at, vests_at)
       VALUES (?, ?, ?, ?, ?, ?, 'vesting', ?, ?)`
    ).run(newNonce(), playerId, w.address, grossWei.toString(), feeWei.toString(),
          netWei.toString(), now, vestsAt);
    const id = Number(r.lastInsertRowid);

    postAlpha(db, playerId, -grossWei, 'withdraw_request', `wd:${id}`, now);
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
 * itself is produced in chain.ts (the only holder of the key), then stored via
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
  // re-sign cannot double-pay — the contract burns that nonce exactly once.
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
 * this contract — simply matches nothing, which is the correct no-op. */
export function markWithdrawalConfirmed(db: DB, nonce: string, txHash: string): void {
  db.prepare(
    `UPDATE withdrawals SET status = 'confirmed', tx_hash = ?
     WHERE nonce = ? AND status != 'confirmed'`
  ).run(txHash, nonce);
}

// ----- views -------------------------------------------------------------------

export function withdrawalView(db: DB, id: number, now = Date.now()): WithdrawalView {
  const w = getWithdrawal(db, id);
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
 * the exchange pool's inventory, and the ALPHA treasury — so nothing in the ledger is
 * ever unbacked. Fees the contract keeps are un-owed surplus (ECONOMY.md §3 boundary-fee
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
  const liabilities = balances + outstandingNet(db)
    + BigInt(pool?.alpha_wei ?? '0') + BigInt(treasury?.wei ?? '0');
  return {
    holds: reserveWei >= liabilities,
    reserveWei: reserveWei.toString(),
    liabilitiesWei: liabilities.toString(),
    surplusWei: (reserveWei - liabilities).toString(),
  };
}
