/**
 * Sessions (ARCHITECTURE.md A6): an opaque random token in an httpOnly cookie, hashed
 * at rest, looked up per request. No JWT: one process, one database, instant revoke.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { DB } from '../core/db.js';
import { EngineError } from '../core/errors.js';

export const COOKIE = 'fox_session';

type CookieReq = { cookies: Record<string, string | undefined> };

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

export function sessionPlayer(db: DB, req: CookieReq): number | null {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT player_id FROM sessions WHERE token_hash = ?`).get(hash(token)) as
    { player_id: number } | undefined;
  return row?.player_id ?? null;
}

export function requirePlayer(db: DB, req: CookieReq): number {
  const id = sessionPlayer(db, req);
  if (id === null) throw new EngineError('no_session', 'no session — bootstrap first');
  return id;
}

/** Mint a session for a (new) player and set the cookie. */
export function mintSession(db: DB, reply: FastifyReply, playerId: number, now = Date.now()): void {
  const token = randomBytes(32).toString('hex');
  db.prepare(`INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)`)
    .run(hash(token), playerId, now);
  reply.setCookie(COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365,
    // deploy gate: behind TLS this MUST be true; false only serves the localhost slice
    secure: process.env.NODE_ENV === 'production',
  });
}

/** Collision resolution: re-point the current session at the existing account. */
export function rebindSession(db: DB, req: CookieReq, playerId: number): void {
  const token = req.cookies[COOKIE];
  if (!token) throw new EngineError('no_session', 'no session — bootstrap first');
  db.prepare(`UPDATE sessions SET player_id = ? WHERE token_hash = ?`).run(playerId, hash(token));
}
