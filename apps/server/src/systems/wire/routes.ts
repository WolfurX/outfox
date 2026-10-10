import type { FastifyInstance } from 'fastify';
import type { Ctx } from '../../core/ctx.js';
import { EngineError } from '../../core/errors.js';
import { requirePlayer } from '../../identity/sessions.js';
import { playerView } from '../../identity/players.js';
import type { WireResponse, WireSide } from '@outfox/shared';
import { openWireCall, settleWire, wireView } from './rules.js';

export function registerWireRoutes(app: FastifyInstance, { db, wire }: Ctx): void {
  // Positions settle on the next touch, so the Book is right when the player looks.
  const respond = (playerId: number, now: number): WireResponse => {
    settleWire(db, playerId, now);
    const v = wireView(db, playerId, now);
    return { enabled: !!wire, markets: wire ? v.markets : [], positions: v.positions };
  };

  app.get('/api/wire', async (req): Promise<WireResponse> => {
    return respond(requirePlayer(db, req), Date.now());
  });

  app.post('/api/actions/wire', async (req): Promise<WireResponse> => {
    const playerId = requirePlayer(db, req);
    const { marketId, side } = (req.body ?? {}) as { marketId?: unknown; side?: unknown };
    if (!wire) throw new EngineError('wire_closed', 'the Wire is quiet right now');
    if (typeof marketId !== 'string' || (side !== 'yes' && side !== 'no')) {
      throw new EngineError('bad_action', 'take YES or NO on a listed market');
    }
    const now = Date.now();
    settleWire(db, playerId, now);
    openWireCall(db, playerId, marketId, side as WireSide, now);
    return { ...respond(playerId, now), player: playerView(db, playerId, now) };
  });
}
