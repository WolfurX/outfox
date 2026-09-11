/**
 * The identity ladder's R1 step (DESIGN-SYSTEM-WEB §10.1, Solana translation in
 * ARCHITECTURE.md §9). Two adapters, one set of semantics: upgrade the SAME account in
 * place (Scrip, items, stats, cooldowns persist), never merge, never demote a rung, and
 * a credential collision returns the choose sheet instead of mutating anything.
 *
 * Dev adapter: an email + one-time code, returned in the response (chainless worlds and
 * tests). Verified adapters (SIWS, Privy): the subject arrives already proven by the
 * route and lands in registerVerified / adoptVerified.
 */
import { randomInt } from 'node:crypto';
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';
import { withTx } from '../core/tx.js';
import { getPlayer } from '../ledger/scrip.js';

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

/** Verify the code and upgrade R0 -> R1 in place. If the email already belongs to
 * another player, do NOT merge or overwrite: return the collision for the choose sheet. */
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
    // never demote: a dev re-registration of an R2 account keeps R2 (PRD FR-ID-5)
    db.prepare(`UPDATE players SET rung = MAX(rung, 1), email = ? WHERE id = ?`).run(e, playerId);
    db.prepare(`DELETE FROM auth_codes WHERE email = ?`).run(e);
    return {};
  });
}

/** A verified subject is an email (Privy/dev path) or a `siws:<pubkey>` wallet subject
 * (SIWS path). Both live in the players.email column; the prefix keeps the namespaces
 * disjoint so a wallet subject can never collide with a real email. */
function canonicalSubject(subject: string): string {
  const s = String(subject).trim();
  if (s.startsWith('siws:')) {
    const pk = s.slice(5);
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(pk)) {
      throw new EngineError('bad_subject', 'that sign-in has no usable wallet');
    }
    return `siws:${pk}`;
  }
  const e = s.toLowerCase();
  if (!EMAIL_RE.test(e)) throw new EngineError('bad_email', 'that sign-in has no usable email');
  return e;
}

/** Verified-adapter path: the subject is ALREADY PROVEN (the route verified the
 * signature or token). Same semantics as verifyRegister minus the code machinery. */
export function registerVerified(db: DB, playerId: number, subject: string): VerifyResult {
  const e = canonicalSubject(subject);
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

/** Collision resolution for the verified path: the presented (and re-verified) proof IS
 * the authority — no code record to consume. Returns the existing player id for the
 * caller to rebind the session; the guest row is retired as in adoptExistingAccount. */
export function adoptVerified(db: DB, subject: string): number {
  const e = canonicalSubject(subject);
  const existing = db.prepare(`SELECT id FROM players WHERE email = ?`).get(e) as { id: number } | undefined;
  if (!existing) throw new EngineError('gone', 'account not found');
  return existing.id;
}

/** Collision resolution (dev adapter): continue as the existing account. The current
 * guest session re-points to it; the guest account is retired (its Scrip does not
 * transfer — stated on the sheet, §10.1). Returns the existing player id. */
export function adoptExistingAccount(db: DB, guestId: number, email: string, now = Date.now()): number {
  const e = String(email).trim().toLowerCase();
  void guestId;
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
