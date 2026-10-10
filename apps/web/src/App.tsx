import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BootstrapResponse, CallDef, CallResult, ItemKind, LedgerRow, ListingView, PlayerView,
  WirePositionView, WireResponse, WireSide,
} from '@outfox/shared';
import {
  BOOSTER, BOOSTER_EFFECT, GIG, ITEM_KINDS, MARKET_FEE_BPS, REFILL, REGEN, UNSETTLED_EXPLAINER,
  WIRE, WIRE_ATTRIBUTION, WIRE_EXPLAINER,
} from '@outfox/shared';
import {
  Activity, ChevronRight, Crosshair, Gauge, Landmark, Moon, Signpost, Store, Sun, TriangleAlert, WifiOff,
} from 'lucide-react';
import { api } from './api';
import { fx } from './feedback';
import { Clearinghouse } from './Clearinghouse';
import { RegisterSheet } from './RegisterSheet';
import { registerSW } from './sw-register';
import { Street } from './Street';
import {
  ActionResult, ActionRow, Amount, Banner, Button, Chip, EmptyState, ListRow, Meter,
  ProvenanceChip, RowGroup, ScripMark, Skeleton, SplitBar, TabBar, type TabDef,
} from './ds';

type Tab = 'tape' | 'street' | 'market' | 'ledger';

const TABS: TabDef[] = [
  { id: 'tape', label: 'The Tape', icon: <Activity size={18} strokeWidth={1.75} /> },
  { id: 'street', label: 'The Street', icon: <Signpost size={18} strokeWidth={1.75} /> },
  { id: 'market', label: 'Market', icon: <Store size={18} strokeWidth={1.75} /> },
  { id: 'ledger', label: 'Ledger', icon: <Landmark size={18} strokeWidth={1.75} /> },
];

/** One shared 1s tick for every countdown (perf rule: one timer source). */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** Client-side projection of a lazily-regenerating bar from its server snapshot.
 * `srvNow` is server-clock time (client now + measured offset) so skewed client clocks
 * neither unlock actions early nor hold them late. */
function projectBar(snap: number, snapAt: number, perSec: number, max: number, srvNow: number): number {
  return Math.min(max, Math.floor(snap + Math.max(0, (srvNow - snapAt) / 1000) * perSec));
}

/** The result of a Call/Gig, printed on the row it happened on. */
type Feedback = {
  actionId: string; kind: 'clean' | 'nicked'; text: string; note?: string; seq: number;
} | null;

/** The Wire positions this device last saw open. One that has resolved since prints its
 * result once on Your Book; when storage is blocked the list lives in memory only. */
const WIRE_SEEN_KEY = 'outfox.wire.open';
let wireSeenIds: number[] | null = null;
function wireSeen(): number[] {
  if (wireSeenIds === null) {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(WIRE_SEEN_KEY) ?? '[]');
      wireSeenIds = Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
    } catch { wireSeenIds = []; }
  }
  return wireSeenIds;
}
function setWireSeen(ids: number[]) {
  wireSeenIds = ids;
  try { localStorage.setItem(WIRE_SEEN_KEY, JSON.stringify(ids)); } catch { /* private mode */ }
}
const WIRE_QUIET: WireResponse = { enabled: false, markets: [], positions: [] };

/** When a Wire market settles, in the player's own zone: "12 Jan 21:00". */
function settlesLabel(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function App() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [listings, setListings] = useState<ListingView[]>([]);
  const [tab, setTab] = useState<Tab>('tape');
  const [clearing, setClearing] = useState(false); // Clearinghouse, a Ledger sub-surface
  const [landing, setLanding] = useState<'gigs' | 'calls' | null>(null); // a Street district's Tape section
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [halted, setHalted] = useState(false);
  const [register, setRegister] = useState<{ reason: string; resume: () => void } | null>(null);
  const [swApply, setSwApply] = useState<(() => void) | null>(null);
  // §9 feedback: the Nicked flash (visual twin of the buzz) and the header mute state
  const [flash, setFlash] = useState(0);
  const [sound, setSound] = useState(() => fx.prefs().sound);
  const [soundToast, setSoundToast] = useState(() => {
    try { return localStorage.getItem('outfox.fx.toast') !== 'seen'; } catch { return false; }
  });
  // FTUE (§10.4): the guided first Call, shown until the first Call RESOLVES (win or
  // Nicked). localStorage persists it per device; the balance check skips it for a
  // returning account on a fresh device. Private mode (throwing storage) skips FTUE
  // rather than risk showing it forever.
  const [ftueDone, setFtueDone] = useState(() => {
    try { return localStorage.getItem('outfox.ftue') === 'done'; } catch { return true; }
  });
  const clockOffset = useRef(0); // serverTime - clientTime, refreshed on every response
  const seq = useRef(0);
  const now = useNow();
  const wide = useWide();
  const srvNow = now + clockOffset.current;

  useEffect(() => { registerSW((apply) => setSwApply(() => apply)); }, []);

  const absorb = useCallback((p: PlayerView) => {
    clockOffset.current = p.serverTime - Date.now();
    setPlayer(p);
  }, []);

  // Boot with retry: a failed bootstrap halts the tape but keeps trying (backoff,
  // capped; a 429's retry-after wins when longer) — never a permanent dead end.
  // The browser's online event short-circuits the wait. (§1.2: reconnect refetches.)
  useEffect(() => {
    let dead = false;
    let timer: number | undefined;
    let attempt = 0;
    const tryBoot = () => {
      timer = undefined;
      api.bootstrap()
        .then((b) => {
          if (dead) return;
          setHalted(false); setBoot(b); absorb(b.player); setListings(b.listings);
        })
        .catch((e) => {
          if (dead) return;
          setHalted(true);
          const backoff = Math.min(30_000, 2_000 * 2 ** attempt++);
          const ra = (e as { retryAfterSec?: number }).retryAfterSec;
          timer = window.setTimeout(tryBoot, Math.max(backoff, (ra ?? 0) * 1000));
        });
    };
    const onOnline = () => {
      if (timer === undefined) return; // only while a retry is pending
      clearTimeout(timer);
      tryBoot();
    };
    window.addEventListener('online', onOnline);
    tryBoot();
    return () => { dead = true; clearTimeout(timer); window.removeEventListener('online', onOnline); };
  }, [absorb]);

  // the printed result reverts to the row's normal line after a beat
  useEffect(() => {
    if (!feedback) return;
    const t = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(t);
  }, [feedback]);

  const run = useCallback(async <T extends object>(
    fn: () => Promise<T>,
    gate?: { reason: string },
  ): Promise<T | null> => {
    setError(null);
    try {
      const r = await fn() as T & { player?: PlayerView; listings?: ListingView[] };
      if (r.player) absorb(r.player);
      if (r.listings) setListings(r.listings);
      setHalted(false);
      return r;
    } catch (e) {
      if (e instanceof TypeError) setHalted(true); // network down → TAPE HALTED
      else if ((e as { code?: string }).code === 'rung_required'
        || (e as Error).message.includes('register to trade')) {
        // demanding-surface gate: open the R1 sheet, queue this action to auto-resume
        if (gate) setRegister({ reason: gate.reason, resume: () => { void run(fn, gate); } });
      } else setError((e as Error).message);
      return null;
    }
  }, [absorb]);

  /** Shared by the Tape rows and the FTUE beat — the first resolved Call ends FTUE. */
  const doCall = useCallback(async (id: string, boost = false) => {
    fx.emit('press');
    const r = await run(() => api.call(id, boost));
    const result = (r as { result?: CallResult } | null)?.result;
    if (!result) return;
    if (result.ok) {
      // reward weight by tier = the Call's place in the catalog; scales amplitude, never length
      const idx = boot?.catalog.calls.findIndex((c) => c.id === id) ?? 0;
      fx.reveal(Math.min(3, Math.max(1, idx + 1)) as 1 | 2 | 3);
    } else {
      fx.emit('nicked');
      setFlash((n) => n + 1);
    }
    setFeedback(result.ok
      ? {
          actionId: id, kind: 'clean', seq: ++seq.current,
          text: `Filled +${result.payout.toLocaleString()} Scrip`,
          note: result.boosted ? 'Booster used. Unsettled, spend-only' : 'Unsettled — spend-only',
        }
      : {
          actionId: id, kind: 'nicked', seq: ++seq.current,
          text: 'Nicked', note: result.boosted ? 'Booster used. The Sheriff saw it coming' : 'The Sheriff saw it coming',
        });
    setFtueDone((done) => {
      if (!done) { try { localStorage.setItem('outfox.ftue', 'done'); } catch { /* private mode */ } }
      return true;
    });
  }, [run, boot]);

  // A Wire payout lands on the Book server-side (on the Wire read); re-read the Book.
  const refreshPlayer = useCallback(() => {
    api.market().then((r) => absorb(r.player)).catch(() => { /* the next action refreshes it */ });
  }, [absorb]);

  // a player with anything on the Book has already had their first Call — record it
  const isFresh = player
    && player.scripSettled === 0 && player.scripUnsettled === 0 && player.gigCount === 0;
  useEffect(() => {
    if (player && !isFresh && !ftueDone) {
      try { localStorage.setItem('outfox.ftue', 'done'); } catch { /* private mode */ }
      setFtueDone(true);
    }
  }, [player, isFresh, ftueDone]);
  const showFtue = !ftueDone && !!isFresh;

  // theme lives in state so the toggle's own icon re-renders; index.html already set the
  // attribute pre-paint (no FOUC), so we only ever mirror it.
  const [isLight, setIsLight] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'light',
  );
  const toggleSound = () => {
    const next = !sound;
    fx.set({ sound: next });
    setSound(next);
    if (next) fx.emit('press');
  };
  const dismissSoundToast = () => {
    setSoundToast(false);
    try { localStorage.setItem('outfox.fx.toast', 'seen'); } catch { /* private mode */ }
  };

  const toggleTheme = () => {
    const next = isLight ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    // read the colour back from the token — hex lives in palette.css alone (§4.1)
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    setIsLight(next === 'light');
    try { localStorage.setItem('outfox.theme', next); } catch { /* private mode */ }
  };

  const header = (
    <header className="ofx-app__header">
      <span className="ofx-app__brand">
        <span style={{ color: 'var(--c-accent-text)' }}>OUT</span>FOX
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        {player && <span className="ofx-statline"><b style={{ marginLeft: 0 }}>{player.handle}</b></span>}
        <Button
          variant="ghost" size="sm" iconOnly onClick={toggleSound}
          aria-label={sound ? 'Mute sound cues' : 'Unmute sound cues'} aria-pressed={!sound}
        >
          <SoundIcon on={sound} />
        </Button>
        <Button variant="ghost" size="sm" iconOnly onClick={toggleTheme} aria-label="Toggle theme">
          {isLight ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
        </Button>
      </span>
    </header>
  );

  if (!boot || !player) {
    return (
      <div className="ofx-app">
        <div className="ofx-app__col">
          {header}
          <main className="ofx-app__main" aria-busy={!halted}>
            {halted
              ? <Banner tone="halted" icon={<WifiOff size={16} strokeWidth={1.75} />} title="Tape halted">
                  Can’t reach the Street. Retry shortly.
                </Banner>
              : (
                <div className="ofx-app__sections">
                  <Skeleton height={92} />
                  <Skeleton width="38%" />
                  <Skeleton height={52} />
                  <Skeleton height={52} />
                  <Skeleton height={52} />
                </div>
              )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="ofx-app">
      {flash > 0 && <div key={flash} className="ofx-flash ofx-flash--on" aria-hidden="true" />}
      {wide && <TabBar rail tabs={TABS} active={tab} onSelect={(t) => { fx.emit('select'); setTab(t as Tab); setClearing(false); }} />}
      <div className="ofx-app__col">
        {header}
        <main className="ofx-app__main">
          <div className="ofx-app__sections">
            {swApply && (
              <Banner
                title="New build posted"
                action={<Button size="sm" onClick={() => { const a = swApply; setSwApply(null); a?.(); }}>Refresh</Button>}
              />
            )}
            {halted && (
              <Banner tone="halted" icon={<WifiOff size={16} strokeWidth={1.75} />} title="Tape halted">
                Connection lost. Values may be stale.
              </Banner>
            )}
            {error && (
              <Banner tone="danger" icon={<TriangleAlert size={16} strokeWidth={1.75} />} title="Rejected">
                {error}
              </Banner>
            )}
            {soundToast && tab === 'tape' && (
              <Banner title="Sound on" action={<Button size="sm" onClick={dismissSoundToast}>Got it</Button>}>
                Cues play at low volume. Mute any time with the speaker in the header.
              </Banner>
            )}

            {tab === 'tape' && showFtue && (
              <Ftue
                call={boot.catalog.calls.reduce((a, b) => (a.riskCost <= b.riskCost ? a : b))}
                onCall={doCall}
              />
            )}
            {tab === 'tape' && !showFtue && (
              <Tape
                player={player} boot={boot} srvNow={srvNow} feedback={feedback}
                landing={landing} onLanded={() => setLanding(null)}
                onCall={doCall}
                onGig={async () => {
                  fx.emit('press');
                  const r = await run(() => api.gig());
                  if (!r) return; // rejected or offline: the Rejected/halted banner speaks, the row claims no pay
                  fx.emit('clean');
                  const tool = (r as { toolAwarded?: ItemKind } | null)?.toolAwarded;
                  setFeedback(tool
                    ? {
                        actionId: GIG.id, kind: 'clean', seq: ++seq.current,
                        text: `${ITEM_KINDS[tool].name} earned`,
                        note: tool === BOOSTER.item ? 'In your kit. Use it on a Call' : 'In your kit',
                      }
                    : {
                        actionId: GIG.id, kind: 'clean', seq: ++seq.current,
                        text: `Settled +${GIG.payout.toLocaleString()} Scrip`,
                      });
                }}
                onRefill={(bar) => { fx.emit('press'); return run(() => api.refill(bar)); }}
                onWire={(marketId, side) => { fx.emit('press'); return run(() => api.wireCall(marketId, side)); }}
                onRefresh={refreshPlayer}
              />
            )}

            {tab === 'street' && (
              <Street
                onEnter={(e) => {
                  fx.emit('select');
                  if (e === 'gigs' || e === 'calls') { setTab('tape'); if (!showFtue) setLanding(e); } // no Tape yet during the FTUE
                  else { setTab('ledger'); setClearing(true); }
                }}
              />
            )}

            {tab === 'market' && (
              <Market
                player={player} listings={listings}
                onBuy={async (id) => {
                  fx.emit('press');
                  const r = await run(() => api.buy(id), { reason: 'Buying on the Open Market is for registered Foxes.' });
                  if (r) fx.emit('fill');
                }}
                onList={(itemId, price) => { fx.emit('press'); return run(() => api.list(itemId, price), { reason: 'Listing on the Open Market is for registered Foxes.' }); }}
                onCancel={(id) => { fx.emit('press'); return run(() => api.cancel(id)); }}
                onOpen={() => run(() => api.market())}
              />
            )}

            {tab === 'ledger' && (clearing
              ? <Clearinghouse player={player} srvNow={srvNow} run={run} onBack={() => setClearing(false)} />
              : <Ledger player={player} onClearinghouse={() => setClearing(true)} />)}
          </div>
        </main>
      </div>

      {register && (
        <RegisterSheet
          mode={boot.auth.mode}
          reason={register.reason}
          onClose={() => setRegister(null)}
          onDone={(pl) => { absorb(pl); const resume = register.resume; setRegister(null); resume(); }}
          onAdopted={(pl) => { absorb(pl); setRegister(null); setTab('tape'); }}
        />
      )}

      {!wide && <TabBar tabs={TABS} active={tab} onSelect={(t) => { fx.emit('select'); setTab(t as Tab); setClearing(false); }} />}
    </div>
  );
}

// ---------- FTUE — the guided first Call (DESIGN-SYSTEM-WEB §10.4) ----------
// One pre-selected low-stakes Call, one primary CTA, the mascot's one sanctioned
// onboarding beat. The terms print exactly like a Tape row — the disclosure rules
// don't relax for onboarding. After the Call resolves the player lands on The Tape.

function Ftue({ call, onCall }: { call: CallDef; onCall: (id: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <img className="ofx-art ofx-ftue__art" src="/art/ftue-onboarding.webp" alt="" decoding="async" />
      <div>
        <h2 style={{
          margin: 0, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xl)',
          fontWeight: 'var(--fw-semi)', letterSpacing: 'var(--track-caps-wide)',
          textTransform: 'uppercase',
        }}>
          Take the seat
        </h2>
        <p style={{ margin: 'var(--space-2) 0 0', color: 'var(--c-text-2)' }}>
          The Street has been trading without you long enough. Start with a soft one —
          the terms are on the table.
        </p>
      </div>
      <RowGroup title="Your first Call">
        <ActionRow
          title={call.name}
          desc={call.flavor}
          meta={
            <>
              <span>Risk {call.riskCost}</span>
              <span>Pays {call.payout[0]}–{call.payout[1]}</span>
              <Chip tone="unsettled" hatch dashed>Unsettled</Chip>
            </>
          }
          action={
            <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'stretch', minWidth: 132 }}>
              <SplitBar successPct={call.successP * 100} />
              <Button
                variant="primary" size="sm" disabled={busy}
                onClick={async () => { setBusy(true); try { await onCall(call.id); } finally { setBusy(false); } }}
              >
                Run it
              </Button>
            </div>
          }
        />
      </RowGroup>
    </>
  );
}

// ---------- The Tape ----------

function Tape(props: {
  player: PlayerView; boot: BootstrapResponse; srvNow: number; feedback: Feedback;
  landing: 'gigs' | 'calls' | null; onLanded: () => void;
  onCall: (id: string, boost: boolean) => void; onGig: () => void; onRefill: (bar: 'focus' | 'risk') => void;
  onWire: (marketId: string, side: WireSide) => Promise<WireResponse | null>; onRefresh: () => void;
}) {
  const { player: p, boot, srvNow, feedback } = props;

  // The Wire: live Panta markets taken as Calls. Read on mount, after every Wire action, and
  // every 60 s while the Tape is on screen and the page is visible (A7).
  const [wire, setWire] = useState<WireResponse | null>(null);
  const [taking, setTaking] = useState(false);
  const [wireDone, setWireDone] = useState<{ seq: number; list: WirePositionView[] } | null>(null);
  const { onRefresh } = props;
  const absorbWire = useCallback((r: WireResponse) => {
    setWire(r);
    const seen = new Set(wireSeen());
    const done = r.positions.filter((x) => seen.has(x.id) && (x.status === 'won' || x.status === 'nicked'));
    setWireSeen(r.positions.filter((x) => x.status === 'open').map((x) => x.id));
    if (done.length === 0) return;
    setWireDone({ seq: Date.now(), list: done });
    if (done.some((x) => x.status === 'won')) onRefresh();
  }, [onRefresh]);
  const loadWire = useCallback(() => {
    api.wire().then(absorbWire).catch(() => setWire((w) => w ?? WIRE_QUIET));
  }, [absorbWire]);
  useEffect(() => {
    loadWire();
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadWire(); }, 60_000);
    return () => clearInterval(t);
  }, [loadWire]);
  useEffect(() => {
    if (!wireDone) return;
    const t = setTimeout(() => setWireDone(null), 5000);
    return () => clearTimeout(t);
  }, [wireDone]);
  const takeWire = async (marketId: string, side: WireSide) => {
    setTaking(true);
    try {
      const r = await props.onWire(marketId, side);
      if (r) absorbWire(r); else loadWire(); // refused: re-read, the market may have closed
    } finally { setTaking(false); }
  };
  const wireOpen = wire?.positions.filter((x) => x.status === 'open') ?? [];

  // Signal Boosters in play (owned, not on the book). Arming one applies it to the next
  // run of that Call only; the server uses it up whatever the outcome.
  const boosters = p.items.filter((i) => i.kind === BOOSTER.item && !i.listed).length;
  const [armed, setArmed] = useState<string | null>(null);
  const armedId = boosters > 0 ? armed : null;

  // Your Book scrolls away under the Calls and Gigs; once it does, a one-line copy of it
  // pins to the top so a payout is seen landing while the thumb is still on the button.
  const bookRef = useRef<HTMLDivElement>(null);
  const [bookInView, setBookInView] = useState(true);
  useEffect(() => {
    const el = bookRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setBookInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A Street district lands on its own section: The Floor on Gigs, Options Alley on Calls.
  const [arrived, setArrived] = useState<'gigs' | 'calls' | null>(null);
  const { landing, onLanded } = props;
  useEffect(() => {
    if (!landing) return;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`tape-${landing}`)?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
    setArrived(landing);
    onLanded();
  }, [landing, onLanded]);
  useEffect(() => {
    if (!arrived) return;
    const t = setTimeout(() => setArrived(null), 1600);
    return () => clearTimeout(t);
  }, [arrived]);
  const total = p.scripSettled + p.scripUnsettled;
  const cd = (id: string) => Math.max(0, Math.ceil(((p.cooldowns[id] ?? 0) - srvNow) / 1000));
  const focus = projectBar(p.focus, p.serverTime, REGEN.focusPerSec, p.focusMax, srvNow);
  const risk = projectBar(p.risk, p.serverTime, REGEN.riskPerSec, p.riskMax, srvNow);

  /** The result prints on the row it happened on — never a floating toast. */
  const resultFor = (actionId: string) =>
    feedback?.actionId === actionId
      ? <ActionResult key={feedback.seq} kind={feedback.kind} text={feedback.text} note={feedback.note} />
      : undefined;

  return (
    <>
      <div className="sr-only" aria-live="polite">
        {feedback ? `${feedback.text}. ${feedback.note ?? ''}` : ''}
      </div>

      <BookBar settled={p.scripSettled} unsettled={p.scripUnsettled} on={!bookInView} />
      <div ref={bookRef}>
        <RowGroup title="Your Book">
          <ListRow
            lead={<ScripMark provenance="settled" />}
            title={<Amount value={p.scripSettled} unit="Scrip" size="xl" />}
            sub={<ProvenanceChip provenance="settled" />}
          />
          <ListRow
            lead={<ScripMark provenance="unsettled" />}
            title={<Amount value={p.scripUnsettled} unit="Scrip" size="lg" tone="unsettled" />}
            sub={<ProvenanceChip provenance="unsettled" />}
          />
          {wireOpen.length > 0 && (
            <ListRow
              lead={<ScripMark provenance="unsettled" />}
              title={`Wire calls open · ${wireOpen.length}`}
              sub={`Pays up to ${wireOpen.reduce((a, x) => a + x.payout, 0).toLocaleString()} Scrip if right`}
              trail={<ProvenanceChip provenance="unsettled" />}
            />
          )}
          {wireDone && (
            <div key={wireDone.seq} style={{ display: 'grid', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-1)' }}>
              {wireDone.list.map((x) => (x.status === 'won'
                ? <ActionResult key={x.id} kind="clean" text={`+${x.payout.toLocaleString()} Scrip Unsettled`} note={x.title} />
                : <ActionResult key={x.id} kind="nicked" text="Nicked" note={x.title} />))}
            </div>
          )}
        </RowGroup>
      </div>
      <Banner tone="unsettled" title="Unsettled Scrip">{UNSETTLED_EXPLAINER}</Banner>

      <RowGroup title="Condition">
        <div style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-3) var(--space-1)' }}>
          <Meter label="Focus" value={focus} max={p.focusMax} tone="neutral"
            icon={<Gauge size={12} strokeWidth={2} />} />
          <Meter label="Risk Appetite" value={risk} max={p.riskMax} tone="accent"
            icon={<Crosshair size={12} strokeWidth={2} />} />
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button size="sm" disabled={total < REFILL.cost} onClick={() => props.onRefill('focus')}>
              Refill Focus · {REFILL.cost}
            </Button>
            <Button size="sm" disabled={total < REFILL.cost} onClick={() => props.onRefill('risk')}>
              Refill Risk · {REFILL.cost}
            </Button>
          </div>
        </div>
      </RowGroup>

      <RowGroup title="Calls — vs the market" id="tape-calls" arrived={arrived === 'calls'}>
        {boot.catalog.calls.map((c) => {
          const wait = cd(c.id);
          const blocked = wait > 0 || risk < c.riskCost;
          const on = armedId === c.id;
          const pct = (on ? Math.min(c.successP + BOOSTER.pp, BOOSTER.maxP) : c.successP) * 100;
          return (
            <ActionRow
              key={c.id}
              title={c.name}
              desc={c.flavor}
              meta={
                <>
                  <span>Risk {c.riskCost}</span>
                  <span>Pays {c.payout[0]}–{c.payout[1]}</span>
                  <Chip tone="unsettled" hatch dashed>Unsettled</Chip>
                </>
              }
              action={
                <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'stretch', minWidth: 132 }}>
                  <SplitBar successPct={pct} />
                  <Button
                    variant="primary" size="sm" disabled={blocked}
                    onClick={() => { props.onCall(c.id, on); if (on) setArmed(null); }}
                  >
                    {wait > 0 ? `${wait}s` : risk < c.riskCost ? 'Low Risk' : on ? `Run it +${Math.round(BOOSTER.pp * 100)}` : 'Run it'}
                  </Button>
                  {boosters > 0 && (
                    <Button
                      variant="ghost" size="sm" aria-pressed={on}
                      aria-label={on ? 'Booster armed for this Call. Tap to disarm' : `Use a Signal Booster on this Call, ${boosters} left`}
                      onClick={() => setArmed(on ? null : c.id)}
                    >
                      {on ? `Boost on · ${boosters}` : `Boost · ${boosters}`}
                    </Button>
                  )}
                </div>
              }
              result={resultFor(c.id)}
            />
          );
        })}
      </RowGroup>

      <RowGroup title="The Wire · calls on the real world" id="tape-wire">
        <Banner tone="unsettled">
          {WIRE_EXPLAINER}
          <a
            className="ofx-banner__link"
            href={WIRE_ATTRIBUTION.href} target="_blank" rel="noreferrer"
          >
            {WIRE_ATTRIBUTION.text}
          </a>
        </Banner>
        {wire === null && <div style={{ padding: 'var(--space-3) 0' }}><Skeleton height={52} /></div>}
        {wire && (!wire.enabled || wire.markets.length === 0) && (
          <EmptyState title="The Wire is quiet" hint="Nothing listed right now." />
        )}
        {wire?.enabled && wire.markets.map((m) => {
          const yes = Math.round(m.yesPrice * 100);
          const mine = wire.positions.find((x) => x.marketId === m.marketId);
          const ago = Math.max(0, Math.floor((srvNow - m.quotedAt) / 60_000));
          return (
            <ActionRow
              key={m.marketId}
              title={m.title}
              desc={`Settles ${settlesLabel(m.settlesAt)} · quoted ${ago} min ago`}
              meta={
                <>
                  <span>Risk {WIRE.riskCost}</span>
                  <span>Pays {m.payoutYes} on YES · {m.payoutNo} on NO</span>
                  <Chip tone="unsettled" hatch dashed>Unsettled</Chip>
                </>
              }
              action={
                <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'stretch', minWidth: 132 }}>
                  <SplitBar successPct={yes} labels={['YES', 'NO']} />
                  {mine || risk < WIRE.riskCost
                    ? <Button variant="primary" size="sm" disabled>{mine ? 'Taken' : 'Low Risk'}</Button>
                    : (
                      <>
                        <Button variant="primary" size="sm" disabled={taking} onClick={() => takeWire(m.marketId, 'yes')}>
                          YES {yes}%
                        </Button>
                        <Button variant="ghost" size="sm" disabled={taking} onClick={() => takeWire(m.marketId, 'no')}>
                          NO {100 - yes}%
                        </Button>
                      </>
                    )}
                </div>
              }
              result={mine?.status === 'open'
                ? (
                  <ActionResult
                    key={mine.id} kind="open"
                    text={`Your call: ${mine.side.toUpperCase()} at ${Math.round(mine.price * 100)}%.`}
                    note={`Pays ${mine.payout.toLocaleString()} Scrip if right.`}
                  />
                )
                : undefined}
            />
          );
        })}
      </RowGroup>

      <RowGroup title="Gigs — honest work" id="tape-gigs" arrived={arrived === 'gigs'}>
        <ActionRow
          title={boot.catalog.gig.name}
          desc={boot.catalog.gig.flavor}
          meta={
            <>
              <span>Focus {boot.catalog.gig.focusCost}</span>
              <span>Pays {boot.catalog.gig.payout}</span>
              <Chip tone="up">Settled</Chip>
              <span>Booster {p.gigCount % boot.catalog.gig.toolEvery}/{boot.catalog.gig.toolEvery}</span>
            </>
          }
          action={
            <Button
              size="sm"
              disabled={cd(boot.catalog.gig.id) > 0 || focus < boot.catalog.gig.focusCost}
              onClick={props.onGig}
            >
              {cd(boot.catalog.gig.id) > 0 ? `${cd(boot.catalog.gig.id)}s` : 'Work it'}
            </Button>
          }
          result={resultFor(boot.catalog.gig.id)}
        />
      </RowGroup>
    </>
  );
}

/** The pinned one-line Book. Decorative duplicate of Your Book (the live region already
 * speaks every result), so hidden from assistive tech. A changed balance re-mounts its
 * figure, which replays one flat tint: the same short print for every amount and both
 * provenances, never a count-up (DESIGN-SYSTEM-WEB §8.2: no escalation by payout size). */
function BookBar({ settled, unsettled, on }: { settled: number; unsettled: number; on: boolean }) {
  return (
    <div className="ofx-bookbar-anchor" aria-hidden="true">
      <div className={on ? 'ofx-bookbar ofx-bookbar--on' : 'ofx-bookbar'}>
        <span className="ofx-bookbar__cell">
          <ScripMark provenance="settled" />
          <span key={settled} className="ofx-bookbar__val ofx-bookbar__val--settled">
            <Amount value={settled} unit="Scrip" size="md" />
          </span>
          <ProvenanceChip provenance="settled" />
        </span>
        <span className="ofx-bookbar__cell">
          <ScripMark provenance="unsettled" />
          <span key={unsettled} className="ofx-bookbar__val ofx-bookbar__val--unsettled">
            <Amount value={unsettled} unit="Scrip" size="md" tone="unsettled" />
          </span>
          <ProvenanceChip provenance="unsettled" />
        </span>
      </div>
    </div>
  );
}

// ---------- The Open Market ----------

/** Item card art in the row's lead slot. Decorative (the row text carries the name);
 * the art file name is the item kind — the catalog and the art stay in lockstep. */
function ItemThumb({ kind }: { kind: ItemKind }) {
  return <img className="ofx-thumb" src={`/art/item-${kind}.webp`} alt="" loading="lazy" decoding="async" />;
}

function Market(props: {
  player: PlayerView; listings: ListingView[];
  onBuy: (id: number) => void; onList: (itemId: number, price: number) => void;
  onCancel: (id: number) => void; onOpen: () => void;
}) {
  const { player: p, listings } = props;
  const [prices, setPrices] = useState<Record<number, string>>({}); // per-item, never shared
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current) { opened.current = true; props.onOpen(); } // refresh once per mount
  });

  const unlisted = p.items.filter((i) => !i.listed);
  const kindName = (k: ItemKind) => ITEM_KINDS[k].name;
  const feePct = (MARKET_FEE_BPS / 100).toFixed(1);

  return (
    <>
      <RowGroup title="The Open Market">
        {listings.length === 0 && (
          <EmptyState
            art="/art/empty-after-hours.webp"
            title="Nothing on the book"
            hint="Other Foxes list tools here at a price they set. You buy with Settled Scrip."
          />
        )}
        {listings.map((l) => {
          const short = !l.mine && p.scripSettled < l.price;
          return (
            <ListRow
              key={l.id}
              lead={<ItemThumb kind={l.itemKind} />}
              title={kindName(l.itemKind)}
              sub={
                <>
                  {l.mine ? 'Your listing' : l.seller}
                  {l.itemKind === BOOSTER.item && <span className="ofx-row__effect">{BOOSTER_EFFECT}</span>}
                </>
              }
              trail={
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <Amount value={l.price} unit="Scrip" />
                  {l.mine
                    ? <Button size="sm" onClick={() => props.onCancel(l.id)}>Delist</Button>
                    : (
                      <Button variant="primary" size="sm" disabled={short} onClick={() => props.onBuy(l.id)}>
                        {short ? 'Low Settled' : 'Buy'}
                      </Button>
                    )}
                </span>
              }
            />
          );
        })}
      </RowGroup>
      <Banner title="Settled only">
        Purchases settle from Settled Scrip only — chance winnings can’t buy from another Fox.
        {' '}{feePct}% clearing fee.
      </Banner>

      <RowGroup title="Your kit" hint="Tools you own. Set a price and list one; another Fox buys it with Settled Scrip. Players set every price.">
        {unlisted.length === 0 && (
          <EmptyState title="Nothing to list" hint="Run Gigs to earn tools." />
        )}
        {unlisted.map((i) => {
          const price = prices[i.id] ?? '';
          const asked = Number(price);
          // same rounding as the server's sale (systems/market/rules.ts): fee rounds up
          const net = asked >= 1 ? asked - Math.ceil((asked * MARKET_FEE_BPS) / 10_000) : null;
          return (
            <ListRow
              key={i.id}
              lead={<ItemThumb kind={i.kind} />}
              title={kindName(i.kind)}
              sub={
                <>
                  {ITEM_KINDS[i.kind].desc} {ITEM_KINDS[i.kind].source}
                  {i.kind === BOOSTER.item && <span className="ofx-row__effect">{BOOSTER_EFFECT}</span>}
                  {net !== null && (
                    <span className="ofx-row__net">You get {net.toLocaleString()} Settled after the {feePct}% fee.</span>
                  )}
                </>
              }
              trail={
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <input
                    className="ofx-input"
                    inputMode="numeric"
                    placeholder="price"
                    aria-label={`Price for ${kindName(i.kind)}`}
                    value={price}
                    onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value.replace(/[^0-9]/g, '') })}
                  />
                  <Button
                    size="sm"
                    disabled={!price || Number(price) < 1}
                    onClick={() => { props.onList(i.id, Number(price)); setPrices({ ...prices, [i.id]: '' }); }}
                  >
                    List
                  </Button>
                </span>
              }
            />
          );
        })}
      </RowGroup>
    </>
  );
}

// ---------- The Ledger ----------

const LEDGER_LABEL: Record<string, string> = {
  call: 'Call', gig: 'Gig', market_sale: 'Sale', market_buy: 'Purchase',
  fee: 'Fee', refill: 'Refill', starter: 'Starter', carry: 'Carry', wire: 'Wire call',
};

function Ledger({ player: p, onClearinghouse }: {
  player: PlayerView; onClearinghouse: () => void;
}) {
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  useEffect(() => {
    api.ledger().then((r) => setRows(r.rows)).catch(() => setRows([]));
  }, [p.scripSettled, p.scripUnsettled]);

  const total = p.scripSettled + p.scripUnsettled;

  return (
    <>
      <RowGroup title="Scrip">
        <ListRow
          title={<Amount value={total} unit="Scrip" size="hero" />}
          sub="Total on the Book"
        />
        <ListRow
          lead={<ScripMark provenance="settled" />}
          title={<Amount value={p.scripSettled} unit="Scrip" size="md" />}
          sub={<ProvenanceChip provenance="settled" />}
          trail={<span className="ofx-statline">Tradable · Cashable</span>}
        />
        <ListRow
          lead={<ScripMark provenance="unsettled" />}
          title={<Amount value={p.scripUnsettled} unit="Scrip" size="md" tone="unsettled" />}
          sub={<ProvenanceChip provenance="unsettled" />}
          trail={<span className="ofx-statline">Spend-only</span>}
        />
      </RowGroup>
      <RowGroup>
        <ListRow
          lead={<Landmark size={18} strokeWidth={1.75} />}
          title="The Clearinghouse"
          sub="Swap Scrip and $ALPHA, deposit, and cash out to your wallet."
          trail={<ChevronRight size={16} strokeWidth={1.75} />}
          onPress={onClearinghouse}
        />
      </RowGroup>
      <Banner tone="unsettled" title="Unsettled Scrip">{UNSETTLED_EXPLAINER}</Banner>

      <RowGroup title="Activity">
        {rows === null && (
          <div style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-3) 0' }}>
            <Skeleton height={40} />
            <Skeleton height={40} />
          </div>
        )}
        {rows?.length === 0 && (
          <EmptyState art="/art/empty-after-hours.webp" title="Nothing on the Book yet" />
        )}
        {rows?.map((r) => {
          const d = r.settled + r.unsettled;
          const unsettled = r.unsettled !== 0 && r.settled === 0;
          return (
            <ListRow
              key={r.id}
              title={LEDGER_LABEL[r.kind] ?? r.kind}
              sub={unsettled ? <ProvenanceChip provenance="unsettled" /> : undefined}
              trail={
                <Amount
                  value={d}
                  unit="Scrip"
                  signed
                  tone={unsettled ? 'unsettled' : d >= 0 ? 'up' : 'down'}
                />
              }
            />
          );
        })}
      </RowGroup>
    </>
  );
}

/** Header mute glyph — inline SVG per §6 (24px grid, 2px stroke, themes through currentColor). */
function SoundIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on
        ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
        : <><path d="m22 9-6 6" /><path d="m16 9 6 6" /></>}
    </svg>
  );
}
