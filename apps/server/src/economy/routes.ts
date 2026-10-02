/** Routes for the value edge: $ALPHA position, cash-out, deposits, and the exchange. */
import type { FastifyInstance } from 'fastify';
import { PublicKey } from '@solana/web3.js';
import { type Ctx, requireChain } from '../core/ctx.js';
import { EngineError } from '../core/errors.js';
import { requirePlayer } from '../identity/sessions.js';
import { playerView } from '../identity/players.js';
import {
  alphaMintFor, reserveFor, prepareDepositTx, prepareRedeemTx, signVoucher, statePda,
} from '../chain/adapter.js';
import {
  alphaView, requestWithdrawal, prepareClaim, recordSignedVoucher, withdrawalView,
} from './valve.js';
import { exchangeView, quoteExchange, buyAlpha, sellAlpha } from './exchange.js';
import { economyOverview } from './overview.js';
import { cachedRead, withTimeout } from '../core/cached.js';
import { VALVE } from '@outfox/shared';

function parseWei(v: unknown, what = 'invalid amount'): bigint {
  try {
    return BigInt(String(v ?? '0'));
  } catch {
    throw new EngineError('bad_amount', what);
  }
}

export function registerEconomyRoutes(app: FastifyInstance, ctx: Ctx): void {
  const { db } = ctx;

  // --- the public economy overview: aggregates only, no session (economy/overview.ts) ---
  // One computation per 30 s whatever the request rate. The escrow reserve is the only
  // upstream read; when the chain is off, slow or unreachable the ledger side is still
  // published, with the reserve and the solvency verdict left null.
  const overview = cachedRead(async () => {
    let reserve: bigint | null = null;
    if (ctx.chain) {
      try {
        reserve = await withTimeout(reserveFor(ctx.chain), 5_000);
      } catch (e) {
        app.log.warn({ err: String(e) }, 'economy overview: reserve read failed');
      }
    }
    return economyOverview(db, reserve);
  }, {
    windowMs: 30_000, timeoutMs: 8_000, maxAgeMs: 10 * 60_000,
    onError: (e) => { app.log.warn({ err: String(e) }, 'economy overview failed'); },
  });
  app.get('/api/economy', { config: ctx.rl.public }, async () => ({ economy: await overview() }));

  app.get('/api/alpha', async (req) => {
    const playerId = requirePlayer(db, req);
    return { alpha: alphaView(db, playerId), valve: VALVE };
  });

  // --- cash-out: request (runs every §9 gate) ---
  // Chain-edge routes fire an outbound Solana RPC call per request (reserve reads,
  // tx builds) — limited so one session can't turn the server into an RPC amplifier.
  app.post('/api/withdraw/request', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const cfg = requireChain(ctx);
    const { amountWei } = (req.body ?? {}) as { amountWei?: string };
    const gross = parseWei(amountWei);
    const wd = requestWithdrawal(db, playerId, gross, await reserveFor(cfg));
    return { withdrawal: wd, alpha: alphaView(db, playerId) };
  });

  // --- cash-out: claim the voucher once vested (the ONLY place the hot key signs) ---
  app.post('/api/withdraw/claim', { config: ctx.rl.auth }, async (req) => {
    const playerId = requirePlayer(db, req);
    const cfg = requireChain(ctx);
    const { id } = (req.body ?? {}) as { id?: number };
    const c = prepareClaim(db, playerId, Number(id));
    const signature = await signVoucher(cfg, {
      to: c.to, amount: c.amountWei, nonce: c.nonce, deadline: c.deadline,
    });
    recordSignedVoucher(db, Number(id), signature, c.deadline);
    return {
      withdrawal: withdrawalView(db, Number(id)),
      voucher: {
        to: c.to,
        amountWei: c.amountWei.toString(),
        nonce: c.nonce.toString(),
        deadline: Number(c.deadline),
        signature,
        chainId: cfg.chainId,
        program: cfg.programId.toBase58(),
      },
      // one wallet transaction: [compute budget, ed25519 verify, withdraw]
      redeemTx: await prepareRedeemTx(cfg, c.to, {
        to: c.to, amount: c.amountWei, nonce: c.nonce,
        deadline: c.deadline, signature,
      }),
    };
  });

  // --- deposits: one wallet transaction, encoded here (the client has no chain code) ---
  app.post('/api/deposit/prepare', { config: ctx.rl.auth }, async (req) => {
    requirePlayer(db, req);
    const cfg = requireChain(ctx);
    const { amountWei, from } = (req.body ?? {}) as { amountWei?: string; from?: string };
    const amt = parseWei(amountWei);
    if (amt <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
    let depositor: string;
    try {
      depositor = new PublicKey(String(from ?? '')).toBase58();
    } catch {
      throw new EngineError('bad_address', 'a depositing wallet address is required');
    }
    const token = await alphaMintFor(cfg);
    return {
      chainId: cfg.chainId,
      token: token.toBase58(),
      program: cfg.programId.toBase58(),
      state: statePda(cfg).toBase58(),
      amountWei: amt.toString(),
      // one wallet transaction; no approve step exists on Solana
      depositTx: await prepareDepositTx(cfg, depositor, amt),
    };
  });

  // ===== the Exchange (Scrip <-> ALPHA, ECONOMY.md §8) =========================

  app.get('/api/exchange', async (req) => {
    const playerId = requirePlayer(db, req);
    return {
      player: playerView(db, playerId),
      exchange: exchangeView(db),
      alpha: alphaView(db, playerId),
    };
  });

  // The G9 price series (DATA-ARCHITECTURE econ.* — rate is a derived metric, not money).
  // Bucketed to ~daily closes: the last trade of each day carries the day's rate.
  app.get('/api/exchange/history', async (req) => {
    requirePlayer(db, req);
    const rows = db.prepare(
      `SELECT MAX(at) AS at, rate_after AS rate FROM exchange_events
       WHERE kind != 'seed' GROUP BY at / 86400000 ORDER BY at ASC`
    ).all() as { at: number; rate: number }[];
    return { points: rows.slice(-30) };
  });

  app.post('/api/exchange/quote', async (req) => {
    const playerId = requirePlayer(db, req);
    const { side, amount } = (req.body ?? {}) as { side?: string; amount?: string };
    if (side !== 'buy' && side !== 'sell') throw new EngineError('bad_action', 'unknown side');
    const amt = parseWei(amount);
    if (amt <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
    return {
      player: playerView(db, playerId),
      exchange: exchangeView(db),
      quote: quoteExchange(db, side, amt),
    };
  });

  app.post('/api/exchange/swap', async (req) => {
    const playerId = requirePlayer(db, req);
    const { side, amount, minOut } = (req.body ?? {}) as
      { side?: string; amount?: string; minOut?: string };
    if (side !== 'buy' && side !== 'sell') throw new EngineError('bad_action', 'unknown side');
    const amt = parseWei(amount);
    // a present-but-null minOut is a malformed request, not "no floor": HEAD parity
    let min: bigint | null = null;
    if (minOut !== undefined) {
      try {
        min = BigInt(String(minOut));
      } catch {
        throw new EngineError('bad_amount', 'invalid amount');
      }
    }
    if (amt <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
    if (side === 'buy') {
      const r = buyAlpha(db, playerId, Number(amt), min);
      return {
        player: playerView(db, playerId), exchange: exchangeView(db),
        alpha: alphaView(db, playerId),
        quote: {
          side, amountIn: amt.toString(), fee: String(r.feeCents),
          amountOut: r.outWei.toString(), effectiveFeeBps: r.effBps,
        },
      };
    }
    const r = sellAlpha(db, playerId, amt, min === null ? null : Number(min));
    return {
      player: playerView(db, playerId), exchange: exchangeView(db),
      alpha: alphaView(db, playerId),
      quote: {
        side, amountIn: amt.toString(), fee: r.feeWei.toString(),
        amountOut: String(r.outCents), effectiveFeeBps: r.effBps,
      },
    };
  });
}
