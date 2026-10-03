/** The player's Scrip ledger, and the debug-only audits (never registered in a real deploy). */
import type { FastifyInstance } from 'fastify';
import { type Ctx, requireChain } from '../core/ctx.js';
import { requirePlayer } from '../identity/sessions.js';
import { applyCarry } from '../economy/carry.js';
import { conservationAudit, ledgerView } from './scrip.js';
import { alphaDriftAudit } from './alpha.js';
import { solvencyAudit } from '../economy/valve.js';
import { exchangeAudit } from '../economy/exchange.js';
import { finalizedReserveFor } from '../chain/adapter.js';

export function registerLedgerRoutes(app: FastifyInstance, ctx: Ctx, debug: boolean): void {
  const { db } = ctx;

  app.get('/api/ledger', async (req) => {
    const playerId = requirePlayer(db, req);
    applyCarry(db, playerId); // keep the ledger read consistent with playerView's lazy carry
    return { rows: ledgerView(db, playerId) };
  });

  // debug-only audits: registered ONLY when OUTFOX_DEBUG is set — never in a real deploy
  if (debug) {
    app.get('/api/debug/conservation', async () => conservationAudit(db));
    app.get('/api/debug/alpha-drift', async () => alphaDriftAudit(db));
    app.get('/api/debug/solvency', async () => solvencyAudit(db, await finalizedReserveFor(requireChain(ctx))));
    app.get('/api/debug/exchange', async () => exchangeAudit(db));
  }
}
