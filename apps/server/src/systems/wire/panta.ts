/**
 * The Panta edge (the Wire, GDD §5.1): read-only HTTP against Panta's public API. Nothing
 * here moves money: prices come from the simulated primary-order quote, outcomes from
 * position records. Every failure is a plain Error (never an EngineError), so a Panta
 * outage can log and degrade the job but never become a player-facing 4xx/500.
 */
import { readFileSync } from 'node:fs';
import { withTimeout } from '../../core/cached.js';

const BASE = 'https://live-api.panta.market/api/v1';
const USER_AGENT = 'outfox-wire/0.0.1';
const TIMEOUT_MS = 8_000;
/** Any valid pubkey works for a quote; this wallet never signs anything (the System Program). */
const DEFAULT_WALLET = '11111111111111111111111111111111';
const MAX_PAGES = 3;

/** The slice of a Panta market row the Wire reads. Times are unix SECONDS, as Panta sends them. */
export interface PantaMarket {
  marketId: string; title: string; category: string; status: string; phase: string;
  resolved: boolean; endTime: number; resolutionTime: number;
}
export interface PantaDetail { resolved: boolean; phase: string; creatorAddress: string | null }
export type PantaOutcome = 'yes' | 'no' | 'cancelled';

export interface WireClient {
  /** Panta HTTP requests made so far; the job meters its per-tick budget with it. */
  readonly calls: number;
  listPrimary(): Promise<PantaMarket[]>;
  /** Panta's chance of YES in (0, 1) from a simulated $1 fill, or null if neither side quotes. */
  quoteYesPrice(marketId: string): Promise<number | null>;
  marketDetail(marketId: string): Promise<PantaDetail>;
  /** Up to `max` distinct wallets that bought on the market (public catalog tape). */
  recentBuyers(marketId: string, max: number): Promise<string[]>;
  /** The market's outcome as this holder's position record shows it; null if not shown. */
  outcomeVia(wallet: string, marketId: string): Promise<PantaOutcome | null>;
}

export interface WireConfig { client: WireClient }

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function toMarket(r: Json): PantaMarket {
  return {
    marketId: str(r.marketId), title: str(r.title), category: str(r.category),
    status: str(r.status), phase: str(r.phase), resolved: r.resolved === true,
    endTime: num(r.endTime), resolutionTime: num(r.resolutionTime),
  };
}

/** A yes/no price must be a real chance: strictly inside (0, 1). Anything else fails closed. */
function chance(v: unknown): number | null {
  const p = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}

export function pantaClient(apiKey: string, wallet: string): WireClient {
  let calls = 0;
  const call = async (path: string, body?: Json): Promise<Json> => {
    calls++;
    const res = await withTimeout((async () => {
      const r = await fetch(`${BASE}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'X-Api-Key': apiKey, 'User-Agent': USER_AGENT, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!r.ok) throw new Error(`panta ${r.status} ${path.split('?')[0]}`);
      return (await r.json()) as unknown;
    })(), TIMEOUT_MS + 1_000);
    if (!res || typeof res !== 'object' || Array.isArray(res)) throw new Error(`panta: unexpected body ${path.split('?')[0]}`);
    return res as Json;
  };
  const quote = async (marketId: string, side: 'yes' | 'no') =>
    chance((await call('/primaryorderquote/', { wallet, marketId, side, amountUsdc: '1.00' })).avgPrice);

  return {
    get calls() { return calls; },
    async listPrimary() {
      const out: PantaMarket[] = [];
      let cursor = '';
      for (let page = 0; page < MAX_PAGES; page++) {
        const j = await call(`/markets/?status=primary&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        for (const r of Array.isArray(j.items) ? (j.items as Json[]) : []) {
          const m = toMarket(r);
          if (m.marketId) out.push(m);
        }
        cursor = str(j.nextCursor);
        if (!cursor) break;
      }
      return out;
    },
    // yes first; if that side will not quote, the no side (yesPrice = 1 - avgPrice).
    async quoteYesPrice(marketId) {
      try {
        const yes = await quote(marketId, 'yes');
        if (yes !== null) return yes;
      } catch { /* try the other side */ }
      try {
        const no = await quote(marketId, 'no');
        return no === null ? null : 1 - no;
      } catch { return null; }
    },
    async marketDetail(marketId) {
      const j = await call(`/markets/${encodeURIComponent(marketId)}/`);
      return { resolved: j.resolved === true, phase: str(j.phase), creatorAddress: str(j.creatorAddress) || null };
    },
    async recentBuyers(marketId, max) {
      const j = await call(`/markets/${encodeURIComponent(marketId)}/trades/?limit=20`);
      const seen = new Set<string>();
      for (const t of Array.isArray(j.items) ? (j.items as Json[]) : []) {
        const w = str(t.wallet);
        if (t.kind === 'buy' && w && !seen.has(w) && seen.size < max) seen.add(w);
      }
      return [...seen];
    },
    async outcomeVia(holder, marketId) {
      const j = await call(`/positions/?wallet=${encodeURIComponent(holder)}`);
      const row = (Array.isArray(j.positions) ? (j.positions as Json[]) : []).find((r) => r.marketId === marketId);
      if (!row) return null;
      if (row.phase === 'cancelled') return 'cancelled';
      return row.outcome === 'yes' || row.outcome === 'no' ? row.outcome : null;
    },
  };
}

/**
 * Test and verify-live stand-in for Panta, read from a JSON file on every call so a run can
 * change the world mid-flight: `{ markets: [Panta list rows], quotes: { id: yesPrice },
 * outcomes: { id: 'yes' | 'no' | 'cancelled' } }`. A market with no quote does not quote;
 * a market row with `resolved: true` and no outcome is the unreadable case.
 */
export function fixtureClient(path: string): WireClient {
  const load = () => {
    const j = JSON.parse(readFileSync(path, 'utf8')) as {
      markets?: Json[]; quotes?: Record<string, number>; outcomes?: Record<string, PantaOutcome>;
    };
    return { markets: (j.markets ?? []).map(toMarket), quotes: j.quotes ?? {}, outcomes: j.outcomes ?? {} };
  };
  let calls = 0;
  return {
    get calls() { return calls; },
    async listPrimary() { calls++; return load().markets.filter((m) => m.status === 'primary'); },
    async quoteYesPrice(id) { calls++; return chance(load().quotes[id]); },
    async marketDetail(id) {
      calls++;
      const m = load().markets.find((x) => x.marketId === id);
      if (!m) throw new Error(`fixture: no market ${id}`);
      return { resolved: m.resolved, phase: m.phase, creatorAddress: 'fixture-creator' };
    },
    async recentBuyers() { calls++; return ['fixture-buyer']; },
    async outcomeVia(_wallet, id) { calls++; return load().outcomes[id] ?? null; },
  };
}

/** null (the Wire is off, with a warning) unless a key or a fixture is configured. */
export function wireConfigFromEnv(): WireConfig | null {
  const { OUTFOX_PANTA_KEY, OUTFOX_PANTA_WALLET, OUTFOX_WIRE_FIXTURE } = process.env;
  if (OUTFOX_WIRE_FIXTURE) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[wire] OUTFOX_WIRE_FIXTURE is refused in production; the Wire is off');
      return null;
    }
    return { client: fixtureClient(OUTFOX_WIRE_FIXTURE) };
  }
  if (!OUTFOX_PANTA_KEY) {
    console.warn('[wire] OUTFOX_PANTA_KEY is not set; the Wire is off');
    return null;
  }
  return { client: pantaClient(OUTFOX_PANTA_KEY, OUTFOX_PANTA_WALLET || DEFAULT_WALLET) };
}
