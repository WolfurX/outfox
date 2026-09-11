/** Session bootstrap and the identity ladder: R1 (dev, Privy, SIWS), R2 link, R3 dev stub. */
import type { FastifyInstance } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import type { Ctx } from '../core/ctx.js';
import { EngineError } from '../core/errors.js';
import { requirePlayer, sessionPlayer, mintSession, rebindSession } from './sessions.js';
import { createPlayer, playerView } from './players.js';
import {
  startRegister, verifyRegister, adoptExistingAccount, registerVerified, adoptVerified,
} from './rungs.js';
import { verifyPrivyToken } from './privy.js';
import { signInMessage, siwsSubject, verifySignIn } from './siws.js';
import { issueLinkNonce, consumeLinkNonce, linkWallet } from './wallets.js';
import { listingsView } from '../systems/market/rules.js';
import { linkMessage, verifyLinkSignature } from '../chain/adapter.js';
import { alphaView } from '../economy/valve.js';
import { CALLS, GIG } from '@outfox/shared';

export function registerIdentityRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db, origin } = ctx;

  app.post('/api/session/bootstrap', { config: ctx.rl.bootstrap }, async (req, reply) => {
    let playerId = sessionPlayer(db, req);
    if (playerId === null) {
      playerId = createPlayer(db);
      mintSession(db, reply, playerId);
    }
    return {
      player: playerView(db, playerId),
      listings: listingsView(db, playerId),
      catalog: { calls: CALLS, gig: GIG },
      // which R1 adapter the client should drive: SIWS is the production mode on
      // Solana; Privy remains available if configured; the dev email+code sheet is the
      // chainless fallback for tests and local worlds.
      auth: ctx.privy
        ? { mode: 'privy' as const, privyAppId: ctx.privy.appId }
        : ctx.devAuth
          ? { mode: 'dev' as const }
          : { mode: 'siws' as const },
    };
  });

  // --- R1 registration, dev adapter: the code is returned, not emailed. ---
  app.post('/api/register/start', { config: ctx.rl.auth }, async (req) => {
    requirePlayer(db, req);
    const { email } = (req.body ?? {}) as { email?: string };
    const code = startRegister(db, String(email ?? ''));
    return ctx.devAuth ? { ok: true, devCode: code } : { ok: true };
  });

  app.post('/api/register/verify', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const { email, code } = (req.body ?? {}) as { email?: string; code?: string };
    const r = verifyRegister(db, playerId, String(email ?? ''), String(code ?? ''));
    if (r.collision) return { collision: { existingHandle: r.collision.existingHandle } };
    return { player: playerView(db, playerId) };
  });

  // Collision resolution: rebind this session to the existing account (guest retired).
  app.post('/api/register/adopt', { config: ctx.rl.auth }, async (req) => {
    const guestId = requirePlayer(db, req);
    const { email } = (req.body ?? {}) as { email?: string };
    const existingId = adoptExistingAccount(db, guestId, String(email ?? ''));
    rebindSession(db, req, existingId);
    return { player: playerView(db, existingId), listings: listingsView(db, existingId) };
  });

  // --- R1 verified adapter (Privy, dormant on the Solana track). One route, both
  // steps: the verified identity token both registers and — on `adopt` — resolves a
  // collision. The token is re-verified on every call. ---
  app.post('/api/register/privy', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    if (!ctx.privy) throw new EngineError('not_configured', 'this server does not use Privy sign-in');
    const { token, adopt } = (req.body ?? {}) as { token?: string; adopt?: boolean };
    const identity = verifyPrivyToken(String(token ?? ''), ctx.privy);
    if (adopt) {
      const existingId = adoptVerified(db, identity.email);
      rebindSession(db, req, existingId);
      return { player: playerView(db, existingId), listings: listingsView(db, existingId) };
    }
    const r = registerVerified(db, playerId, identity.email);
    if (r.collision) return { collision: { existingHandle: r.collision.existingHandle } };
    return { player: playerView(db, playerId) };
  });

  // --- R1 production adapter (SIWS). Two steps: a nonce challenge, then the signed
  // message both registers and — on `adopt` — resolves a collision. The signature is
  // verified on every call; the message is purpose-bound (never the R2 link message). ---
  app.post('/api/register/siws/nonce', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const nonce = issueLinkNonce(db, playerId);
    return { nonce, message: signInMessage(nonce, origin) };
  });

  app.post('/api/register/siws', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const { address, nonce, signature, adopt } = (req.body ?? {}) as
      { address?: string; nonce?: string; signature?: string; adopt?: boolean };
    let subject: string;
    try {
      subject = siwsSubject(String(address ?? ''));
    } catch {
      throw new EngineError('bad_address', 'that is not a valid wallet address');
    }
    consumeLinkNonce(db, playerId, String(nonce ?? ''));
    const ok = verifySignIn(String(address), signInMessage(String(nonce), origin), String(signature ?? ''));
    if (!ok) throw new EngineError('bad_signature', 'signature does not match that wallet');
    if (adopt) {
      const existingId = adoptVerified(db, subject);
      rebindSession(db, req, existingId);
      return { player: playerView(db, existingId), listings: listingsView(db, existingId) };
    }
    const r = registerVerified(db, playerId, subject);
    if (r.collision) return { collision: { existingHandle: r.collision.existingHandle } };
    return { player: playerView(db, playerId) };
  });

  // --- R2: link a wallet by proving control (a purpose-bound message, never sign-in) ---
  app.post('/api/wallet/nonce', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const nonce = issueLinkNonce(db, playerId);
    return { nonce, message: linkMessage(nonce, origin) };
  });

  app.post('/api/wallet/link', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const { address, nonce, signature } = (req.body ?? {}) as
      { address?: string; nonce?: string; signature?: string };
    let addr: string;
    try {
      addr = new PublicKey(String(address ?? '')).toBase58();
    } catch {
      throw new EngineError('bad_address', 'that is not a valid wallet address');
    }
    consumeLinkNonce(db, playerId, String(nonce ?? ''));
    const ok = await verifyLinkSignature(addr, linkMessage(String(nonce), origin), String(signature ?? ''));
    if (!ok) throw new EngineError('bad_signature', 'signature does not match that wallet');
    linkWallet(db, playerId, addr);
    return { player: playerView(db, playerId), alpha: alphaView(db, playerId) };
  });

  // --- R3 verification, dev stub: the real one is proof of personhood at cash-out only
  //     (PRD FR-ID-6, owner decision). Enabled only under OUTFOX_DEV_AUTH so a real
  //     deploy cannot mint verified identities. ---
  app.post('/api/verify/dev', { config: ctx.rl.auth }, async (req) => {
    if (!ctx.devAuth) throw new EngineError('not_available', 'unavailable');
    const playerId = requirePlayer(db, req);
    db.prepare(`UPDATE players SET rung = 3 WHERE id = ? AND rung >= 2`).run(playerId);
    return { player: playerView(db, playerId) };
  });
}
