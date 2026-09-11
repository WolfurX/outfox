import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../core/ctx.js';
import { requirePlayer } from '../../identity/sessions.js';
import { playerView } from '../../identity/players.js';
import { listItem, cancelListing, buyListing, listingsView } from './rules.js';

export function registerMarketRoutes(app: FastifyInstance, { db }: Ctx): void {
  const view = (playerId: number) => ({ player: playerView(db, playerId), listings: listingsView(db, playerId) });

  app.get('/api/market', async (req) => view(requirePlayer(db, req)));

  app.post('/api/market/list', async (req) => {
    const playerId = requirePlayer(db, req);
    const { itemId, price } = (req.body ?? {}) as { itemId?: number; price?: number };
    listItem(db, playerId, Number(itemId), Number(price));
    return view(playerId);
  });

  app.post('/api/market/cancel', async (req) => {
    const playerId = requirePlayer(db, req);
    const { listingId } = (req.body ?? {}) as { listingId?: number };
    cancelListing(db, playerId, Number(listingId));
    return view(playerId);
  });

  app.post('/api/market/buy', async (req) => {
    const playerId = requirePlayer(db, req);
    const { listingId } = (req.body ?? {}) as { listingId?: number };
    buyListing(db, playerId, Number(listingId));
    return view(playerId);
  });
}
