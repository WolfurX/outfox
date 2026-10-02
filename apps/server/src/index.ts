/**
 * Outfox game server — composition root (ARCHITECTURE.md §3). Server-authoritative
 * (GDD pillar 4): the client is a renderer; every outcome, price, and balance decision
 * happens in the modules registered here. This file holds env, plugins, and wiring only.
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { fileURLToPath } from 'node:url';
import { openDb } from './core/db.js';
import type { Ctx } from './core/ctx.js';
import { EngineError } from './core/errors.js';
import { privyConfigFromEnv } from './identity/privy.js';
import { chainConfigFromEnv } from './chain/adapter.js';
import { startIndexer } from './chain/indexer.js';
import { launchConfigFromEnv, registerLaunchRoutes } from './chain/launch.js';
import { getPool, seedExchange } from './economy/exchange.js';
import { registerIdentityRoutes } from './identity/routes.js';
import { registerLedgerRoutes } from './ledger/routes.js';
import { registerCallRoutes } from './systems/calls/routes.js';
import { registerGigRoutes } from './systems/gigs/routes.js';
import { registerRefillRoutes } from './systems/refills/routes.js';
import { registerMarketRoutes } from './systems/market/routes.js';
import { registerEconomyRoutes } from './economy/routes.js';
import { ALPHA_BASE_UNITS } from '@outfox/shared';

const DB_PATH = process.env.OUTFOX_DB ?? fileURLToPath(new URL('../outfox.sqlite', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);

const db = openDb(DB_PATH);
// trustProxy makes req.ip come from X-Forwarded-For. Set OUTFOX_TRUST_PROXY=1 ONLY
// behind Caddy (deploy/Caddyfile) — trusted on a directly-exposed server, the header
// becomes a rate-limit bypass. Off (dev/tests), the socket address is the key and
// forged XFF headers are ignored.
// The value is a HOP COUNT of 1 (trust exactly the Caddy hop), never boolean true:
// with `true` Fastify trusts every hop and req.ip becomes the LEFTMOST XFF entry,
// which the client controls — Caddy appends to client-supplied XFF rather than
// stripping it, so `true` would let an attacker pick their own rate-limit bucket
// per request (adversarial review 2026-08-31; regression: rate-limit-proxy.test.ts).
const app = Fastify({
  logger: { level: 'warn' },
  trustProxy: process.env.OUTFOX_TRUST_PROXY === '1' ? 1 : false,
});
await app.register(cookie);

// Per-IP limits on the row-minting / brute-forceable surfaces only (deploy/README
// gap #1): bootstrap mints player+session rows, the register/nonce/link routes mint
// nonce rows or take guessable secrets. Gameplay routes are session-gated and priced
// in Focus/Risk Appetite; /healthz stays unlimited for the uptime monitor.
await app.register(rateLimit, {
  global: false,
  // Thrown through setErrorHandler; the marker (not the generic statusCode) is what
  // the handler keys on, so an upstream 429 can never be mislabeled rate_limited.
  errorResponseBuilder: (_req, context) => {
    const err = new Error(`rate limit exceeded, retry in ${context.after}`) as Error & {
      statusCode: number; rateLimited: true;
    };
    err.statusCode = context.statusCode;
    err.rateLimited = true;
    return err;
  },
});
// Limits are PER ROUTE per IP (each route config gets its own counter store) — the
// auth surface as a whole allows n_routes × 10/min from one IP, which is fine: the
// real brute-force bounds are engine-side (e.g. 5 attempts per email code).
const RL_WINDOW_MS = 60_000;

const chain = chainConfigFromEnv();
const ctx: Ctx = {
  db,
  origin: process.env.OUTFOX_ORIGIN ?? 'localhost:5173',
  devAuth: !!process.env.OUTFOX_DEV_AUTH,
  privy: privyConfigFromEnv(),
  chain,
  launch: launchConfigFromEnv(),
  rl: {
    bootstrap: { rateLimit: { max: 30, timeWindow: RL_WINDOW_MS } },
    auth: { rateLimit: { max: 10, timeWindow: RL_WINDOW_MS } },
    public: { rateLimit: { max: 60, timeWindow: RL_WINDOW_MS } },
  },
};

// --- liveness probe (deploy/README.md gap #2): unauthenticated, like /api/launch (public
// chain data, chain/launch.ts). Reveals liveness only: no config, versions, or balances.
let lastIndexOk: number | null = null;
app.get('/healthz', async () => {
  db.prepare(`SELECT 1`).get(); // DB gone -> throws -> 500 via the error handler
  return {
    ok: true,
    chain: !!chain,
    // ms since the last successful indexer pass; null when chain is off or no pass yet
    indexerAgeMs: lastIndexOk === null ? null : Date.now() - lastIndexOk,
  };
});

registerIdentityRoutes(app, ctx);
registerCallRoutes(app, ctx);
registerGigRoutes(app, ctx);
registerRefillRoutes(app, ctx);
registerMarketRoutes(app, ctx);
registerLedgerRoutes(app, ctx, !!process.env.OUTFOX_DEBUG);
registerEconomyRoutes(app, ctx);
registerLaunchRoutes(app, ctx);

// Dev worlds seed the exchange pool from env; PRODUCTION seeding is an explicit operator
// step through poolSeedFromDeposit, after a real treasury deposit backs the inventory
// (exchange.ts E6). Depth at launch is a pending owner decision — this dev default
// mirrors the sim's calibrated amm_credit0/amm_vig0 (e0 = 100 Scrip per ALPHA).
if (process.env.OUTFOX_DEV_SEED_EXCHANGE && !getPool(db)) {
  seedExchange(db, 3_000_000, 30_000n * ALPHA_BASE_UNITS, 'dev-genesis');
  console.log('[exchange] dev pool seeded (3,000,000 Scrip / 30,000 ALPHA)');
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof EngineError) {
    reply.code(err.code === 'no_session' ? 401 : 400).send({ error: err.message, code: err.code });
  } else if ((err as { rateLimited?: boolean }).rateLimited) {
    // @fastify/rate-limit (our errorResponseBuilder) throws through here; keep the
    // client-facing error shape. retry-after/x-ratelimit headers are already set.
    reply.code(429).send({ error: 'too many requests, give it a minute', code: 'rate_limited' });
  } else {
    app.log.error(err);
    reply.code(500).send({ error: 'internal error' });
  }
});

// Tests import the app and drive it with inject(); only a real run listens.
// Gate on NODE_ENV (vitest sets it to 'test') rather than a custom flag a deploy
// env could carry by accident — production sets NODE_ENV=production explicitly.
export { app };

if (process.env.NODE_ENV !== 'test') {
  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`outfox game server on :${PORT} (db: ${DB_PATH})`);

  if (chain) {
    startIndexer(db, chain, 5_000, (m) => console.log(`[indexer] ${m}`), () => { lastIndexOk = Date.now(); });
    console.log(`[indexer] watching program ${chain.programId.toBase58()} on chain ${chain.chainId}`);
  } else {
    console.log('[indexer] chain edge not configured (set OUTFOX_RPC_URL / _CHAIN_ID / _PROGRAM_ID)');
  }
}
