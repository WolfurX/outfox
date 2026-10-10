import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Route-level coverage of the Wire through the real composition root (index.ts), with the
// fixture Panta from OUTFOX_WIRE_FIXTURE. The fixture is anchored at T0, so only Date is
// faked (timers stay real for fastify's inject). A second connection to the same
// database file runs the job tick, standing in for the process the real server starts.
const T0 = 1_800_000_000_000;
const dir = mkdtempSync(join(tmpdir(), 'routes-wire-'));
const dbPath = join(dir, 'wire.sqlite');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(T0);
process.env.OUTFOX_DB = dbPath;
process.env.OUTFOX_WIRE_FIXTURE = join(__dirname, 'fixtures', 'wire', 'market-world.json');
delete process.env.OUTFOX_TRUST_PROXY;
delete process.env.OUTFOX_DEV_AUTH;
vi.spyOn(console, 'warn').mockImplementation(() => {});
const { app } = await import('../src/index.js');
const { openDb } = await import('../src/core/db.js');
const { wireTick } = await import('../src/systems/wire/job.js');
const { wireConfigFromEnv } = await import('../src/systems/wire/panta.js');

const side = openDb(dbPath);
afterAll(() => { side.close(); rmSync(dir, { recursive: true, force: true }); });

async function session(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/session/bootstrap' });
  expect(r.statusCode).toBe(200);
  return r.cookies.find((c) => c.name === 'fox_session')!.value;
}
const get = (tok: string) => app.inject({ method: 'GET', url: '/api/wire', cookies: { fox_session: tok } });
const take = (tok: string, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/actions/wire', cookies: { fox_session: tok }, payload: payload as object });

describe('/api/wire', () => {
  it('needs a session', async () => {
    const g = await app.inject({ method: 'GET', url: '/api/wire' });
    expect(g.statusCode).toBe(401);
    expect(g.json().code).toBe('no_session');
    const p = await app.inject({ method: 'POST', url: '/api/actions/wire', payload: { marketId: 'm-a', side: 'yes' } });
    expect(p.statusCode).toBe(401);
  });

  it('is enabled but quiet before the job has listed anything', async () => {
    const r = await get(await session());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ enabled: true, markets: [], positions: [] });
  });

  describe('once the job has run', () => {
    beforeAll(async () => { await wireTick(side, wireConfigFromEnv()!.client, T0); });

    it('lists the five markets with chances, quote times and both payouts', async () => {
      const r = await get(await session());
      expect(r.statusCode).toBe(200);
      const b = r.json();
      expect(b.enabled).toBe(true);
      expect(b.positions).toEqual([]);
      expect(b.markets.map((m: { marketId: string }) => m.marketId)).toEqual(['m-a', 'm-b', 'm-c', 'm-d', 'm-e']);
      expect(b.markets[1]).toEqual({
        marketId: 'm-b', title: 'BTC above 120k on Friday', category: 'crypto',
        endsAt: (1_800_000_000 + 3 * 3600) * 1000, settlesAt: (1_800_000_000 + 2 * 86_400) * 1000,
        yesPrice: 0.25, quotedAt: T0, payoutYes: 400, payoutNo: 133,
      });
    });

    it('takes a call: state-after player.risk is 20 lower, the position is open at the quote', async () => {
      const tok = await session();
      const r = await take(tok, { marketId: 'm-a', side: 'yes' });
      expect(r.statusCode).toBe(200);
      const b = r.json();
      expect(b.player.risk).toBe(80); // 100 - 20, same instant
      expect(b.markets).toHaveLength(5);
      expect(b.positions).toHaveLength(1);
      expect(b.positions[0]).toMatchObject({
        marketId: 'm-a', title: 'Haaland 8+ points, GW6', side: 'yes', price: 0.5, payout: 200,
        openedAt: T0, status: 'open', settledAt: null,
      });
    });

    it('refuses with 400 codes: taken, closed, bad side, bad body', async () => {
      const tok = await session();
      expect((await take(tok, { marketId: 'm-c', side: 'no' })).statusCode).toBe(200);
      const code = async (payload: unknown) => {
        const r = await take(tok, payload);
        expect(r.statusCode).toBe(400);
        return r.json().code;
      };
      expect(await code({ marketId: 'm-c', side: 'yes' })).toBe('wire_taken');
      expect(await code({ marketId: 'nope', side: 'yes' })).toBe('wire_closed');
      expect(await code({ marketId: 'm-d', side: 'maybe' })).toBe('bad_action');
      expect(await code({ side: 'yes' })).toBe('bad_action');
      expect(await code(undefined)).toBe('bad_action');
    });

    it('refuses with low_bar when Risk is short, and with wire_full at five open', async () => {
      const tok = await session();
      // the three Calls cost 10 + 20 + 35 = 65 Risk, leaving 35 (whatever they pay)
      for (const callId of ['fade_open', 'front_rumor', 'squeeze_basket']) {
        const r = await app.inject({ method: 'POST', url: '/api/actions/call', cookies: { fox_session: tok }, payload: { callId } });
        expect(r.statusCode).toBe(200);
      }
      expect((await take(tok, { marketId: 'm-a', side: 'yes' })).json().player.risk).toBe(15);
      const short = await take(tok, { marketId: 'm-b', side: 'yes' });
      expect(short.statusCode).toBe(400);
      expect(short.json().code).toBe('low_bar');

      const full = await session();
      for (const id of ['m-a', 'm-b', 'm-c', 'm-d', 'm-e']) expect((await take(full, { marketId: id, side: 'no' })).statusCode).toBe(200);
      side.prepare(`INSERT INTO wire_markets (market_id, title, category, ends_at, settles_at, yes_price, quoted_at, listed, updated_at)
        VALUES ('m-x', 'Sixth', 'sports', ?, ?, 0.5, ?, 1, ?)`).run(T0 + 3_600_000, T0 + 86_400_000, T0, T0);
      const sixth = await take(full, { marketId: 'm-x', side: 'yes' });
      expect(sixth.statusCode).toBe(400);
      expect(sixth.json().code).toBe('wire_full');
    });

    it('settles a right call on the next touch and the payout shows in the next action', async () => {
      const tok = await session();
      expect((await take(tok, { marketId: 'm-e', side: 'yes' })).statusCode).toBe(200); // 0.6 -> 167
      side.prepare(`UPDATE wire_markets SET outcome = 'yes' WHERE market_id = 'm-e'`).run();
      const g = (await get(tok)).json();
      expect(g.positions[0]).toMatchObject({ marketId: 'm-e', status: 'won', settledAt: T0 });
      expect(g.markets.map((m: { marketId: string }) => m.marketId)).not.toContain('m-e');
      const r = (await take(tok, { marketId: 'm-b', side: 'no' })).json(); // 0.75 -> 133
      expect(r.player.scripUnsettled).toBe(167);
      expect(r.player.scripSettled).toBe(0);
      expect(r.player.risk).toBe(60);
    });
  });
});

describe('with the Wire off', () => {
  it('answers enabled: false and refuses calls without a 500', async () => {
    vi.resetModules();
    delete process.env.OUTFOX_WIRE_FIXTURE;
    delete process.env.OUTFOX_PANTA_KEY;
    process.env.OUTFOX_DB = ':memory:';
    const off = (await import('../src/index.js')).app;
    const boot = await off.inject({ method: 'POST', url: '/api/session/bootstrap' });
    const cookies = { fox_session: boot.cookies.find((c) => c.name === 'fox_session')!.value };
    const g = await off.inject({ method: 'GET', url: '/api/wire', cookies });
    expect(g.json()).toEqual({ enabled: false, markets: [], positions: [] });
    const p = await off.inject({ method: 'POST', url: '/api/actions/wire', cookies, payload: { marketId: 'm-a', side: 'yes' } });
    expect(p.statusCode).toBe(400);
    expect(p.json().code).toBe('wire_closed');
  });
});
