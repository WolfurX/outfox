import type { DB } from './db.js';
import type { PrivyConfig } from '../identity/privy.js';
import type { ChainConfig } from '../chain/adapter.js';
import { EngineError } from './errors.js';

/** Per-route rate-limit config (@fastify/rate-limit, route-scoped). */
export interface RouteLimit { rateLimit: { max: number; timeWindow: number } }

/** Everything a route group needs from the composition root. */
export interface Ctx {
  db: DB;
  /** SIWS and wallet-link messages bind to this origin. */
  origin: string;
  /** Dev email+code adapter and the /api/verify/dev stub (never in production). */
  devAuth: boolean;
  privy: PrivyConfig | null;
  chain: ChainConfig | null;
  rl: { bootstrap: RouteLimit; auth: RouteLimit };
}

export function requireChain(ctx: Ctx): ChainConfig {
  if (!ctx.chain) throw new EngineError('chain_off', 'the chain edge is not configured');
  return ctx.chain;
}
