import { describe, it, expect, beforeEach } from 'vitest';
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { openDb, type DB } from '../src/db.js';
import { createPlayer, postTx, registerVerified, adoptVerified, EngineError } from '../src/engine.js';
import { verifyPrivyToken, privyConfigFromEnv, type PrivyConfig } from '../src/auth-privy.js';

// The Privy R1 adapter's security boundary: offline ES256 identity-token verification.
// Tokens are minted here with a local keypair — the exact shape the server expects —
// and every rejection path is attacked explicitly.

const { publicKey: PUB, privateKey: PRIV } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const { privateKey: EVIL } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const CFG: PrivyConfig = { appId: 'app-test-123', key: PUB };

const b64url = (o: object | string) =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

function mint(
  claims: Record<string, unknown>,
  { key = PRIV, header = { alg: 'ES256', typ: 'JWT' } }: { key?: KeyObject; header?: object } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const full = { iss: 'privy.io', aud: CFG.appId, sub: 'did:privy:test', exp: now + 3600, ...claims };
  const body = `${b64url(header)}.${b64url(full)}`;
  const sig = cryptoSign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' });
  return `${body}.${sig.toString('base64url')}`;
}

const emailAccounts = (addr: string) => JSON.stringify([{ type: 'email', address: addr }]);

describe('verifyPrivyToken', () => {
  it('accepts a valid identity token and extracts the email account', () => {
    const t = mint({ linked_accounts: emailAccounts('fox@example.com') });
    expect(verifyPrivyToken(t, CFG)).toEqual({ email: 'fox@example.com', subject: 'did:privy:test' });
  });

  it('extracts the email from a social account shape', () => {
    const t = mint({ linked_accounts: JSON.stringify([{ type: 'google_oauth', email: 'g@example.com' }]) });
    expect(verifyPrivyToken(t, CFG).email).toBe('g@example.com');
  });

  it('falls back to a top-level email claim', () => {
    const t = mint({ email: 'top@example.com' });
    expect(verifyPrivyToken(t, CFG).email).toBe('top@example.com');
  });

  it('rejects a signature from the wrong key', () => {
    const t = mint({ linked_accounts: emailAccounts('fox@example.com') }, { key: EVIL });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/could not be verified/);
  });

  it('rejects a tampered payload', () => {
    const t = mint({ linked_accounts: emailAccounts('fox@example.com') });
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url({ iss: 'privy.io', aud: CFG.appId, exp: 9e9, email: 'evil@example.com' })}.${s}`;
    expect(() => verifyPrivyToken(forged, CFG)).toThrow(/could not be verified/);
  });

  it('rejects alg=none outright', () => {
    const body = `${b64url({ alg: 'none' })}.${b64url({ iss: 'privy.io', aud: CFG.appId, exp: 9e9 })}`;
    expect(() => verifyPrivyToken(`${body}.`, CFG)).toThrow(/could not be verified/);
  });

  it('rejects an HS256 downgrade', () => {
    const t = mint({ email: 'x@example.com' }, { header: { alg: 'HS256', typ: 'JWT' } });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/could not be verified/);
  });

  it('rejects an expired token', () => {
    const t = mint({ exp: Math.floor(Date.now() / 1000) - 10, email: 'x@example.com' });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/expired/);
  });

  it('rejects a not-yet-valid token (nbf in the future)', () => {
    const t = mint({ nbf: Math.floor(Date.now() / 1000) + 600, email: 'x@example.com' });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/could not be verified/);
  });

  it('rejects a wrong audience (another app’s token)', () => {
    const t = mint({ aud: 'someone-elses-app', email: 'x@example.com' });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/could not be verified/);
  });

  it('rejects a wrong issuer', () => {
    const t = mint({ iss: 'evil.example', email: 'x@example.com' });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/could not be verified/);
  });

  it('rejects malformed input', () => {
    expect(() => verifyPrivyToken('not.a-jwt', CFG)).toThrow(/could not be verified/);
    expect(() => verifyPrivyToken('', CFG)).toThrow(/could not be verified/);
  });

  it('rejects a wallet-only login with an actionable message', () => {
    const t = mint({ linked_accounts: JSON.stringify([{ type: 'wallet', address: '0xabc' }]) });
    expect(() => verifyPrivyToken(t, CFG)).toThrow(/email or social/);
  });
});

describe('privyConfigFromEnv', () => {
  it('returns null when unset (dev-auth mode)', () => {
    expect(privyConfigFromEnv({})).toBeNull();
  });

  it('parses an escaped-newline PEM and verifies with it', () => {
    const pem = PUB.export({ type: 'spki', format: 'pem' }).toString().replace(/\n/g, '\\n');
    const cfg = privyConfigFromEnv({ OUTFOX_PRIVY_APP_ID: CFG.appId, OUTFOX_PRIVY_VERIFICATION_KEY: pem });
    expect(cfg).not.toBeNull();
    const t = mint({ email: 'env@example.com' });
    expect(verifyPrivyToken(t, cfg!).email).toBe('env@example.com');
  });
});

describe('registerVerified / adoptVerified (§10.1 semantics, verified-identity path)', () => {
  let db: DB;
  let p: number;

  beforeEach(() => {
    db = openDb(':memory:');
    p = createPlayer(db);
  });

  const rungOf = (id: number) =>
    (db.prepare(`SELECT rung FROM players WHERE id = ?`).get(id) as { rung: number }).rung;

  it('upgrades R0 -> R1 in place with continuity', () => {
    postTx(db, p, 500, 0, 'gig', 'fund');
    const r = registerVerified(db, p, 'Fox@Example.com');
    expect(r).toEqual({});
    const row = db.prepare(`SELECT rung, email, scrip_settled FROM players WHERE id = ?`).get(p) as
      { rung: number; email: string; scrip_settled: number };
    expect(row).toEqual({ rung: 1, email: 'fox@example.com', scrip_settled: 500 });
  });

  it('re-presenting the same identity is a no-op success', () => {
    registerVerified(db, p, 'fox@example.com');
    expect(registerVerified(db, p, 'fox@example.com')).toEqual({});
    expect(rungOf(p)).toBe(1);
  });

  it('never demotes a higher rung', () => {
    db.prepare(`UPDATE players SET rung = 2 WHERE id = ?`).run(p);
    registerVerified(db, p, 'fox@example.com');
    expect(rungOf(p)).toBe(2);
  });

  it('a collision returns the choose sheet and mutates nothing', () => {
    const q = createPlayer(db);
    registerVerified(db, q, 'taken@example.com');
    const r = registerVerified(db, p, 'taken@example.com');
    expect(r.collision).toBeDefined();
    expect(rungOf(p)).toBe(0);
    const mine = db.prepare(`SELECT email FROM players WHERE id = ?`).get(p) as { email: string | null };
    expect(mine.email).toBeNull();
  });

  it('an account with a different email cannot be re-pointed', () => {
    registerVerified(db, p, 'first@example.com');
    expect(() => registerVerified(db, p, 'second@example.com')).toThrow(EngineError);
  });

  it('adoptVerified resolves the collision to the existing account', () => {
    const q = createPlayer(db);
    registerVerified(db, q, 'taken@example.com');
    expect(adoptVerified(db, 'Taken@Example.com')).toBe(q);
  });

  it('adoptVerified refuses an unknown email', () => {
    expect(() => adoptVerified(db, 'ghost@example.com')).toThrow(/not found/);
  });
});
