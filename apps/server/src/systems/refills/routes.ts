import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../core/ctx.js';
import { requirePlayer } from '../../identity/sessions.js';
import { playerView } from '../../identity/players.js';
import { refill } from './rules.js';

export function registerRefillRoutes(app: FastifyInstance, { db }: Ctx): void {
  app.post('/api/sinks/refill', async (req) => {
    const playerId = requirePlayer(db, req);
    const { bar } = (req.body ?? {}) as { bar?: 'focus' | 'risk' };
    refill(db, playerId, bar as 'focus' | 'risk');
    return { player: playerView(db, playerId) };
  });
}
