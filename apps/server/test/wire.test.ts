/**
 * The Wire (systems/wire): rules over the DB, the job against a fixture Panta, and the
 * Panta client against a stubbed fetch. Every expected number is worked out by hand from
 * the spec's payout rule (round(100 / p) capped at 700, p clamped to [0.05, 0.95]) and
 * the fixture's quotes, never by calling wirePayout.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../src/core/db.js';
import { EngineError } from '../src/core/errors.js';
import { createPlayer, playerView } from '../src/identity/players.js';
import { conservationAudit, ledgerView } from '../src/ledger/scrip.js';
import { openWireCall, settleWire, wireView } from '../src/systems/wire/rules.js';
import { wireTick } from '../src/systems/wire/job.js';
import {
  fixtureClient, pantaClient, wireConfigFromEnv, type WireClient, type PantaOutcome,
} from '../src/systems/wire/panta.js';
import { wirePayout } from '@outfox/shared';

const FIXTURE = join(__dirname, 'fixtures', 'wire', 'market-world.json');
const T0 = 1_800_000_000_000; // the fixture's clock, in ms
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

let db: DB;
beforeEach(() => { db = openDb(':memory:'); });

function seedMarket(id: string, o: Partial<{
  ends_at: number; settles_at: number; yes_price: number | null; quoted_at: number | null;
  listed: number; outcome: string | null;
}> = {}) {
  const r = { ends_at: T0 + 2 * HOUR, settles_at: T0 + DAY, yes_price: 0.5, quoted_at: T0, listed: 1, outcome: null, ...o };
  db.prepare(
    `INSERT INTO wire_markets (market_id, title, category, ends_at, settles_at, yes_price, quoted_at, listed, outcome, updated_at)
     VALUES (?, ?, 'sports', ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, `Market ${id}`, r.ends_at, r.settles_at, r.yes_price, r.quoted_at, r.listed, r.outcome, T0);
}
const refusal = (fn: () => unknown): string => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(EngineError); return (e as EngineError).code; }
  throw new Error('expected a refusal');
};
const ledgerCount = (pid: number) => (db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE player_id = ? AND kind = 'wire'`).get(pid) as { n: number }).n;
const listedIds = () => (db.prepare(`SELECT market_id FROM wire_markets WHERE listed = 1 ORDER BY ends_at`).all() as { market_id: string }[]).map((r) => r.market_id);

describe('payout', () => {
  it('pays round(100 / p) capped at 700, with p clamped to [0.05, 0.95]', () => {
    expect(wirePayout(0.5)).toBe(200);
    expect(wirePayout(0.25)).toBe(400);
    expect(wirePayout(0.1)).toBe(700); // 1000 before the cap
    expect(wirePayout(0.95)).toBe(105); // 105.26
    expect(wirePayout(0.01)).toBe(700); // clamps to 0.05 -> 2000 -> cap
    expect(wirePayout(0.99)).toBe(105); // clamps to 0.95
  });
});

describe('openWireCall', () => {
  it('takes YES at the quote: price and payout fixed, 20 Risk spent', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1', { yes_price: 0.25 });
    const v = openWireCall(db, p, 'm1', 'yes', T0);
    expect(v).toMatchObject({ marketId: 'm1', side: 'yes', price: 0.25, payout: 400, status: 'open', openedAt: T0, settledAt: null });
    expect(playerView(db, p, T0).risk).toBe(80);
    expect(wireView(db, p, T0).positions).toHaveLength(1);
  });

  it('takes NO at one minus the quote', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1', { yes_price: 0.25 });
    // NO price 0.75 -> 100 / 0.75 = 133.33 -> 133
    expect(openWireCall(db, p, 'm1', 'no', T0)).toMatchObject({ side: 'no', price: 0.75, payout: 133 });
  });

  it('refuses a market that is not listed, decided, over, unquoted, or quoted too long ago', () => {
    const p = createPlayer(db, T0);
    seedMarket('unlisted', { listed: 0 });
    seedMarket('decided', { outcome: 'yes' });
    seedMarket('over', { ends_at: T0 });
    seedMarket('unquoted', { yes_price: null, quoted_at: null });
    seedMarket('stale', { quoted_at: T0 - 15 * MIN - 1 });
    for (const id of ['nope', 'unlisted', 'decided', 'over', 'unquoted', 'stale']) {
      expect(refusal(() => openWireCall(db, p, id, 'yes', T0))).toBe('wire_closed');
    }
    // nothing was spent
    expect(playerView(db, p, T0).risk).toBe(100);
    // the freshness boundary: exactly 15 minutes old is still live
    seedMarket('edge', { quoted_at: T0 - 15 * MIN });
    expect(openWireCall(db, p, 'edge', 'yes', T0).payout).toBe(200);
  });

  it('refuses a second call on the same market, either side', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1');
    openWireCall(db, p, 'm1', 'yes', T0);
    expect(refusal(() => openWireCall(db, p, 'm1', 'no', T0))).toBe('wire_taken');
    expect(playerView(db, p, T0).risk).toBe(80);
  });

  it('allows five open calls and refuses the sixth before spending anything', () => {
    const p = createPlayer(db, T0);
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) seedMarket(id);
    for (const id of ['a', 'b', 'c', 'd', 'e']) openWireCall(db, p, id, 'yes', T0);
    expect(playerView(db, p, T0).risk).toBe(0); // 5 x 20 of 100
    expect(refusal(() => openWireCall(db, p, 'f', 'yes', T0))).toBe('wire_full');
    expect(wireView(db, p, T0).positions).toHaveLength(5);
  });

  it('refuses with low_bar under 20 Risk and leaves the bar and the book alone', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1');
    db.prepare(`UPDATE players SET risk = 19 WHERE id = ?`).run(p);
    expect(refusal(() => openWireCall(db, p, 'm1', 'yes', T0))).toBe('low_bar');
    expect(playerView(db, p, T0).risk).toBe(19);
    expect(wireView(db, p, T0).positions).toEqual([]);
  });

  it('refuses a side that is neither yes nor no', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1');
    expect(refusal(() => openWireCall(db, p, 'm1', 'maybe' as 'yes', T0))).toBe('bad_action');
  });
});

describe('wireView', () => {
  it('lists live markets by end time with both payouts, and hides a stale quote', () => {
    const p = createPlayer(db, T0);
    seedMarket('late', { ends_at: T0 + 3 * HOUR, yes_price: 0.4 });
    seedMarket('soon', { ends_at: T0 + 1 * HOUR, yes_price: 0.9 });
    seedMarket('stale', { quoted_at: T0 - 16 * MIN });
    const { markets } = wireView(db, p, T0);
    expect(markets.map((m) => m.marketId)).toEqual(['soon', 'late']);
    // soon: YES 0.9 -> 111.1 -> 111; NO 0.1 -> 1000 -> cap 700
    expect(markets[0]).toMatchObject({ yesPrice: 0.9, quotedAt: T0, payoutYes: 111, payoutNo: 700 });
    // late: YES 0.4 -> 250; NO 0.6 -> 166.67 -> 167
    expect(markets[1]).toMatchObject({ payoutYes: 250, payoutNo: 167, endsAt: T0 + 3 * HOUR, settlesAt: T0 + DAY });
  });
});

describe('settleWire', () => {
  it('pays a right call exactly its payout as Unsettled with kind wire; a wrong call posts nothing; void posts nothing', () => {
    const win = createPlayer(db, T0), lose = createPlayer(db, T0), voided = createPlayer(db, T0);
    seedMarket('m1', { yes_price: 0.25 });
    seedMarket('m2');
    openWireCall(db, win, 'm1', 'yes', T0); // 0.25 -> 400
    openWireCall(db, lose, 'm1', 'no', T0); // 0.75 -> 133
    openWireCall(db, voided, 'm2', 'yes', T0);
    db.prepare(`UPDATE wire_markets SET outcome = 'yes' WHERE market_id = 'm1'`).run();
    db.prepare(`UPDATE wire_markets SET outcome = 'cancelled' WHERE market_id = 'm2'`).run();

    expect(settleWire(db, null, T0 + HOUR)).toBe(3);

    expect(ledgerView(db, win)[0]).toMatchObject({ settled: 0, unsettled: 400, kind: 'wire', ref: 'm1', at: T0 + HOUR });
    const w = playerView(db, win, T0 + HOUR);
    expect([w.scripSettled, w.scripUnsettled]).toEqual([0, 400]);
    for (const q of [lose, voided]) {
      expect(ledgerCount(q)).toBe(0);
      const v = playerView(db, q, T0 + HOUR);
      expect([v.scripSettled, v.scripUnsettled]).toEqual([0, 0]);
    }
    const status = (pid: number) => wireView(db, pid, T0 + HOUR).positions[0];
    expect(status(win)).toMatchObject({ status: 'won', settledAt: T0 + HOUR });
    expect(status(lose).status).toBe('nicked');
    expect(status(voided).status).toBe('void');
  });

  it('settling twice posts once', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1', { yes_price: 0.5 });
    openWireCall(db, p, 'm1', 'yes', T0);
    db.prepare(`UPDATE wire_markets SET outcome = 'yes' WHERE market_id = 'm1'`).run();
    expect(settleWire(db, p, T0 + HOUR)).toBe(1);
    expect(settleWire(db, p, T0 + 2 * HOUR)).toBe(0);
    expect(settleWire(db, null, T0 + 3 * HOUR)).toBe(0);
    expect(ledgerCount(p)).toBe(1);
    expect(playerView(db, p, T0 + 3 * HOUR).scripUnsettled).toBe(200);
  });

  it('leaves positions open until the market has an outcome, and a player-scoped settle touches only that player', () => {
    const a = createPlayer(db, T0), b = createPlayer(db, T0);
    seedMarket('m1');
    openWireCall(db, a, 'm1', 'yes', T0);
    openWireCall(db, b, 'm1', 'yes', T0);
    expect(settleWire(db, null, T0 + HOUR)).toBe(0);
    db.prepare(`UPDATE wire_markets SET outcome = 'yes' WHERE market_id = 'm1'`).run();
    expect(settleWire(db, a, T0 + HOUR)).toBe(1);
    expect(wireView(db, b, T0 + HOUR).positions[0].status).toBe('open');
    expect(playerView(db, b, T0 + HOUR).scripUnsettled).toBe(0);
  });

  it('keeps the ledger conserved after a win (goes red if wire leaves the mint list)', () => {
    const p = createPlayer(db, T0);
    seedMarket('m1', { yes_price: 0.25 });
    openWireCall(db, p, 'm1', 'yes', T0);
    db.prepare(`UPDATE wire_markets SET outcome = 'yes' WHERE market_id = 'm1'`).run();
    settleWire(db, null, T0 + HOUR);
    expect(conservationAudit(db)).toEqual({ holds: true, playerTotal: 400, treasury: 0, minted: 400 });
  });
});

describe('wireTick against the fixture', () => {
  it('lists the first five valid markets by end time and applies the listing rule', async () => {
    const r = await wireTick(db, fixtureClient(FIXTURE), T0);
    // x-noquote (ends first) fails to quote and is dropped; m-f is sixth; the other
    // x- markets break politics / title / resolved / 30 min / 14 d / primary-phase.
    expect(listedIds()).toEqual(['m-a', 'm-b', 'm-c', 'm-d', 'm-e']);
    const stored = (db.prepare(`SELECT market_id FROM wire_markets ORDER BY market_id`).all() as { market_id: string }[]).map((x) => x.market_id);
    expect(stored).toEqual(['m-a', 'm-b', 'm-c', 'm-d', 'm-e']);
    expect(r).toEqual({ listed: 5, decided: 0, settled: 0, calls: 7 }); // list + x-noquote + 5 quotes

    const p = createPlayer(db, T0);
    const { markets } = wireView(db, p, T0);
    expect(markets.map((m) => m.marketId)).toEqual(['m-a', 'm-b', 'm-c', 'm-d', 'm-e']);
    expect(markets.map((m) => m.yesPrice)).toEqual([0.5, 0.25, 0.1, 0.95, 0.6]);
    expect(markets.map((m) => [m.payoutYes, m.payoutNo])).toEqual([
      [200, 200], // 0.5 / 0.5
      [400, 133], // 0.25 / 0.75 -> 133.3
      [700, 111], // 0.1 -> 1000 capped / 0.9 -> 111.1
      [105, 700], // 0.95 -> 105.3 / 0.05 -> 2000 capped
      [167, 250], // 0.6 -> 166.7 / 0.4
    ]);
    expect(markets[0]).toMatchObject({
      title: 'Haaland 8+ points, GW6', category: 'sports', quotedAt: T0,
      endsAt: (1_800_000_000 + 2 * 3600) * 1000, settlesAt: (1_800_000_000 + 86_400) * 1000,
    });
  });

  it('keeps an old quote while it is fresh, then takes the market off the Wire', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wire-'));
    try {
      const path = join(dir, 'world.json');
      const world = JSON.parse(readFileSync(FIXTURE, 'utf8'));
      writeFileSync(path, JSON.stringify(world));
      const client = fixtureClient(path);
      await wireTick(db, client, T0);
      delete world.quotes['m-a']; // Panta stops quoting m-a
      writeFileSync(path, JSON.stringify(world));

      await wireTick(db, client, T0 + 10 * MIN); // old quote is 10 min old: kept
      expect(listedIds()).toEqual(['m-a', 'm-b', 'm-c', 'm-d', 'm-e']);
      expect(db.prepare(`SELECT quoted_at FROM wire_markets WHERE market_id = 'm-a'`).get()).toEqual({ quoted_at: T0 });

      await wireTick(db, client, T0 + 16 * MIN); // 16 min old: off, and m-f takes the slot
      expect(listedIds()).toEqual(['m-b', 'm-c', 'm-d', 'm-e', 'm-f']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('survives a Panta outage: the tick logs, nothing throws, listings age out by staleness', async () => {
    await wireTick(db, fixtureClient(FIXTURE), T0);
    const down: WireClient = {
      ...fixtureClient(FIXTURE), calls: 0,
      listPrimary: async () => { throw new Error('panta 503 /markets/'); },
      marketDetail: async () => { throw new Error('panta 503'); },
    };
    const log: string[] = [];
    const r = await wireTick(db, down, T0 + 5 * MIN, (m) => log.push(m));
    expect(r.listed).toBe(0);
    expect(log.some((l) => l.includes('catalog failed'))).toBe(true);
    const p = createPlayer(db, T0);
    expect(wireView(db, p, T0 + 5 * MIN).markets).toHaveLength(5); // still within 15 min
    expect(wireView(db, p, T0 + 16 * MIN).markets).toEqual([]); // fail closed once stale
  });

  describe('outcomes', () => {
    /** One player per side on each settled market, all opened at T0 while the markets were live. */
    function setup() {
      for (const id of ['s-yes', 's-no', 's-cancel', 's-unreadable', 's-pending']) {
        seedMarket(id, { ends_at: T0 + HOUR, settles_at: T0 + DAY });
      }
      const yes = createPlayer(db, T0), no = createPlayer(db, T0);
      for (const id of ['s-yes', 's-no', 's-cancel', 's-unreadable', 's-pending']) {
        openWireCall(db, yes, id, 'yes', T0);
        openWireCall(db, no, id, 'no', T0);
      }
      // cap: 5 open each is exactly the maximum
      return { yes, no };
    }
    const pos = (pid: number, market: string) =>
      wireView(db, pid, T0).positions.find((x) => x.marketId === market)!.status;
    const outcomeOf = (id: string) => (db.prepare(`SELECT outcome FROM wire_markets WHERE market_id = ?`).get(id) as { outcome: string | null }).outcome;

    it('reads outcomes via a holder, settles in the same tick, and leaves the unreadable one open for 72 h', async () => {
      const { yes, no } = setup();
      const now = T0 + 2 * DAY;
      const r = await wireTick(db, fixtureClient(FIXTURE), now);
      expect(r.calls).toBeLessThanOrEqual(20);
      expect(['s-yes', 's-no', 's-cancel', 's-unreadable', 's-pending'].map(outcomeOf))
        .toEqual(['yes', 'no', 'cancelled', null, null]);
      expect(r.decided).toBe(3);
      expect(r.settled).toBe(6); // 2 positions on each of the 3 decided markets

      expect([pos(yes, 's-yes'), pos(no, 's-yes')]).toEqual(['won', 'nicked']);
      expect([pos(yes, 's-no'), pos(no, 's-no')]).toEqual(['nicked', 'won']);
      expect([pos(yes, 's-cancel'), pos(no, 's-cancel')]).toEqual(['void', 'void']);
      expect([pos(yes, 's-unreadable'), pos(yes, 's-pending')]).toEqual(['open', 'open']);
      // 0.5 quotes: 200 each. yes won s-yes, no won s-no.
      expect(playerView(db, yes, now).scripUnsettled).toBe(200);
      expect(playerView(db, no, now).scripUnsettled).toBe(200);
      expect(ledgerCount(yes) + ledgerCount(no)).toBe(2);
      expect(conservationAudit(db).holds).toBe(true);
    });

    it('voids an unreadable outcome once 72 h have passed since it should have settled, not before', async () => {
      const { yes, no } = setup();
      const settlesAt = T0 + DAY;
      await wireTick(db, fixtureClient(FIXTURE), settlesAt + 72 * HOUR);
      expect(outcomeOf('s-unreadable')).toBeNull(); // exactly 72 h: not yet
      expect(outcomeOf('s-pending')).toBeNull();
      await wireTick(db, fixtureClient(FIXTURE), settlesAt + 72 * HOUR + 1);
      expect(outcomeOf('s-unreadable')).toBe('cancelled');
      expect(outcomeOf('s-pending')).toBe('cancelled');
      expect([pos(yes, 's-unreadable'), pos(no, 's-pending')]).toEqual(['void', 'void']);
      // void pays nothing: the only Unsettled is from the two decided markets (200 each side)
      expect(playerView(db, yes, settlesAt + 73 * HOUR).scripUnsettled).toBe(200);
    });

    /** A hand-built Panta for the holder order and the budget. */
    function stub(o: Partial<WireClient> & { onVia?: (w: string) => void }): WireClient & { log: string[] } {
      let calls = 0;
      const log: string[] = [];
      const wrap = <A extends unknown[], R>(f: (...a: A) => Promise<R>) => (...a: A) => { calls++; return f(...a); };
      // overrides are metered like the defaults, so the budget counts every request
      const f = {
        listPrimary: async () => [],
        quoteYesPrice: async () => null,
        marketDetail: async () => ({ resolved: true, phase: 'resolved', creatorAddress: 'creator' }),
        recentBuyers: async () => ['b1', 'b2', 'b3'],
        outcomeVia: async (w: string): Promise<PantaOutcome | null> => { log.push(w); return null; },
        ...o,
      } as WireClient;
      return {
        log,
        get calls() { return calls; },
        listPrimary: wrap(f.listPrimary),
        quoteYesPrice: wrap(f.quoteYesPrice),
        marketDetail: wrap(f.marketDetail),
        recentBuyers: wrap(f.recentBuyers),
        outcomeVia: wrap(f.outcomeVia),
      };
    }

    it('tries the creator, then buyers in order, skipping wallets that error or show nothing', async () => {
      seedMarket('m1', { ends_at: T0 + HOUR, settles_at: T0 + HOUR });
      const p = createPlayer(db, T0);
      openWireCall(db, p, 'm1', 'no', T0);
      const seen: string[] = [];
      const client = stub({
        outcomeVia: async (w) => {
          seen.push(w);
          if (w === 'creator') throw new Error('panta 400');
          return w === 'b2' ? 'no' : null;
        },
      });
      const r = await wireTick(db, client, T0 + 2 * HOUR);
      expect(seen).toEqual(['creator', 'b1', 'b2']); // stops at the first answer
      expect(outcomeOf('m1')).toBe('no');
      expect(r.settled).toBe(1);
      expect(playerView(db, p, T0 + 2 * HOUR).scripUnsettled).toBe(200);
    });

    it('takes a market Panta itself marks cancelled as void without asking a holder', async () => {
      seedMarket('m1', { ends_at: T0 + HOUR, settles_at: T0 + HOUR });
      const p = createPlayer(db, T0);
      openWireCall(db, p, 'm1', 'yes', T0);
      const client = stub({ marketDetail: async () => ({ resolved: true, phase: 'cancelled', creatorAddress: 'creator' }) });
      await wireTick(db, client, T0 + 2 * HOUR);
      expect(client.log).toEqual([]);
      expect(wireView(db, p, T0 + 2 * HOUR).positions[0].status).toBe('void');
    });

    it('never spends more than 20 Panta requests in a tick', async () => {
      const p = createPlayer(db, T0);
      for (let i = 0; i < 5; i++) {
        seedMarket(`m${i}`, { ends_at: T0 + HOUR, settles_at: T0 + HOUR });
        openWireCall(db, p, `m${i}`, 'yes', T0);
      }
      // each market is resolved but no holder shows it: detail + creator + tape + 5 buyers = 8 requests
      const client = stub({ recentBuyers: async () => ['b1', 'b2', 'b3', 'b4', 'b5'] });
      const r = await wireTick(db, client, T0 + 2 * HOUR);
      expect(r.calls).toBeLessThanOrEqual(20);
      expect(r.calls).toBeGreaterThan(8); // it did work on more than one market
      expect(r.decided).toBe(0);
    });

    describe('past 72 h, only a full answer voids', () => {
      const LATE = T0 + HOUR + 72 * HOUR + 1; // markets below settle at T0 + 1 h
      function openBoth(id: string) {
        seedMarket(id, { ends_at: T0 + HOUR, settles_at: T0 + HOUR });
        const yes = createPlayer(db, T0), no = createPlayer(db, T0);
        openWireCall(db, yes, id, 'yes', T0);
        openWireCall(db, no, id, 'no', T0);
        return { yes, no };
      }

      it('a failed market read leaves it open, and the next tick pays the real winner', async () => {
        const { yes, no } = openBoth('m1');
        await wireTick(db, stub({ marketDetail: async () => { throw new Error('panta 503 /markets/m1/'); } }), LATE);
        expect(outcomeOf('m1')).toBeNull();
        expect([pos(yes, 'm1'), pos(no, 'm1')]).toEqual(['open', 'open']);

        await wireTick(db, stub({ outcomeVia: async (w) => (w === 'creator' ? 'yes' : null) }), LATE + 10 * MIN);
        expect(outcomeOf('m1')).toBe('yes');
        expect([pos(yes, 'm1'), pos(no, 'm1')]).toEqual(['won', 'nicked']);
        expect(playerView(db, yes, LATE + 10 * MIN).scripUnsettled).toBe(200);
      });

      it('a holder or the tape that errors is not an answer: no void while any of them failed', async () => {
        const a = openBoth('m-holder'), b = openBoth('m-tape');
        await wireTick(db, stub({
          outcomeVia: async (w, id) => { if (id === 'm-holder' && w === 'b2') throw new Error('panta 429'); return null; },
          recentBuyers: async (id) => { if (id === 'm-tape') throw new Error('panta 500'); return ['b1', 'b2', 'b3']; },
        }), LATE);
        expect([outcomeOf('m-holder'), outcomeOf('m-tape')]).toEqual([null, null]);
        expect([pos(a.yes, 'm-holder'), pos(b.yes, 'm-tape')]).toEqual(['open', 'open']);
      });

      it('a read cut short by the budget is not an answer: that market waits, a fully asked one voids', async () => {
        const first = openBoth('m0'), second = openBoth('m1'), cut = openBoth('m2');
        // catalog 1; m0 and m1 each take detail + creator + tape + 5 buyers = 8 (17 total);
        // m2 gets detail, creator and tape (20), then b1..b5 are never asked.
        const asked: string[] = [];
        const r = await wireTick(db, stub({ recentBuyers: async () => ['b1', 'b2', 'b3', 'b4', 'b5'] }), LATE);
        expect(r.calls).toBe(20);
        expect([outcomeOf('m0'), outcomeOf('m1'), outcomeOf('m2')]).toEqual(['cancelled', 'cancelled', null]);
        expect([pos(first.yes, 'm0'), pos(second.yes, 'm1'), pos(cut.yes, 'm2')]).toEqual(['void', 'void', 'open']);

        // next tick m2 is the only one left and b5 shows the outcome
        await wireTick(db, stub({
          recentBuyers: async () => ['b1', 'b2', 'b3', 'b4', 'b5'],
          outcomeVia: async (w, id) => { asked.push(`${id}:${w}`); return id === 'm2' && w === 'b5' ? 'yes' : null; },
        }), LATE + 10 * MIN);
        expect(asked).toEqual(['m2:creator', 'm2:b1', 'm2:b2', 'm2:b3', 'm2:b4', 'm2:b5']);
        expect(outcomeOf('m2')).toBe('yes');
        expect([pos(cut.yes, 'm2'), pos(cut.no, 'm2')]).toEqual(['won', 'nicked']);
      });
    });
  });
});

describe('the Panta client', () => {
  type Reply = { status: number; body: unknown };
  function stubFetch(replies: (url: string, init: RequestInit) => Reply) {
    const seen: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      const r = replies(url, init);
      return new Response(JSON.stringify(r.body), { status: r.status });
    });
    return seen;
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const client = () => pantaClient('pk_live_test', 'WALLETWALLETWALLET');

  it('quotes YES first; sends the key, a user agent, and a $1.00 simulated fill', async () => {
    const seen = stubFetch(() => ({ status: 200, body: { avgPrice: '0.496516' } }));
    expect(await client().quoteYesPrice('M1')).toBeCloseTo(0.496516, 6);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://live-api.panta.market/api/v1/primaryorderquote/');
    const h = seen[0].init.headers as Record<string, string>;
    expect(h['X-Api-Key']).toBe('pk_live_test');
    expect(h['User-Agent']).toMatch(/^outfox-wire\//);
    expect(JSON.parse(String(seen[0].init.body))).toEqual({ wallet: 'WALLETWALLETWALLET', marketId: 'M1', side: 'yes', amountUsdc: '1.00' });
  });

  it('falls back to the NO quote when YES answers 400: yesPrice is one minus it', async () => {
    const seen = stubFetch((_u, init) => JSON.parse(String(init.body)).side === 'yes'
      ? { status: 400, body: { code: 'INVALID_MARKET_PARAMS' } }
      : { status: 200, body: { avgPrice: '0.30' } });
    expect(await client().quoteYesPrice('M1')).toBeCloseTo(0.7, 9);
    expect(seen).toHaveLength(2);
  });

  it('drops the market (null) when both sides fail, and refuses prices that are not a chance', async () => {
    stubFetch(() => ({ status: 400, body: { code: 'INVALID_MARKET_PARAMS' } }));
    expect(await client().quoteYesPrice('M1')).toBeNull();
    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 200, body: { avgPrice: '1.2' } }));
    expect(await client().quoteYesPrice('M1')).toBeNull();
    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 200, body: { avgPrice: '0' } }));
    expect(await client().quoteYesPrice('M1')).toBeNull();
  });

  it('reads the outcome from the holder\'s own row for that market, and a cancelled phase as cancelled', async () => {
    const positions = [
      { marketId: 'OTHER', outcome: 'yes', phase: 'resolved' },
      { marketId: 'M1', side: 'no', outcome: 'no', phase: 'resolved' },
      { marketId: 'M2', outcome: null, phase: 'cancelled' },
      { marketId: 'M3', outcome: null, phase: 'secondary' },
    ];
    stubFetch(() => ({ status: 200, body: { wallet: 'W', positions } }));
    expect(await client().outcomeVia('W', 'M1')).toBe('no');
    expect(await client().outcomeVia('W', 'M2')).toBe('cancelled');
    expect(await client().outcomeVia('W', 'M3')).toBeNull();
    expect(await client().outcomeVia('W', 'ABSENT')).toBeNull();
  });

  it('takes at most N distinct buy wallets from the tape', async () => {
    const items = [
      { wallet: 'A', kind: 'buy' }, { wallet: 'A', kind: 'buy' }, { wallet: 'S', kind: 'sell' },
      { wallet: 'B', kind: 'buy' }, { wallet: 'C', kind: 'buy' },
    ];
    stubFetch(() => ({ status: 200, body: { items } }));
    expect(await client().recentBuyers('M1', 2)).toEqual(['A', 'B']);
  });

  it('pages the catalog with the cursor and returns plain Errors on HTTP failure', async () => {
    const row = (id: string) => ({ marketId: id, title: id, category: 'sports', status: 'primary', phase: 'primary', resolved: false, endTime: 5, resolutionTime: 6 });
    const seen = stubFetch((url) => url.includes('cursor=CUR')
      ? { status: 200, body: { items: [row('B')], nextCursor: null } }
      : { status: 200, body: { items: [row('A')], nextCursor: 'CUR' } });
    expect((await client().listPrimary()).map((m) => m.marketId)).toEqual(['A', 'B']);
    expect(seen[0].url).toContain('/markets/?status=primary&limit=50');

    vi.unstubAllGlobals();
    stubFetch(() => ({ status: 500, body: {} }));
    const err = await client().listPrimary().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(EngineError);
  });

  it('is off without a key, refuses the fixture in production, and builds a client otherwise', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('OUTFOX_PANTA_KEY', ''); vi.stubEnv('OUTFOX_WIRE_FIXTURE', '');
    expect(wireConfigFromEnv()).toBeNull();
    vi.stubEnv('OUTFOX_WIRE_FIXTURE', FIXTURE); vi.stubEnv('NODE_ENV', 'production');
    expect(wireConfigFromEnv()).toBeNull();
    vi.stubEnv('NODE_ENV', 'test');
    expect(wireConfigFromEnv()).not.toBeNull();
    vi.stubEnv('OUTFOX_WIRE_FIXTURE', ''); vi.stubEnv('OUTFOX_PANTA_KEY', 'pk_live_x');
    expect(wireConfigFromEnv()).not.toBeNull();
  });
});
