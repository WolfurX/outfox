/**
 * Outfox slice server — Fastify + node:sqlite. Server-authoritative (GDD pillar #4):
 * the client is a renderer; every roll, price, and balance decision happens here.
 */
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getAddress, type Address, type Hex } from 'viem';
import { openDb } from './db.js';
import {
  createPlayer, playerView, listingsView, ledgerView, runCall, runGig, refill,
  listItem, cancelListing, buyListing, conservationAudit, applyCarry,
  startRegister, verifyRegister, adoptExistingAccount, registerVerified,
  adoptVerified, EngineError,
} from './engine.js';
import { privyConfigFromEnv, verifyPrivyToken } from './auth-privy.js';
import {
  chainConfigFromEnv, publicClientFor, startIndexer, signVoucher,
  linkMessage, verifyLinkSignature, alphaAddressFor, approveCalldata,
  depositCalldata, redeemCalldata,
} from './chain.js';
import {
  alphaView, issueLinkNonce, consumeLinkNonce, linkWallet, requestWithdrawal,
  prepareClaim, recordSignedVoucher, withdrawalView, solvencyAudit,
} from './settlement.js';
import {
  getPool, seedExchange, exchangeView, quoteExchange, buyAlpha, sellAlpha, exchangeAudit,
} from './exchange.js';
import { CALLS, GIG, VALVE } from '@outfox/shared';

const DB_PATH = process.env.OUTFOX_DB ?? fileURLToPath(new URL('../outfox.sqlite', import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const COOKIE = 'fox_session';

const db = openDb(DB_PATH);
const app = Fastify({ logger: { level: 'warn' } });
await app.register(cookie);

const hash = (t: string) => createHash('sha256').update(t).digest('hex');

function sessionPlayer(req: { cookies: Record<string, string | undefined> }): number | null {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT player_id FROM sessions WHERE token_hash = ?`).get(hash(token)) as
    { player_id: number } | undefined;
  return row?.player_id ?? null;
}

app.post('/api/session/bootstrap', async (req, reply) => {
  let playerId = sessionPlayer(req);
  if (playerId === null) {
    playerId = createPlayer(db);
    const token = randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO sessions (token_hash, player_id, created_at) VALUES (?, ?, ?)`)
      .run(hash(token), playerId, Date.now());
    reply.setCookie(COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365,
      // deploy gate: behind TLS this MUST be true; false only serves the localhost slice
      secure: process.env.NODE_ENV === 'production',
    });
  }
  return {
    player: playerView(db, playerId),
    listings: listingsView(db, playerId),
    catalog: { calls: CALLS, gig: GIG },
    // which R1 adapter the client should drive (§10.2): the Privy sheet when the
    // release app is configured, the dev email+code sheet otherwise
    auth: PRIVY ? { mode: 'privy' as const, privyAppId: PRIVY.appId } : { mode: 'dev' as const },
  };
});

function requirePlayer(req: { cookies: Record<string, string | undefined> }): number {
  const id = sessionPlayer(req);
  if (id === null) throw new EngineError('no_session', 'no session — bootstrap first');
  return id;
}

const DEV_AUTH = !!process.env.OUTFOX_DEV_AUTH;
const PRIVY = privyConfigFromEnv();

// --- R1 registration (§10.1). Dev auth adapter: code is returned, not emailed. ---
app.post('/api/register/start', async (req) => {
  requirePlayer(req);
  const { email } = (req.body ?? {}) as { email?: string };
  const code = startRegister(db, String(email ?? ''));
  return DEV_AUTH ? { ok: true, devCode: code } : { ok: true };
});

app.post('/api/register/verify', async (req) => {
  const playerId = requirePlayer(req);
  const { email, code } = (req.body ?? {}) as { email?: string; code?: string };
  const r = verifyRegister(db, playerId, String(email ?? ''), String(code ?? ''));
  if (r.collision) return { collision: { existingHandle: r.collision.existingHandle } };
  return { player: playerView(db, playerId) };
});

// Collision resolution: rebind this session to the existing account (guest retired).
app.post('/api/register/adopt', async (req) => {
  const guestId = requirePlayer(req);
  const token = req.cookies[COOKIE]!;
  const { email } = (req.body ?? {}) as { email?: string };
  const existingId = adoptExistingAccount(db, guestId, String(email ?? ''));
  db.prepare(`UPDATE sessions SET player_id = ? WHERE token_hash = ?`).run(existingId, hash(token));
  return { player: playerView(db, existingId), listings: listingsView(db, existingId) };
});

// --- R1 production adapter (Privy, §10.2). One route, both steps: the verified
// identity token both registers and — on `adopt` — resolves a collision, so there is
// no separate code exchange to replay. The token is re-verified on every call. ---
app.post('/api/register/privy', async (req) => {
  const playerId = requirePlayer(req);
  if (!PRIVY) throw new EngineError('not_configured', 'this server does not use Privy sign-in');
  const { token, adopt } = (req.body ?? {}) as { token?: string; adopt?: boolean };
  const identity = verifyPrivyToken(String(token ?? ''), PRIVY);
  if (adopt) {
    const existingId = adoptVerified(db, identity.email);
    const cookieToken = req.cookies[COOKIE]!;
    db.prepare(`UPDATE sessions SET player_id = ? WHERE token_hash = ?`).run(existingId, hash(cookieToken));
    return { player: playerView(db, existingId), listings: listingsView(db, existingId) };
  }
  const r = registerVerified(db, playerId, identity.email);
  if (r.collision) return { collision: { existingHandle: r.collision.existingHandle } };
  return { player: playerView(db, playerId) };
});

app.post('/api/actions/call', async (req) => {
  const playerId = requirePlayer(req);
  const { callId } = (req.body ?? {}) as { callId?: string };
  const result = runCall(db, playerId, String(callId ?? ''));
  return { player: playerView(db, playerId), result };
});

app.post('/api/actions/gig', async (req) => {
  const playerId = requirePlayer(req);
  const { toolAwarded } = runGig(db, playerId);
  return { player: playerView(db, playerId), toolAwarded };
});

app.post('/api/sinks/refill', async (req) => {
  const playerId = requirePlayer(req);
  const { bar } = (req.body ?? {}) as { bar?: 'focus' | 'risk' };
  refill(db, playerId, bar as 'focus' | 'risk');
  return { player: playerView(db, playerId) };
});

app.get('/api/market', async (req) => {
  const playerId = requirePlayer(req);
  return { player: playerView(db, playerId), listings: listingsView(db, playerId) };
});

app.post('/api/market/list', async (req) => {
  const playerId = requirePlayer(req);
  const { itemId, price } = (req.body ?? {}) as { itemId?: number; price?: number };
  listItem(db, playerId, Number(itemId), Number(price));
  return { player: playerView(db, playerId), listings: listingsView(db, playerId) };
});

app.post('/api/market/cancel', async (req) => {
  const playerId = requirePlayer(req);
  const { listingId } = (req.body ?? {}) as { listingId?: number };
  cancelListing(db, playerId, Number(listingId));
  return { player: playerView(db, playerId), listings: listingsView(db, playerId) };
});

app.post('/api/market/buy', async (req) => {
  const playerId = requirePlayer(req);
  const { listingId } = (req.body ?? {}) as { listingId?: number };
  buyListing(db, playerId, Number(listingId));
  return { player: playerView(db, playerId), listings: listingsView(db, playerId) };
});

app.get('/api/ledger', async (req) => {
  const playerId = requirePlayer(req);
  applyCarry(db, playerId); // keep the ledger read consistent with playerView's lazy carry
  return { rows: ledgerView(db, playerId) };
});

// ===== the chain edge (ECONOMY.md §9) ========================================
// Absent chain config, these routes 503 — the slice still runs standalone.

const chain = chainConfigFromEnv();
const ORIGIN = process.env.OUTFOX_ORIGIN ?? 'localhost:5173';

function requireChain() {
  if (!chain) throw new EngineError('chain_off', 'the chain edge is not configured');
  return chain;
}

/** Live reserve — the solvency ceiling every withdrawal request is checked against. */
async function reserveWei(): Promise<bigint> {
  const cfg = requireChain();
  return publicClientFor(cfg).readContract({
    address: cfg.settlement,
    abi: [{
      type: 'function', name: 'reserve', stateMutability: 'view',
      inputs: [], outputs: [{ type: 'uint256' }],
    }],
    functionName: 'reserve',
  }) as Promise<bigint>;
}

app.get('/api/alpha', async (req) => {
  const playerId = requirePlayer(req);
  return { alpha: alphaView(db, playerId), valve: VALVE };
});

// --- R2: link a wallet by proving control (SIWE-lite) ---
app.post('/api/wallet/nonce', async (req) => {
  const playerId = requirePlayer(req);
  const nonce = issueLinkNonce(db, playerId);
  return { nonce, message: linkMessage(nonce, ORIGIN) };
});

app.post('/api/wallet/link', async (req) => {
  const playerId = requirePlayer(req);
  const { address, nonce, signature } = (req.body ?? {}) as
    { address?: string; nonce?: string; signature?: string };
  let addr: Address;
  try {
    addr = getAddress(String(address ?? ''));
  } catch {
    throw new EngineError('bad_address', 'that is not a valid wallet address');
  }
  consumeLinkNonce(db, playerId, String(nonce ?? ''));
  const ok = await verifyLinkSignature(addr, linkMessage(String(nonce), ORIGIN), signature as Hex);
  if (!ok) throw new EngineError('bad_signature', 'signature does not match that wallet');
  linkWallet(db, playerId, addr);
  return { player: playerView(db, playerId), alpha: alphaView(db, playerId) };
});

// --- R3 verification. Stub adapter: the real one is World ID at cash-out only
//     (ROBINHOOD-FEASIBILITY migration step 8). Enabled only under OUTFOX_DEV_AUTH so a
//     real deploy cannot mint verified identities. ---
app.post('/api/verify/dev', async (req) => {
  if (!DEV_AUTH) throw new EngineError('not_available', 'unavailable');
  const playerId = requirePlayer(req);
  db.prepare(`UPDATE players SET rung = 3 WHERE id = ? AND rung >= 2`).run(playerId);
  return { player: playerView(db, playerId) };
});

// --- cash-out: request (runs every §9 gate) ---
app.post('/api/withdraw/request', async (req) => {
  const playerId = requirePlayer(req);
  requireChain();
  const { amountWei } = (req.body ?? {}) as { amountWei?: string };
  let gross: bigint;
  try {
    gross = BigInt(String(amountWei ?? '0'));
  } catch {
    throw new EngineError('bad_amount', 'invalid amount');
  }
  const wd = requestWithdrawal(db, playerId, gross, await reserveWei());
  return { withdrawal: wd, alpha: alphaView(db, playerId) };
});

// --- cash-out: claim the voucher once vested (the ONLY place the hot key signs) ---
app.post('/api/withdraw/claim', async (req) => {
  const playerId = requirePlayer(req);
  const cfg = requireChain();
  const { id } = (req.body ?? {}) as { id?: number };
  const c = prepareClaim(db, playerId, Number(id));
  const signature = await signVoucher(cfg, {
    to: c.to as Address, amount: c.amountWei, nonce: c.nonce, deadline: c.deadline,
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
      settlement: cfg.settlement,
    },
    redeemCalldata: redeemCalldata({
      to: c.to as Address, amount: c.amountWei, nonce: c.nonce,
      deadline: c.deadline, signature: signature as Hex,
    }),
  };
});

// --- deposits: two wallet transactions, both encoded here (client has no ABI code) ---
app.post('/api/deposit/prepare', async (req) => {
  requirePlayer(req);
  const cfg = requireChain();
  const { amountWei } = (req.body ?? {}) as { amountWei?: string };
  let amt: bigint;
  try {
    amt = BigInt(String(amountWei ?? '0'));
  } catch {
    throw new EngineError('bad_amount', 'invalid amount');
  }
  if (amt <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
  const token = await alphaAddressFor(cfg);
  return {
    chainId: cfg.chainId,
    token,
    settlement: cfg.settlement,
    amountWei: amt.toString(),
    approveData: approveCalldata(cfg.settlement, amt),
    depositData: depositCalldata(amt),
  };
});

// ===== the Exchange (Scrip <-> ALPHA, ECONOMY.md §8) =========================
// Dev worlds seed the pool from env; PRODUCTION seeding is an explicit operator step
// through poolSeedFromDeposit, after a real treasury deposit backs the inventory
// (exchange.ts E6). Depth at launch is a pending owner decision — this dev default
// mirrors the sim's calibrated amm_credit0/amm_vig0 (e0 = 100 Scrip per ALPHA).
if (process.env.OUTFOX_DEV_SEED_EXCHANGE && !getPool(db)) {
  seedExchange(db, 3_000_000, 30_000n * 10n ** 18n, 'dev-genesis');
  console.log('[exchange] dev pool seeded (3,000,000 Scrip / 30,000 ALPHA)');
}

app.get('/api/exchange', async (req) => {
  const playerId = requirePlayer(req);
  return {
    player: playerView(db, playerId),
    exchange: exchangeView(db),
    alpha: alphaView(db, playerId),
  };
});

// The G9 price series (DATA-ARCHITECTURE econ.* — rate is a derived metric, not money).
// Bucketed to ~daily closes: the last trade of each day carries the day's rate.
app.get('/api/exchange/history', async (req) => {
  requirePlayer(req);
  const rows = db.prepare(
    `SELECT MAX(at) AS at, rate_after AS rate FROM exchange_events
     WHERE kind != 'seed' GROUP BY at / 86400000 ORDER BY at ASC`
  ).all() as { at: number; rate: number }[];
  return { points: rows.slice(-30) };
});

app.post('/api/exchange/quote', async (req) => {
  const playerId = requirePlayer(req);
  const { side, amount } = (req.body ?? {}) as { side?: string; amount?: string };
  if (side !== 'buy' && side !== 'sell') throw new EngineError('bad_action', 'unknown side');
  let amt: bigint;
  try {
    amt = BigInt(String(amount ?? '0'));
  } catch {
    throw new EngineError('bad_amount', 'invalid amount');
  }
  if (amt <= 0n) throw new EngineError('bad_amount', 'amount must be positive');
  return {
    player: playerView(db, playerId),
    exchange: exchangeView(db),
    quote: quoteExchange(db, side, amt),
  };
});

app.post('/api/exchange/swap', async (req) => {
  const playerId = requirePlayer(req);
  const { side, amount, minOut } = (req.body ?? {}) as
    { side?: string; amount?: string; minOut?: string };
  if (side !== 'buy' && side !== 'sell') throw new EngineError('bad_action', 'unknown side');
  let amt: bigint, min: bigint | null = null;
  try {
    amt = BigInt(String(amount ?? '0'));
    if (minOut !== undefined) min = BigInt(String(minOut));
  } catch {
    throw new EngineError('bad_amount', 'invalid amount');
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

// debug-only audits: registered ONLY when OUTFOX_DEBUG is set — never in a real deploy
if (process.env.OUTFOX_DEBUG) {
  app.get('/api/debug/conservation', async () => conservationAudit(db));
  app.get('/api/debug/solvency', async () => solvencyAudit(db, await reserveWei()));
  app.get('/api/debug/exchange', async () => exchangeAudit(db));
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof EngineError) {
    reply.code(err.code === 'no_session' ? 401 : 400).send({ error: err.message, code: err.code });
  } else {
    app.log.error(err);
    reply.code(500).send({ error: 'internal error' });
  }
});

await app.listen({ port: PORT, host: '127.0.0.1' });
console.log(`outfox slice server on :${PORT} (db: ${DB_PATH})`);

if (chain) {
  startIndexer(db, chain, 5_000, (m) => console.log(`[indexer] ${m}`));
  console.log(`[indexer] watching Settlement ${chain.settlement} on chain ${chain.chainId}`);
} else {
  console.log('[indexer] chain edge not configured (set OUTFOX_RPC_URL / _CHAIN_ID / _SETTLEMENT)');
}
