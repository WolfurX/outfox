/**
 * The economy engine. Server-authoritative: every value decision happens here.
 *
 * Invariants (tested in test/engine.test.ts):
 *  I1 — Provenance firewall: Unsettled Scrip (chance origin) can NEVER move between
 *       players or fund a market purchase. It is spendable on sinks only. There is no
 *       code path that converts Unsettled to Settled. (ECONOMY.md §6 guardrail #1.)
 *  I2 — Single mutation gate: every balance change goes through postTx(), which writes
 *       a provenance-tagged ledger row and rejects overdrafts atomically.
 *  I3 — Conservation: sum(player balances) + treasury == sum(faucet mints). Fees,
 *       sinks, and carry (demurrage) move value to the treasury (CAPTURE) — nothing
 *       vanishes, nothing appears outside a mint.
 *  I4 — Chance pays Unsettled only; deterministic work (Gigs) pays Settled only.
 */
import { randomInt } from 'node:crypto';
import type { DB } from './db.js';
import {
  CALLS, GIG, REGEN, REFILL, DEMURRAGE, MARKET_FEE_BPS,
  type CallDef, type Provenance, type PlayerView, type ItemKind,
  type ListingView, type LedgerRow, ITEM_KINDS,
} from '@outfox/shared';

const DAY_MS = 86_400_000;

export class EngineError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/** Crash-atomic wrapper for multi-statement mutations. Savepoints nest, so engine ops
 * can compose (buyListing → postTx) without tracking transaction state. */
let txDepth = 0;
export function withTx<T>(db: DB, fn: () => T): T {
  const name = `sp${txDepth++}`;
  db.exec(`SAVEPOINT ${name}`);
  try {
    const result = fn();
    db.exec(`RELEASE ${name}`);
    return result;
  } catch (e) {
    db.exec(`ROLLBACK TO ${name}`);
    db.exec(`RELEASE ${name}`);
    throw e;
  } finally {
    txDepth--;
  }
}

/** Uniform [0,1) from crypto randomness — Math.random (xorshift128+) is state-recoverable
 * from observed payouts, which is unacceptable for money-bearing rolls.
 * (crypto.randomInt requires range < 2^48, hence 2^48 − 1.) */
const ROLL_RANGE = 2 ** 48 - 1;
const cryptoRoll = () => randomInt(0, ROLL_RANGE) / ROLL_RANGE;

interface PlayerRow {
  id: number; handle: string; created_at: number;
  focus: number; focus_at: number; risk: number; risk_at: number;
  scrip_settled: number; scrip_unsettled: number;
  gig_count: number; carry_at: number;
  rung: number; email: string | null;
}

/** Actions that require R1 (registered) — the market write surfaces. Reads stay R0.
 * (DESIGN-SYSTEM-WEB §10.1: listings/sales are R1; the demanding surface triggers the
 * upgrade.) */
export function requireRung(db: DB, playerId: number, min: number): void {
  const p = getPlayer(db, playerId);
  if (p.rung < min) throw new EngineError('rung_required', 'register to trade on the Open Market');
}

// ----- players ------------------------------------------------------------

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

function getPlayer(db: DB, id: number): PlayerRow {
  const p = db.prepare(`SELECT * FROM players WHERE id = ?`).get(id) as PlayerRow | undefined;
  if (!p) throw new EngineError('no_player', 'unknown player');
  return p;
}

// ----- I2: the single mutation gate ----------------------------------------

export function postTx(
  db: DB, playerId: number, dSettled: number, dUnsettled: number,
  kind: Provenance, ref: string, now = Date.now(),
): void {
  if (!Number.isInteger(dSettled) || !Number.isInteger(dUnsettled)) {
    throw new EngineError('bad_amount', 'money is integer ¢');
  }
  const p = getPlayer(db, playerId);
  const s = p.scrip_settled + dSettled;
  const u = p.scrip_unsettled + dUnsettled;
  if (s < 0 || u < 0) throw new EngineError('insufficient', 'insufficient Scrip');
  withTx(db, () => {
    db.prepare(`UPDATE players SET scrip_settled = ?, scrip_unsettled = ? WHERE id = ?`)
      .run(s, u, playerId);
    db.prepare(
      `INSERT INTO ledger (player_id, d_settled, d_unsettled, kind, ref, at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(playerId, dSettled, dUnsettled, kind, ref, now);
  });
}

/** The Scrip CAPTURE primitive — fees, carry, and exchange fees all land here. */
export function treasuryAdd(db: DB, amount: number): void {
  db.prepare(`UPDATE treasury SET scrip = scrip + ? WHERE id = 1`).run(amount);
}

// ----- lazy regen + carry (demurrage) ---------------------------------------

function computeBar(stored: number, at: number, perSec: number, max: number, now: number): number {
  return Math.min(max, stored + ((now - at) / 1000) * perSec);
}

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

function spendBar(db: DB, p: PlayerRow, bar: 'focus' | 'risk', cost: number, now: number): void {
  const perSec = bar === 'focus' ? REGEN.focusPerSec : REGEN.riskPerSec;
  const max = bar === 'focus' ? REGEN.focusMax : REGEN.riskMax;
  const cur = computeBar(p[bar], p[`${bar}_at`], perSec, max, now);
  if (cur < cost) throw new EngineError('low_bar', bar === 'focus' ? 'not enough Focus' : 'not enough Risk Appetite');
  db.prepare(`UPDATE players SET ${bar} = ?, ${bar}_at = ? WHERE id = ?`).run(cur - cost, now, p.id);
}

// ----- cooldowns ------------------------------------------------------------

function checkCooldown(db: DB, playerId: number, actionId: string, now: number): void {
  const row = db.prepare(
    `SELECT ready_at FROM cooldowns WHERE player_id = ? AND action_id = ?`
  ).get(playerId, actionId) as { ready_at: number } | undefined;
  if (row && row.ready_at > now) throw new EngineError('cooldown', 'still cooling down');
}

function setCooldown(db: DB, playerId: number, actionId: string, readyAt: number): void {
  db.prepare(
    `INSERT INTO cooldowns (player_id, action_id, ready_at) VALUES (?, ?, ?)
     ON CONFLICT (player_id, action_id) DO UPDATE SET ready_at = excluded.ready_at`
  ).run(playerId, actionId, readyAt);
}

// ----- actions ---------------------------------------------------------------

export interface CallOutcome { ok: boolean; payout: number; nicked: boolean }

/** A Call: chance action. Pays UNSETTLED only (I4). Server rolls the outcome. */
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

/** The Gig: deterministic work. Pays SETTLED (I4); every Nth completion yields a tool. */
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

/** Refill a bar: a SINK. Unsettled is spendable here (allowed destination), used first. */
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

// ----- the Open Market (I1 lives here) ---------------------------------------

export function listItem(db: DB, playerId: number, itemId: number, price: number, now = Date.now()): void {
  requireRung(db, playerId, 1); // §10.1: listing is the canonical demanding surface
  if (!Number.isInteger(price) || price < 1 || price > 1_000_000) {
    // words, not glyphs: server strings render as plain text and carry no SVG marks
    throw new EngineError('bad_amount', 'price must be between 1 and 1,000,000 Scrip');
  }
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(itemId) as
    { id: number; owner_id: number; listed: number } | undefined;
  if (!item || item.owner_id !== playerId) throw new EngineError('not_yours', 'not your item');
  if (item.listed) throw new EngineError('already_listed', 'already on the book');
  withTx(db, () => {
    db.prepare(`UPDATE items SET listed = 1 WHERE id = ?`).run(itemId);
    db.prepare(`INSERT INTO listings (item_id, seller_id, price, created_at) VALUES (?, ?, ?, ?)`)
      .run(itemId, playerId, price, now);
  });
}

export function cancelListing(db: DB, playerId: number, listingId: number): void {
  const l = db.prepare(`SELECT * FROM listings WHERE id = ? AND active = 1`).get(listingId) as
    { id: number; item_id: number; seller_id: number } | undefined;
  if (!l || l.seller_id !== playerId) throw new EngineError('not_yours', 'not your listing');
  withTx(db, () => {
    db.prepare(`UPDATE listings SET active = 0 WHERE id = ?`).run(listingId);
    db.prepare(`UPDATE items SET listed = 0 WHERE id = ?`).run(l.item_id);
  });
}

/**
 * Buy: SETTLED SCRIP ONLY (I1 — the firewall at the P2P boundary). The UI never offers
 * Unsettled here; the engine enforces it regardless. Fee → treasury (CAPTURE).
 */
export function buyListing(db: DB, playerId: number, listingId: number, now = Date.now()): void {
  requireRung(db, playerId, 1); // P2P value transfer gates at R1 (§10.1)
  withTx(db, () => {
    applyCarry(db, playerId, now);
    const l = db.prepare(`SELECT * FROM listings WHERE id = ? AND active = 1`).get(listingId) as
      { id: number; item_id: number; seller_id: number; price: number } | undefined;
    if (!l) throw new EngineError('gone', 'listing is gone');
    if (l.seller_id === playerId) throw new EngineError('own_listing', 'that is your own listing');
    const buyer = getPlayer(db, playerId);
    if (buyer.scrip_settled < l.price) {
      // Deliberately NOT total-balance: Unsettled cannot fund a P2P purchase.
      throw new EngineError('insufficient_settled', 'not enough Settled Scrip');
    }
    // Settle the seller's carry clock BEFORE crediting — otherwise stale carry_at
    // decays the proceeds for idle days that preceded the sale (over-capture).
    applyCarry(db, l.seller_id, now);
    const fee = Math.ceil((l.price * MARKET_FEE_BPS) / 10_000);
    postTx(db, playerId, -l.price, 0, 'market_buy', `listing:${l.id}`, now);
    postTx(db, l.seller_id, l.price - fee, 0, 'market_sale', `listing:${l.id}`, now);
    treasuryAdd(db, fee);
    db.prepare(`UPDATE listings SET active = 0 WHERE id = ?`).run(l.id);
    db.prepare(`UPDATE items SET owner_id = ?, listed = 0 WHERE id = ?`).run(playerId, l.item_id);
  });
}

// ----- R1 identity upgrade (§10.1) -------------------------------------------
// Slice auth adapter: an email + one-time code, dev-returned. The production adapter
// (Privy embedded wallet, DESIGN-SYSTEM-WEB §10.2) replaces startRegister/verifyRegister
// wholesale — the rung model, the demanding-surface gate, and the collision rule stay.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function startRegister(db: DB, email: string, now = Date.now()): string {
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new EngineError('bad_email', 'enter a valid email');
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  db.prepare(
    `INSERT INTO auth_codes (email, code, expires_at, attempts) VALUES (?, ?, ?, 0)
     ON CONFLICT (email) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, attempts = 0`
  ).run(e, code, now + 10 * 60 * 1000);
  return code; // dev adapter returns it; production emails it
}

export interface VerifyResult { collision?: { existingHandle: string } }

/** Verify the code and upgrade R0 -> R1 in place (§10.1 continuity: Scrip, items, stats,
 * cooldowns all persist — same account row). If the email already belongs to another
 * player, do NOT merge or overwrite: return the collision for the client's choose sheet. */
export function verifyRegister(db: DB, playerId: number, email: string, code: string, now = Date.now()): VerifyResult {
  const e = String(email).trim().toLowerCase();
  return withTx(db, () => {
    const rec = db.prepare(`SELECT code, expires_at, attempts FROM auth_codes WHERE email = ?`).get(e) as
      { code: string; expires_at: number; attempts: number } | undefined;
    if (!rec || rec.expires_at < now) throw new EngineError('code_expired', 'code expired — request a new one');
    if (rec.attempts >= 5) throw new EngineError('too_many', 'too many attempts — request a new code');
    if (rec.code !== String(code)) {
      db.prepare(`UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ?`).run(e);
      throw new EngineError('bad_code', 'wrong code');
    }
    const existing = db.prepare(`SELECT id, handle FROM players WHERE email = ?`).get(e) as
      { id: number; handle: string } | undefined;
    if (existing && existing.id !== playerId) {
      // credential collision — the client shows the choose sheet; nothing is mutated here
      return { collision: { existingHandle: existing.handle } };
    }
    const me = getPlayer(db, playerId);
    if (me.email && me.email !== e) throw new EngineError('already_registered', 'this account already has an email');
    db.prepare(`UPDATE players SET rung = 1, email = ? WHERE id = ?`).run(e, playerId);
    db.prepare(`DELETE FROM auth_codes WHERE email = ?`).run(e);
    return {};
  });
}

/** Production adapter path (Privy, §10.2): the email arrives ALREADY VERIFIED — the
 * route validated the identity token before calling here. Same §10.1 semantics as
 * verifyRegister minus the code machinery: upgrade in place (continuity — same account
 * row), and a credential collision returns the choose sheet, never a merge. */
export function registerVerified(db: DB, playerId: number, email: string): VerifyResult {
  const e = String(email).trim().toLowerCase();
  if (!EMAIL_RE.test(e)) throw new EngineError('bad_email', 'that sign-in has no usable email');
  return withTx(db, () => {
    const existing = db.prepare(`SELECT id, handle FROM players WHERE email = ?`).get(e) as
      { id: number; handle: string } | undefined;
    if (existing && existing.id !== playerId) {
      return { collision: { existingHandle: existing.handle } };
    }
    const me = getPlayer(db, playerId);
    if (me.email && me.email !== e) throw new EngineError('already_registered', 'this account already has an email');
    db.prepare(`UPDATE players SET rung = MAX(rung, 1), email = ? WHERE id = ?`).run(e, playerId);
    return {};
  });
}

/** Collision resolution for the verified-identity path: the presented (and re-verified)
 * token IS the authority — no code record to consume. Returns the existing player id
 * for the caller to rebind the session; the guest row is retired as in adoptExistingAccount. */
export function adoptVerified(db: DB, email: string): number {
  const e = String(email).trim().toLowerCase();
  const existing = db.prepare(`SELECT id FROM players WHERE email = ?`).get(e) as { id: number } | undefined;
  if (!existing) throw new EngineError('gone', 'account not found');
  return existing.id;
}

/** Collision resolution: continue as the existing account. The current guest session
 * re-points to it; the guest account is retired (its Scrip does not transfer — stated on
 * the sheet, §10.1). Returns the existing player id for the caller to rebind the session. */
export function adoptExistingAccount(db: DB, guestId: number, email: string, now = Date.now()): number {
  const e = String(email).trim().toLowerCase();
  return withTx(db, () => {
    const rec = db.prepare(`SELECT expires_at FROM auth_codes WHERE email = ?`).get(e) as
      { expires_at: number } | undefined;
    if (!rec || rec.expires_at < now) throw new EngineError('code_expired', 'verification expired — start over');
    const existing = db.prepare(`SELECT id FROM players WHERE email = ?`).get(e) as { id: number } | undefined;
    if (!existing) throw new EngineError('gone', 'account not found');
    db.prepare(`DELETE FROM auth_codes WHERE email = ?`).run(e);
    // The retired guest row is left in place (its ledger stays auditable); the session
    // rebinds to `existing.id`. A real system would tombstone/GC guests on a schedule.
    return existing.id;
  });
}

// ----- views -----------------------------------------------------------------

/** NOTE: deliberately side-effectful read — carry (demurrage) applies lazily on first
 * touch of the day, so any state-returning endpoint may post a Carry ledger row. This is
 * the designed lazy-decay model; the /api/ledger route applies it too for consistency. */
export function playerView(db: DB, playerId: number, now = Date.now()): PlayerView {
  applyCarry(db, playerId, now);
  const p = getPlayer(db, playerId);
  const items = db.prepare(`SELECT id, kind, listed FROM items WHERE owner_id = ?`).all(playerId) as
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

export function listingsView(db: DB, playerId: number): ListingView[] {
  const rows = db.prepare(
    `SELECT l.id, l.price, l.seller_id, i.kind, p.handle
     FROM listings l JOIN items i ON i.id = l.item_id JOIN players p ON p.id = l.seller_id
     WHERE l.active = 1 ORDER BY l.id DESC LIMIT 100`
  ).all() as { id: number; price: number; seller_id: number; kind: ItemKind; handle: string }[];
  return rows.map((r) => ({
    id: r.id, itemKind: r.kind, price: r.price, seller: r.handle, mine: r.seller_id === playerId,
  }));
}

export function ledgerView(db: DB, playerId: number, limit = 50): LedgerRow[] {
  const rows = db.prepare(
    `SELECT id, d_settled, d_unsettled, kind, ref, at FROM ledger
     WHERE player_id = ? ORDER BY id DESC LIMIT ?`
  ).all(playerId, limit) as { id: number; d_settled: number; d_unsettled: number; kind: Provenance; ref: string; at: number }[];
  return rows.map((r) => ({
    id: r.id, settled: r.d_settled, unsettled: r.d_unsettled, kind: r.kind, ref: r.ref, at: r.at,
  }));
}

// ----- I3: conservation audit (used by tests and a debug endpoint) -------------

export function conservationAudit(db: DB): { holds: boolean; playerTotal: number; treasury: number; minted: number } {
  const bal = db.prepare(
    `SELECT COALESCE(SUM(scrip_settled + scrip_unsettled), 0) AS t FROM players`
  ).get() as { t: number };
  const treas = (db.prepare(`SELECT scrip FROM treasury WHERE id = 1`).get() as { scrip: number }).scrip;
  // Mints: the two faucets, plus the exchange pool's protocol-minted Scrip side (the
  // sim books pool liquidity as an in-ledger mint — audit-2). Pool Scrip counts as a
  // holder below; trades only move value between players, treasury, and the pool.
  const minted = db.prepare(
    `SELECT (SELECT COALESCE(SUM(d_settled + d_unsettled), 0) FROM ledger WHERE kind IN ('call','gig'))
          + (SELECT COALESCE(SUM(credit_in), 0) FROM exchange_events WHERE kind = 'seed') AS t`
  ).get() as { t: number };
  const pool = db.prepare(
    `SELECT COALESCE((SELECT credit_cents FROM exchange_pool WHERE id = 1), 0) AS t`
  ).get() as { t: number };
  // per-player ledger ↔ balance agreement
  const drift = db.prepare(
    `SELECT COUNT(*) AS n FROM players p WHERE
       (SELECT COALESCE(SUM(d_settled), 0) FROM ledger WHERE player_id = p.id) != p.scrip_settled
    OR (SELECT COALESCE(SUM(d_unsettled), 0) FROM ledger WHERE player_id = p.id) != p.scrip_unsettled`
  ).get() as { n: number };
  const holds = bal.t + treas + pool.t === minted.t && drift.n === 0;
  return { holds, playerTotal: bal.t, treasury: treas, minted: minted.t };
}
