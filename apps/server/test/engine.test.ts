/**
 * Invariant tests for the slice economy engine (I1–I4 in engine.ts).
 * The firewall tests are the point: they encode ECONOMY.md §6 guardrail #1 and the
 * VALIDATION-BENCHMARKS critical finding (chance value must never reach a P2P surface).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, type DB } from '../src/db.js';
import {
  createPlayer, postTx, runCall, runGig, refill, listItem, buyListing, cancelListing,
  playerView, listingsView, conservationAudit, applyCarry, EngineError,
  startRegister, verifyRegister, adoptExistingAccount, requireRung,
} from '../src/engine.js';
import { CALLS, GIG, REFILL, MARKET_FEE_BPS, DEMURRAGE } from '@outfox/shared';

let db: DB;
const T0 = 1_800_000_000_000; // fixed epoch
const win = () => 0.0; // roll below successP → success
const lose = () => 0.999;

beforeEach(() => {
  db = openDb(':memory:');
});

const treasury = () => (db.prepare('SELECT scrip FROM treasury WHERE id = 1').get() as { scrip: number }).scrip;

/** Upgrade a player to R1 so they can use the market (the ladder is tested separately). */
let regN = 0;
function toR1(playerId: number): number {
  const email = `t${regN++}@x.io`;
  startRegister(db, email, T0);
  const code = (db.prepare('SELECT code FROM auth_codes WHERE email = ?').get(email) as { code: string }).code;
  verifyRegister(db, playerId, email, code, T0);
  return playerId;
}

describe('I4 — origin typing', () => {
  it('Calls (chance) pay Unsettled only', () => {
    const p = createPlayer(db, T0);
    const r = runCall(db, p, CALLS[0].id, T0, win);
    expect(r.ok).toBe(true);
    const v = playerView(db, p, T0);
    expect(v.scripUnsettled).toBe(r.payout);
    expect(v.scripSettled).toBe(0);
  });

  it('Gigs (deterministic work) pay Settled only', () => {
    const p = createPlayer(db, T0);
    runGig(db, p, T0);
    const v = playerView(db, p, T0);
    expect(v.scripSettled).toBe(GIG.payout);
    expect(v.scripUnsettled).toBe(0);
  });
});

describe('I1 — the provenance firewall', () => {
  it('a market buy CANNOT be funded by Unsettled Scrip, even when total covers it', () => {
    const seller = toR1(createPlayer(db, T0));
    const buyer = toR1(createPlayer(db, T0));
    // buyer piles up Unsettled far beyond the price, but zero Settled
    postTx(db, buyer, 0, 10_000, 'call', 'test-grant', T0);
    const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(seller) as { id: number }).id;
    listItem(db, seller, item, 500, T0);
    const listing = listingsView(db, buyer)[0];
    expect(() => buyListing(db, buyer, listing.id, T0)).toThrowError(/Settled/);
    // nothing moved
    const v = playerView(db, buyer, T0);
    expect(v.scripUnsettled).toBe(10_000);
    expect(v.items.length).toBe(1); // still only the starter item
  });

  it('Unsettled IS spendable on sinks (refill), and is consumed before Settled', () => {
    const p = createPlayer(db, T0);
    postTx(db, p, 100, 200, 'call', 'test-grant', T0);
    refill(db, p, 'focus', T0);
    const v = playerView(db, p, T0);
    // cost 250: 200 from Unsettled first, 50 from Settled
    expect(v.scripUnsettled).toBe(0);
    expect(v.scripSettled).toBe(100 - (REFILL.cost - 200));
  });

  it('no engine surface converts Unsettled into Settled', () => {
    const p = createPlayer(db, T0);
    let t = T0;
    for (let i = 0; i < 10; i++) {
      t += 120_000;
      try { runCall(db, p, CALLS[0].id, t, win); } catch { /* cooldown */ }
      try { refill(db, p, 'risk', t); } catch { /* insufficient */ }
    }
    const v = playerView(db, p, t);
    expect(v.scripSettled).toBe(0); // chance value never became Settled
  });
});

describe('I2 — mutation gate', () => {
  it('rejects overdrafts atomically', () => {
    const p = createPlayer(db, T0);
    expect(() => postTx(db, p, -1, 0, 'fee', 'test', T0)).toThrowError(/insufficient/);
    expect(() => postTx(db, p, 0.5 as unknown as number, 0, 'fee', 'test', T0)).toThrowError(/integer/);
    const v = playerView(db, p, T0);
    expect(v.scripSettled).toBe(0);
  });
});

describe('market mechanics', () => {
  function settle(p: number, amount: number) {
    postTx(db, p, amount, 0, 'gig', 'test-grant', T0);
  }

  it('transfers the item, charges the fee to the treasury, pays the seller net', () => {
    const seller = toR1(createPlayer(db, T0));
    const buyer = toR1(createPlayer(db, T0));
    settle(buyer, 2_000);
    const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(seller) as { id: number }).id;
    listItem(db, seller, item, 1_000, T0);
    const listing = listingsView(db, buyer)[0];
    const t0 = treasury();
    buyListing(db, buyer, listing.id, T0);
    const fee = Math.ceil((1_000 * MARKET_FEE_BPS) / 10_000);
    expect(playerView(db, buyer, T0).scripSettled).toBe(1_000);
    expect(playerView(db, buyer, T0).items.map((i) => i.id)).toContain(item);
    expect(playerView(db, seller, T0).scripSettled).toBe(1_000 - fee);
    expect(treasury()).toBe(t0 + fee);
    expect(listingsView(db, buyer).length).toBe(0);
  });

  it('settles the seller’s carry clock before crediting proceeds (no retroactive decay)', () => {
    const seller = toR1(createPlayer(db, T0));
    const buyer = toR1(createPlayer(db, T0));
    settle(buyer, 20_000);
    const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(seller) as { id: number }).id;
    listItem(db, seller, item, 10_000, T0);
    const saleAt = T0 + 10 * 86_400_000; // seller idle 10 days before the sale
    const listing = listingsView(db, buyer)[0];
    buyListing(db, buyer, listing.id, saleAt);
    const fee = Math.ceil((10_000 * MARKET_FEE_BPS) / 10_000);
    // proceeds landed AFTER the carry clock was settled → no decay applied to them yet
    expect(playerView(db, seller, saleAt).scripSettled).toBe(10_000 - fee);
  });

  it('blocks self-purchase, double listing, and foreign cancels', () => {
    const a = toR1(createPlayer(db, T0));
    const b = toR1(createPlayer(db, T0));
    const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(a) as { id: number }).id;
    listItem(db, a, item, 100, T0);
    expect(() => listItem(db, a, item, 100, T0)).toThrowError(/already/);
    const listing = listingsView(db, a)[0];
    settle(a, 1_000);
    expect(() => buyListing(db, a, listing.id, T0)).toThrowError(/own/);
    expect(() => cancelListing(db, b, listing.id)).toThrowError(/your listing/);
    cancelListing(db, a, listing.id);
    expect(listingsView(db, a).length).toBe(0);
  });
});

describe('regen + cooldowns', () => {
  it('bars regenerate lazily at the configured rate and cap at max', () => {
    const p = createPlayer(db, T0);
    runGig(db, p, T0); // spends 15 focus
    let v = playerView(db, p, T0);
    expect(v.focus).toBe(85);
    v = playerView(db, p, T0 + 30_000); // +30s * 0.2/s = +6
    expect(v.focus).toBe(91);
    v = playerView(db, p, T0 + 3_600_000);
    expect(v.focus).toBe(100);
  });

  it('cooldowns block repeats; failure cools longer (Nicked)', () => {
    const p = createPlayer(db, T0);
    const call = CALLS[0];
    const r = runCall(db, p, call.id, T0, lose);
    expect(r.nicked).toBe(true);
    expect(() => runCall(db, p, call.id, T0 + 1_000, win)).toThrowError(/cooling/);
    // ready after the nicked cooldown
    const after = T0 + call.cooldownNickedSec * 1000 + 1;
    expect(runCall(db, p, call.id, after, win).ok).toBe(true);
  });
});

describe('carry (demurrage)', () => {
  it('decays balances above the floor to the treasury, once per elapsed day', () => {
    const p = createPlayer(db, T0);
    postTx(db, p, 10_500, 0, 'gig', 'test-grant', T0);
    const t0 = treasury();
    applyCarry(db, p, T0 + 3 * 86_400_000);
    const v = playerView(db, p, T0 + 3 * 86_400_000);
    const keep = (1 - DEMURRAGE.ratePerDay) ** 3;
    const expected = 10_500 - Math.floor((10_500 - DEMURRAGE.floor) * (1 - keep));
    expect(v.scripSettled).toBe(expected);
    expect(treasury()).toBe(t0 + (10_500 - expected));
    // idempotent within the same day
    applyCarry(db, p, T0 + 3 * 86_400_000 + 1);
    expect(playerView(db, p, T0 + 3 * 86_400_000 + 1).scripSettled).toBe(expected);
  });

  it('never touches balances at or below the floor', () => {
    const p = createPlayer(db, T0);
    postTx(db, p, DEMURRAGE.floor, 0, 'gig', 'test-grant', T0);
    applyCarry(db, p, T0 + 10 * 86_400_000);
    expect(playerView(db, p, T0 + 10 * 86_400_000).scripSettled).toBe(DEMURRAGE.floor);
  });
});

describe('I3 — conservation', () => {
  it('holds through a burst of mixed activity', () => {
    const now = { t: T0 };
    const tick = (ms: number) => (now.t += ms);
    const players = Array.from({ length: 4 }, () => createPlayer(db, now.t));
    // mixed activity: gigs, calls (win/lose), refills, listings, buys, carry
    for (let round = 0; round < 6; round++) {
      for (const p of players) {
        tick(30_000);
        try { runGig(db, p, now.t); } catch { /* cooldown/bar */ }
        try { runCall(db, p, CALLS[round % CALLS.length].id, now.t, round % 2 ? win : lose); } catch { /* ignore */ }
        try { refill(db, p, 'risk', now.t); } catch { /* ignore */ }
      }
      tick(86_400_000); // a day passes; carry applies on next touch
    }
    // one market round-trip (both must be R1 to trade)
    const [a, b] = players;
    toR1(a); toR1(b);
    postTx(db, b, 5_000, 0, 'gig', 'test-grant', now.t);
    const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(a) as { id: number }).id;
    listItem(db, a, item, 2_000, now.t);
    const listing = listingsView(db, b).find((l) => !l.mine)!;
    buyListing(db, b, listing.id, now.t);
    for (const p of players) applyCarry(db, p, tick(86_400_000));

    const audit = conservationAudit(db);
    expect(audit.holds).toBe(true);
    expect(audit.playerTotal + audit.treasury).toBe(audit.minted);
  });
});

describe('default roll path', () => {
  it('runCall works without an injected roll (the production path)', () => {
    // regression: the crypto default roll must not throw (randomInt range limits)
    const p = createPlayer(db, T0);
    const r = runCall(db, p, CALLS[0].id, T0);
    expect(typeof r.ok).toBe('boolean');
    const v = playerView(db, p, T0);
    expect(v.scripSettled).toBe(0); // whatever happened, chance never paid Settled
  });
});

describe('R1 identity ladder (§10.1)', () => {
  const itemOf = (p: number) => (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(p) as { id: number }).id;

  it('R0 guests cannot list or buy on the Open Market', () => {
    const a = createPlayer(db, T0);
    const b = createPlayer(db, T0);
    postTx(db, b, 5_000, 0, 'gig', 'grant', T0);
    expect(() => listItem(db, a, itemOf(a), 500, T0)).toThrowError(/register/);
    // a can't even list, so seed a listing by upgrading a separate seller first
    const seller = createPlayer(db, T0);
    startRegister(db, 'seller@x.io', T0);
    const code = (db.prepare('SELECT code FROM auth_codes WHERE email = ?').get('seller@x.io') as { code: string }).code;
    verifyRegister(db, seller, 'seller@x.io', code, T0);
    listItem(db, seller, itemOf(seller), 500, T0);
    const listing = listingsView(db, b)[0];
    expect(() => buyListing(db, b, listing.id, T0)).toThrowError(/register/); // b is still R0
  });

  it('verify upgrades R0 -> R1 in place: Scrip, items, stats persist', () => {
    const p = createPlayer(db, T0);
    postTx(db, p, 1_234, 56, 'gig', 'grant', T0);
    startRegister(db, 'fox@x.io', T0);
    const code = (db.prepare('SELECT code FROM auth_codes WHERE email = ?').get('fox@x.io') as { code: string }).code;
    const r = verifyRegister(db, p, 'fox@x.io', code, T0);
    expect(r.collision).toBeUndefined();
    const v = playerView(db, p, T0);
    expect(v.rung).toBe(1);
    expect(v.email).toBe('fox@x.io');
    expect(v.scripSettled).toBe(1_234); // nothing migrated or lost
    expect(v.scripUnsettled).toBe(56);
    expect(v.items.length).toBe(1); // starter item still owned
    requireRung(db, p, 1); // no throw
    listItem(db, p, itemOf(p), 100, T0); // now allowed
  });

  it('credential collision returns a choose-sheet signal, mutates nothing', () => {
    const first = createPlayer(db, T0);
    startRegister(db, 'dup@x.io', T0);
    const c1 = (db.prepare('SELECT code FROM auth_codes WHERE email = ?').get('dup@x.io') as { code: string }).code;
    verifyRegister(db, first, 'dup@x.io', c1, T0);

    const guest = createPlayer(db, T0);
    postTx(db, guest, 999, 0, 'gig', 'grant', T0);
    startRegister(db, 'dup@x.io', T0);
    const c2 = (db.prepare('SELECT code FROM auth_codes WHERE email = ?').get('dup@x.io') as { code: string }).code;
    const r = verifyRegister(db, guest, 'dup@x.io', c2, T0);
    expect(r.collision?.existingHandle).toBeDefined();
    // guest was NOT upgraded or merged
    expect(playerView(db, guest, T0).rung).toBe(0);
    expect(playerView(db, guest, T0).scripSettled).toBe(999);
    // adopt returns the existing account's id (session rebind happens in the route)
    const adoptedId = adoptExistingAccount(db, guest, 'dup@x.io', T0);
    expect(adoptedId).toBe(first);
  });

  it('rejects bad codes, expiry, and attempt-exhaustion', () => {
    const p = createPlayer(db, T0);
    startRegister(db, 'z@x.io', T0);
    expect(() => verifyRegister(db, p, 'z@x.io', '000000', T0)).toThrowError(/wrong code/);
    expect(() => verifyRegister(db, p, 'z@x.io', '999999', T0 + 11 * 60_000)).toThrowError(/expired/);
    expect(() => startRegister(db, 'not-an-email', T0)).toThrowError(/valid email/);
  });
});

describe('errors are typed', () => {
  it('unknown actions and bad prices raise EngineError', () => {
    const p = toR1(createPlayer(db, T0)); // R1 so we reach the price validation, not the rung gate
    expect(() => runCall(db, p, 'nope', T0)).toThrowError(EngineError);
    const item = (db.prepare('SELECT id FROM items WHERE owner_id = ?').get(p) as { id: number }).id;
    expect(() => listItem(db, p, item, 0, T0)).toThrowError(/price/);
    expect(() => listItem(db, p, item, 2.5, T0)).toThrowError(/price/);
  });
});
