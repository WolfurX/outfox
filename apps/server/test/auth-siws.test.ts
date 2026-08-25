import { describe, it, expect, beforeEach } from 'vitest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { openDb, type DB } from '../src/db.js';
import { createPlayer, registerVerified, adoptVerified, EngineError } from '../src/engine.js';
import { signInMessage, siwsSubject, verifySignIn } from '../src/auth-siws.js';
import { linkMessage } from '../src/chain.js';

// The SIWS R1 adapter's security boundary: a wallet signature over a purpose-bound,
// nonce-bound message. Every rejection path is attacked explicitly, and the verified
// subject flows through the same §10.1 collision semantics the Privy adapter used.

const ORIGIN = 'localhost:5173';
const kp = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3));
const evil = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(4));
const ADDR = bs58.encode(kp.publicKey);

const signWith = (k: nacl.SignKeyPair, msg: string) =>
  bs58.encode(nacl.sign.detached(Buffer.from(msg, 'utf8'), k.secretKey));

describe('SIWS signature verification', () => {
  const msg = signInMessage('abc123', ORIGIN);

  it('accepts a valid signature from the claimed wallet', () => {
    expect(verifySignIn(ADDR, msg, signWith(kp, msg))).toBe(true);
  });

  it('rejects a signature from a different wallet', () => {
    expect(verifySignIn(ADDR, msg, signWith(evil, msg))).toBe(false);
  });

  it('rejects a signature over a different nonce', () => {
    const other = signInMessage('zzz999', ORIGIN);
    expect(verifySignIn(ADDR, msg, signWith(kp, other))).toBe(false);
  });

  it('rejects a harvested R2 LINK signature (purpose separation)', () => {
    const link = linkMessage('abc123', ORIGIN);
    expect(verifySignIn(ADDR, msg, signWith(kp, link))).toBe(false);
  });

  it('rejects garbage addresses and signatures without throwing', () => {
    expect(verifySignIn('not-a-key', msg, signWith(kp, msg))).toBe(false);
    expect(verifySignIn(ADDR, msg, 'lol')).toBe(false);
    expect(verifySignIn(ADDR, msg, '')).toBe(false);
  });
});

describe('SIWS subjects through the §10.1 register/adopt seam', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('registers a wallet subject and upgrades the rung in place', () => {
    const p = createPlayer(db);
    const r = registerVerified(db, p, siwsSubject(ADDR));
    expect(r.collision).toBeUndefined();
    const row = db.prepare(`SELECT rung, email FROM players WHERE id = ?`).get(p) as
      { rung: number; email: string };
    expect(row.rung).toBe(1);
    expect(row.email).toBe(`siws:${ADDR}`);
  });

  it('a second account with the same wallet gets the collision sheet, never a merge', () => {
    const a = createPlayer(db);
    registerVerified(db, a, siwsSubject(ADDR));
    const b = createPlayer(db);
    const r = registerVerified(db, b, siwsSubject(ADDR));
    expect(r.collision).toBeDefined();
    expect(adoptVerified(db, siwsSubject(ADDR))).toBe(a);
  });

  it('wallet subjects and emails live in disjoint namespaces', () => {
    const a = createPlayer(db);
    registerVerified(db, a, siwsSubject(ADDR));
    const b = createPlayer(db);
    // an email that happens to contain the pubkey text cannot collide
    const r = registerVerified(db, b, `${ADDR.toLowerCase()}@example.com`);
    expect(r.collision).toBeUndefined();
  });

  it('rejects a malformed wallet subject', () => {
    const p = createPlayer(db);
    expect(() => registerVerified(db, p, 'siws:NOT_BASE58!!')).toThrow(EngineError);
  });

  it('adopt of an unknown wallet subject fails closed', () => {
    expect(() => adoptVerified(db, siwsSubject(bs58.encode(evil.publicKey)))).toThrow(EngineError);
  });
});
