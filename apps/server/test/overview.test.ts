/**
 * The public economy overview (economy/overview.ts, GET /api/economy). Every expected
 * number below is worked out by hand from the actions the test performs and the
 * published constants, not read back from the function under test.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { openDb, type DB } from '../src/core/db.js';
import type { Ctx } from '../src/core/ctx.js';
import { createPlayer } from '../src/identity/players.js';
import { startRegister, verifyRegister } from '../src/identity/rungs.js';
import { postTx } from '../src/ledger/scrip.js';
import { refill } from '../src/systems/refills/rules.js';
import { listItem, buyListing, listingsView } from '../src/systems/market/rules.js';
import { seedExchange, buyAlpha } from '../src/economy/exchange.js';
import { economyOverview } from '../src/economy/overview.js';
import { registerEconomyRoutes } from '../src/economy/routes.js';
import { ALPHA_BASE_UNITS, EXCHANGE, MARKET_FEE_BPS, REFILL } from '@outfox/shared';

let db: DB;
const T0 = 1_800_000_000_000;
const HOUR = 3_600_000;
let regN = 0;
function toR1(playerId: number): number {
  const email = `o${regN++}@x.io`;
  startRegister(db, email, T0);
  const code = (db.prepare('SELECT code FROM auth_codes WHERE email = ?').get(email) as { code: string }).code;
  verifyRegister(db, playerId, email, code, T0);
  return playerId;
}
const work = (p: number, cents: number) => postTx(db, p, cents, 0, 'gig', 'test', T0); // Settled, minted by work
const chance = (p: number, cents: number) => postTx(db, p, 0, cents, 'call', 'test', T0); // Unsettled, minted by chance

/** Four Foxes: one worked, one won and refilled, two registered and traded an item. */
function world() {
  const worker = createPlayer(db, T0);
  const lucky = createPlayer(db, T0);
  const seller = toR1(createPlayer(db, T0));
  const buyer = toR1(createPlayer(db, T0));
  work(worker, 5_000);
  chance(lucky, 1_000);
  refill(db, lucky, 'focus', T0); // 250 of Unsettled to the treasury
  work(buyer, 2_000);
  const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(seller) as { id: number }).id;
  listItem(db, seller, item, 1_000, T0);
  buyListing(db, buyer, listingsView(db, buyer)[0].id, T0); // 1,000 across, 3.5% fee to the treasury
  return { worker, lucky, seller, buyer };
}
const MARKET_FEE = Math.ceil((1_000 * MARKET_FEE_BPS) / 10_000);

beforeEach(() => { db = openDb(':memory:'); regN = 0; });

describe('economyOverview', () => {
  it('reports players, Scrip by provenance, the treasury, and the day\'s faucets and sinks', () => {
    world();
    const v = economyOverview(db, null, T0 + HOUR);
    expect(REFILL.cost).toBe(250);
    expect(MARKET_FEE).toBe(35);
    expect(v.players).toEqual({ total: 4, registered: 2, active24h: 4 });
    expect(v.scrip).toEqual({
      settled: 5_000 + 1_000 + (1_000 - 35), // worker, buyer's change, seller net of the fee
      unsettled: 1_000 - 250,
      treasury: 250 + 35,
      exchangePool: 0,
      minted: 5_000 + 1_000 + 2_000,
      minted24h: 8_000,
      captured24h: 285,
    });
    // every minted cent is somewhere: players + treasury
    expect(v.scrip.settled + v.scrip.unsettled + v.scrip.treasury).toBe(v.scrip.minted);
    expect(v.alpha).toEqual({ held: '0', exchangePool: '0', treasury: '0', cashingOut: '0', reserve: null });
    expect(v.exchange).toBeNull();
    expect(v.audits).toEqual({ conservation: true, alphaLedger: true, exchange: null, solvency: null });
    expect(v.asOf).toBe(T0 + HOUR);
  });

  it('the 24-hour figures roll off; the standing figures do not', () => {
    world();
    const v = economyOverview(db, null, T0 + 25 * HOUR);
    expect(v.players).toEqual({ total: 4, registered: 2, active24h: 0 });
    expect(v.scrip.minted24h).toBe(0);
    expect(v.scrip.captured24h).toBe(0);
    expect(v.scrip.minted).toBe(8_000);
    expect(v.scrip.treasury).toBe(285);
  });

  it('with the exchange open: the pool, the buy-leg fee as a sink, the rate, and proof of reserves', () => {
    const { buyer } = world();
    const SEED_SCRIP = 3_000_000;
    const SEED_ALPHA = 30_000n * ALPHA_BASE_UNITS;
    seedExchange(db, SEED_SCRIP, SEED_ALPHA, 'test', T0);
    const out = buyAlpha(db, buyer, 1_000, null, T0);
    const fee = (1_000 * EXCHANGE.feeBps) / 10_000;
    expect(fee).toBe(15);
    const v = economyOverview(db, SEED_ALPHA, T0 + HOUR);
    expect(v.scrip.exchangePool).toBe(SEED_SCRIP + 1_000 - 15);
    expect(v.scrip.treasury).toBe(285 + 15);
    expect(v.scrip.captured24h).toBe(285 + 15);
    expect(v.scrip.minted).toBe(8_000 + SEED_SCRIP); // the pool's seed is a mint
    expect(v.scrip.settled + v.scrip.unsettled + v.scrip.treasury + v.scrip.exchangePool).toBe(v.scrip.minted);
    // the ALPHA the buyer received left the pool: together they are still the seed
    expect(v.alpha.held).toBe(out.outWei.toString());
    expect(BigInt(v.alpha.held) + BigInt(v.alpha.exchangePool)).toBe(SEED_ALPHA);
    expect(v.alpha.reserve).toBe(SEED_ALPHA.toString());
    expect(Number(v.exchange!.rateCentsPerAlpha)).toBeGreaterThan(SEED_SCRIP / 30_000); // a buy moves the rate up
    expect(v.exchange!.points).toHaveLength(1);
    expect(v.audits).toEqual({ conservation: true, alphaLedger: true, exchange: true, solvency: true });
    // one base unit short of what the game owes is insolvent
    expect(economyOverview(db, SEED_ALPHA - 1n, T0 + HOUR).audits.solvency).toBe(false);
  });

  it('a broken ledger shows as a failed audit, not as a number that looks fine', () => {
    world();
    db.prepare('UPDATE treasury SET scrip = scrip + 1 WHERE id = 1').run();
    expect(economyOverview(db, null, T0 + HOUR).audits.conservation).toBe(false);
  });

  it('carries nothing that identifies a player', () => {
    world();
    const text = JSON.stringify(economyOverview(db, null, T0 + HOUR));
    const rows = db.prepare('SELECT handle, email FROM players').all() as { handle: string; email: string | null }[];
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(text).not.toContain(r.handle);
      if (r.email) expect(text).not.toContain(r.email);
    }
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['alpha', 'asOf', 'audits', 'exchange', 'players', 'scrip']);
  });
});

describe('GET /api/economy', () => {
  it('answers without a session, chain off, and serves one computation per window', async () => {
    world();
    const app = Fastify();
    const limit = { rateLimit: { max: 60, timeWindow: 60_000 } };
    registerEconomyRoutes(app, { db, chain: null, rl: { auth: limit, public: limit } } as unknown as Ctx);
    const first = (await app.inject({ method: 'GET', url: '/api/economy' })).json();
    expect(first.economy.players.total).toBe(4);
    expect(first.economy.alpha.reserve).toBeNull();
    expect(first.economy.audits.solvency).toBeNull();
    createPlayer(db, T0); // a fifth Fox arrives inside the cache window
    const second = (await app.inject({ method: 'GET', url: '/api/economy' })).json();
    expect(second).toEqual(first);
  });
});
