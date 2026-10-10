/**
 * The Wire job: every ten minutes, refresh the listed markets and their quotes, read the
 * outcome of markets that have settled, and settle everyone's positions. Same shape as the
 * chain indexer: self-rescheduling, errors logged and never fatal. All of Panta's HTTP lives
 * here and in panta.ts; routes and rules only read the tables this fills.
 */
import type { DB } from '../../core/db.js';
import { withTx } from '../../core/tx.js';
import { WIRE } from '@outfox/shared';
import type { PantaMarket, PantaOutcome, WireClient } from './panta.js';
import { settleWire } from './rules.js';

/** Panta requests per tick (their limit is 120/min; this job is one polite client). */
const BUDGET = 20;
/** The catalog stops quoting at this many requests so outcome reads always have room. */
const CATALOG_CAP = 12;
const HOLDERS = 5;
const VOID_AFTER_MS = 72 * 3_600_000;
const MIN_OPEN_MS = 30 * 60_000;
const MAX_HORIZON_MS = 14 * 86_400_000;

type Log = (msg: string) => void;

/** The listing rule (spec §2): a live primary market with a title, not politics, still open
 * for at least 30 min and settling within 14 days. Quote-readability is checked after. */
function listable(m: PantaMarket, now: number): boolean {
  return m.phase === 'primary' && !m.resolved && m.title.trim() !== ''
    && m.category.trim().toLowerCase() !== 'politics'
    && m.endTime > 0 && m.resolutionTime > 0
    && m.endTime * 1000 > now + MIN_OPEN_MS
    && m.resolutionTime * 1000 <= now + MAX_HORIZON_MS;
}

async function refreshCatalog(db: DB, client: WireClient, now: number, spent: () => number): Promise<number> {
  const cands = (await client.listPrimary()).filter((m) => listable(m, now))
    .sort((a, b) => a.endTime - b.endTime || (a.marketId < b.marketId ? -1 : 1));
  const chosen: string[] = [];
  for (const m of cands) {
    if (chosen.length >= WIRE.listed) break;
    let p: number | null = null;
    if (spent() + 2 <= CATALOG_CAP) {
      try { p = await client.quoteYesPrice(m.marketId); } catch { p = null; }
    }
    if (p !== null) {
      db.prepare(
        `INSERT INTO wire_markets (market_id, title, category, ends_at, settles_at, yes_price, quoted_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (market_id) DO UPDATE SET title = excluded.title, category = excluded.category,
           ends_at = excluded.ends_at, settles_at = excluded.settles_at, yes_price = excluded.yes_price,
           quoted_at = excluded.quoted_at, updated_at = excluded.updated_at`
      ).run(m.marketId, m.title.slice(0, 300), m.category.trim() || 'other', m.endTime * 1000,
        m.resolutionTime * 1000, p, now, now);
      chosen.push(m.marketId);
    } else {
      // No fresh quote: the old one stands only while it is still fresh, else off the Wire.
      const old = db.prepare(`SELECT quoted_at FROM wire_markets WHERE market_id = ?`).get(m.marketId) as
        { quoted_at: number | null } | undefined;
      if (old?.quoted_at != null && old.quoted_at >= now - WIRE.quoteStaleSec * 1000) chosen.push(m.marketId);
    }
  }
  withTx(db, () => {
    db.prepare(`UPDATE wire_markets SET listed = 0 WHERE listed = 1`).run();
    for (const id of chosen) db.prepare(`UPDATE wire_markets SET listed = 1 WHERE market_id = ?`).run(id);
  });
  return chosen.length;
}

/** The winner is not on the market; it is on any holder's position record. Try the creator
 * (who seeds both sides), then a few distinct buyers from the public tape; skip wallets
 * that answer an error or an empty list. `complete` is true only if every holder in that
 * rule was asked and answered: a thrown call or a budget stop is not an answer. */
async function readOutcome(
  client: WireClient, marketId: string, creator: string | null, spent: () => number,
): Promise<{ outcome: PantaOutcome | null; complete: boolean }> {
  const tried = new Set<string>();
  let complete = true;
  const via = async (wallet: string): Promise<PantaOutcome | null> => {
    if (tried.has(wallet)) return null;
    if (spent() + 1 > BUDGET) { complete = false; return null; }
    tried.add(wallet);
    try { return await client.outcomeVia(wallet, marketId); } catch { complete = false; return null; }
  };
  if (creator) {
    const o = await via(creator);
    if (o) return { outcome: o, complete: true };
  }
  if (spent() + 1 > BUDGET) return { outcome: null, complete: false };
  let buyers: string[] = [];
  try { buyers = await client.recentBuyers(marketId, HOLDERS); } catch { complete = false; }
  for (const w of buyers) {
    const o = await via(w);
    if (o) return { outcome: o, complete: true };
  }
  return { outcome: null, complete };
}

async function readOutcomes(db: DB, client: WireClient, now: number, spent: () => number, log: Log): Promise<number> {
  const pending = db.prepare(
    `SELECT m.market_id, m.settles_at FROM wire_markets m
     WHERE m.outcome IS NULL AND m.settles_at <= ?
       AND EXISTS (SELECT 1 FROM wire_positions p WHERE p.market_id = m.market_id AND p.status = 'open')
     ORDER BY m.settles_at, m.market_id`
  ).all(now) as { market_id: string; settles_at: number }[];
  let decided = 0;
  for (const m of pending) {
    if (spent() + 1 > BUDGET) break;
    let outcome: PantaOutcome | null = null;
    let answered = false; // Panta answered every question the rule asks
    try {
      const d = await client.marketDetail(m.market_id);
      if (d.phase === 'cancelled') outcome = 'cancelled';
      else if (!d.resolved) answered = true;
      else ({ outcome, complete: answered } = await readOutcome(client, m.market_id, d.creatorAddress, spent));
    } catch (e) {
      log(`wire: detail ${m.market_id} failed (will retry): ${(e as Error).message}`);
    }
    // Panta answered in full and shows nothing long after the market should have settled:
    // void, never guess. A failed or cut-short read is not that answer; it retries next tick.
    if (!outcome && answered && now > m.settles_at + VOID_AFTER_MS) outcome = 'cancelled';
    if (outcome) {
      db.prepare(`UPDATE wire_markets SET outcome = ?, resolved_at = ? WHERE market_id = ? AND outcome IS NULL`)
        .run(outcome, now, m.market_id);
      decided++;
    }
  }
  return decided;
}

/** One pass. Each step is isolated: a failed catalog read still lets outcomes and
 * settlement run. Exported for tests. */
export async function wireTick(db: DB, client: WireClient, now = Date.now(), log: Log = () => {}) {
  const start = client.calls;
  const spent = () => client.calls - start;
  let listed = 0, decided = 0;
  try { listed = await refreshCatalog(db, client, now, spent); }
  catch (e) { log(`wire: catalog failed (will retry): ${(e as Error).message}`); }
  try { decided = await readOutcomes(db, client, now, spent, log); }
  catch (e) { log(`wire: outcomes failed (will retry): ${(e as Error).message}`); }
  let settled = 0;
  try { settled = settleWire(db, null, now); }
  catch (e) { log(`wire: settle failed (will retry): ${(e as Error).message}`); }
  return { listed, decided, settled, calls: spent() };
}

export function startWireJob(
  db: DB, client: WireClient, intervalMs = 600_000, log: Log = () => {},
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await wireTick(db, client, Date.now(), log);
      if (r.decided || r.settled) log(`wire: ${r.decided} outcome(s) read, ${r.settled} position(s) settled`);
    } catch (e) {
      log(`wire error (will retry): ${(e as Error).message}`);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return () => { stopped = true; clearTimeout(timer); };
}
