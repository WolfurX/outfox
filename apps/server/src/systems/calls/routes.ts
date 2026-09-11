import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../core/ctx.js';
import { requirePlayer } from '../../identity/sessions.js';
import { playerView } from '../../identity/players.js';
import { runCall } from './rules.js';

export function registerCallRoutes(app: FastifyInstance, { db }: Ctx): void {
  app.post('/api/actions/call', async (req) => {
    const playerId = requirePlayer(db, req);
    const { callId } = (req.body ?? {}) as { callId?: string };
    const result = runCall(db, playerId, String(callId ?? ''));
    return { player: playerView(db, playerId), result };
  });
}
