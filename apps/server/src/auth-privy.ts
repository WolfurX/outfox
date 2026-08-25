/**
 * Privy R1 auth adapter — server half, the security boundary (DESIGN-SYSTEM-WEB §10.2).
 *
 * The client authenticates with Privy (email/social; the embedded account is created
 * silently — no wallet UI moment) and presents Privy's IDENTITY TOKEN: an ES256 JWT
 * signed by the app's key. Verification is fully OFFLINE against the app's
 * dashboard-published verification key (SPKI PEM) — no call to Privy on the hot path,
 * no availability coupling, and unit tests mint tokens with a local keypair.
 *
 * Hand-rolled compact-JWS verification is deliberate: single pinned algorithm, single
 * static key, closed claim set — and no vendor dependency before a production
 * Privy app is configured.
 * Hardening in force:
 *   - `alg` is pinned to ES256; `none`/HS256/anything-else is rejected outright
 *     (the classic downgrade/confusion attacks);
 *   - the signature is raw r||s (IEEE P1363) over `header.payload`;
 *   - `iss` must be privy.io, `aud` must equal the configured app id, `exp` must be
 *     in the future (and `nbf`, when present, in the past).
 * When the release app exists, @privy-io/server-auth can replace the internals as a
 * drop-in behind verifyPrivyToken() — and the claim shapes below get re-verified
 * against the live app as part of that go-live pass.
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { EngineError } from './engine.js';

export interface PrivyConfig {
  appId: string;
  key: KeyObject; // ES256 (P-256) public key, from the dashboard's SPKI PEM
}

/** Reads OUTFOX_PRIVY_APP_ID + OUTFOX_PRIVY_VERIFICATION_KEY (PEM; `\n` escapes ok).
 * Returns null when unset — the server then runs the dev-auth adapter only. */
export function privyConfigFromEnv(env = process.env): PrivyConfig | null {
  const appId = env.OUTFOX_PRIVY_APP_ID;
  const pem = env.OUTFOX_PRIVY_VERIFICATION_KEY;
  if (!appId || !pem) return null;
  return { appId, key: createPublicKey(pem.replace(/\\n/g, '\n')) };
}

const b64urlJson = (part: string): Record<string, unknown> => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  } catch {
    throw new EngineError('bad_token', 'sign-in could not be verified — try again');
  }
};

/** Privy identity tokens carry `linked_accounts` as a JSON-encoded STRING of an array
 * of account objects. Email-bearing shapes: {type:'email', address} for direct email
 * login; {type:'google_oauth'|'apple_oauth'|..., email} for socials. R1 needs an email
 * (the collision model keys on it), so wallet-only Privy logins are rejected with a
 * actionable message rather than silently minting an email-less registration. */
function extractEmail(claims: Record<string, unknown>): string {
  let accounts: unknown = claims.linked_accounts;
  if (typeof accounts === 'string') {
    try { accounts = JSON.parse(accounts); } catch { accounts = []; }
  }
  if (Array.isArray(accounts)) {
    for (const a of accounts as Record<string, unknown>[]) {
      if (a && a.type === 'email' && typeof a.address === 'string') return a.address;
      if (a && typeof a.email === 'string') return a.email;
    }
  }
  if (typeof claims.email === 'string') return claims.email; // tolerant fallback
  throw new EngineError('no_email', 'sign in with an email or social account to register');
}

export interface PrivyIdentity { email: string; subject: string }

export function verifyPrivyToken(token: string, cfg: PrivyConfig, now = Date.now()): PrivyIdentity {
  const parts = token.split('.');
  if (parts.length !== 3) throw new EngineError('bad_token', 'sign-in could not be verified — try again');
  const [h, p, s] = parts;

  const header = b64urlJson(h);
  if (header.alg !== 'ES256') {
    throw new EngineError('bad_token', 'sign-in could not be verified — try again');
  }

  let sig: Buffer;
  try { sig = Buffer.from(s, 'base64url'); } catch { sig = Buffer.alloc(0); }
  const ok = sig.length === 64 && cryptoVerify(
    'sha256',
    Buffer.from(`${h}.${p}`, 'utf8'),
    { key: cfg.key, dsaEncoding: 'ieee-p1363' },
    sig,
  );
  if (!ok) throw new EngineError('bad_token', 'sign-in could not be verified — try again');

  const claims = b64urlJson(p);
  if (claims.iss !== 'privy.io') throw new EngineError('bad_token', 'sign-in could not be verified — try again');
  if (claims.aud !== cfg.appId) throw new EngineError('bad_token', 'sign-in could not be verified — try again');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
    throw new EngineError('token_expired', 'sign-in expired — try again');
  }
  if (typeof claims.nbf === 'number' && claims.nbf * 1000 > now) {
    throw new EngineError('bad_token', 'sign-in could not be verified — try again');
  }

  return { email: extractEmail(claims), subject: String(claims.sub ?? '') };
}
