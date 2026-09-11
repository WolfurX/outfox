import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../core/ctx.js';
import { requirePlayer } from '../../identity/sessions.js';
import { playerView } from '../../identity/players.js';
import { runGig } from './rules.js';

export function registerGigRoutes(app: FastifyInstance, { db }: Ctx): void {
  app.post('/api/actions/gig', async (req) => {
    const playerId = requirePlayer(db, req);
    const { toolAwarded } = runGig(db, playerId);
    return { player: playerView(db, playerId), toolAwarded };
  });
}
