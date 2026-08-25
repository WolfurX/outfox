import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BootstrapResponse, CallDef, CallResult, ItemKind, LedgerRow, ListingView, PlayerView,
} from '@outfox/shared';
import {
  GIG, ITEM_KINDS, MARKET_FEE_BPS, REFILL, REGEN, UNSETTLED_EXPLAINER,
} from '@outfox/shared';
import {
  Activity, ChevronRight, Crosshair, Gauge, Landmark, Moon, Store, Sun, TriangleAlert, WifiOff,
} from 'lucide-react';
import { api } from './api';
import { Clearinghouse } from './Clearinghouse';
import { RegisterSheet } from './RegisterSheet';
import { registerSW } from './sw-register';
import {
  ActionResult, ActionRow, Amount, Banner, Button, Chip, EmptyState, ListRow, Meter,
  ProvenanceChip, RowGroup, Skeleton, SplitBar, TabBar, type TabDef,
} from './ds';

type Tab = 'tape' | 'market' | 'ledger';

const TABS: TabDef[] = [
  { id: 'tape', label: 'The Tape', icon: <Activity size={18} strokeWidth={1.75} /> },
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

export default function App() {
  const [boot, setBoot] = useState<BootstrapResponse | null>(null);
  const [player, setPlayer] = useState<PlayerView | null>(null);
  const [listings, setListings] = useState<ListingView[]>([]);
  const [tab, setTab] = useState<Tab>('tape');
  const [clearing, setClearing] = useState(false); // Clearinghouse, a Ledger sub-surface
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [halted, setHalted] = useState(false);
  const [register, setRegister] = useState<{ reason: string; resume: () => void } | null>(null);
  const [swApply, setSwApply] = useState<(() => void) | null>(null);
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

  useEffect(() => {
    api.bootstrap()
      .then((b) => { setBoot(b); absorb(b.player); setListings(b.listings); })
      .catch(() => setHalted(true));
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
  const doCall = useCallback(async (id: string) => {
    const r = await run(() => api.call(id));
    const result = (r as { result?: CallResult } | null)?.result;
    if (!result) return;
    setFeedback(result.ok
      ? {
          actionId: id, kind: 'clean', seq: ++seq.current,
          text: `Filled +${result.payout.toLocaleString()} Scrip`,
          note: 'Unsettled — spend-only',
        }
      : {
          actionId: id, kind: 'nicked', seq: ++seq.current,
          text: 'Nicked', note: 'The Sheriff saw it coming',
        });
    setFtueDone((done) => {
      if (!done) { try { localStorage.setItem('outfox.ftue', 'done'); } catch { /* private mode */ } }
      return true;
    });
  }, [run]);

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
      {wide && <TabBar rail tabs={TABS} active={tab} onSelect={(t) => { setTab(t as Tab); setClearing(false); }} />}
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

            {tab === 'tape' && showFtue && (
              <Ftue
                call={boot.catalog.calls.reduce((a, b) => (a.riskCost <= b.riskCost ? a : b))}
                onCall={doCall}
              />
            )}
            {tab === 'tape' && !showFtue && (
              <Tape
                player={player} boot={boot} srvNow={srvNow} feedback={feedback}
                onCall={doCall}
                onGig={async () => {
                  const r = await run(() => api.gig());
                  const tool = (r as { toolAwarded?: ItemKind } | null)?.toolAwarded;
                  setFeedback(tool
                    ? {
                        actionId: GIG.id, kind: 'clean', seq: ++seq.current,
                        text: `${ITEM_KINDS[tool].name} earned`, note: 'In your kit',
                      }
                    : {
                        actionId: GIG.id, kind: 'clean', seq: ++seq.current,
                        text: `Settled +${GIG.payout.toLocaleString()} Scrip`,
                      });
                }}
                onRefill={(bar) => run(() => api.refill(bar))}
              />
            )}

            {tab === 'market' && (
              <Market
                player={player} listings={listings}
                onBuy={(id) => run(() => api.buy(id), { reason: 'Buying on the Open Market is for registered Foxes.' })}
                onList={(itemId, price) => run(() => api.list(itemId, price), { reason: 'Listing on the Open Market is for registered Foxes.' })}
                onCancel={(id) => run(() => api.cancel(id))}
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
          reason={register.reason}
          onClose={() => setRegister(null)}
          onDone={(pl) => { absorb(pl); const resume = register.resume; setRegister(null); resume(); }}
          onAdopted={(pl) => { absorb(pl); setRegister(null); setTab('tape'); }}
        />
      )}

      {!wide && <TabBar tabs={TABS} active={tab} onSelect={(t) => { setTab(t as Tab); setClearing(false); }} />}
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
  onCall: (id: string) => void; onGig: () => void; onRefill: (bar: 'focus' | 'risk') => void;
}) {
  const { player: p, boot, srvNow, feedback } = props;
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

      <RowGroup title="Your Book">
        <ListRow
          title={<Amount value={p.scripSettled} unit="Scrip" size="xl" />}
          sub={<ProvenanceChip provenance="settled" />}
        />
        <ListRow
          title={<Amount value={p.scripUnsettled} unit="Scrip" size="lg" tone="unsettled" />}
          sub={<ProvenanceChip provenance="unsettled" />}
        />
      </RowGroup>
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

      <RowGroup title="Calls — vs the market">
        {boot.catalog.calls.map((c) => {
          const wait = cd(c.id);
          const blocked = wait > 0 || risk < c.riskCost;
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
                  <SplitBar successPct={c.successP * 100} />
                  <Button variant="primary" size="sm" disabled={blocked} onClick={() => props.onCall(c.id)}>
                    {wait > 0 ? `${wait}s` : risk < c.riskCost ? 'Low Risk' : 'Run it'}
                  </Button>
                </div>
              }
              result={resultFor(c.id)}
            />
          );
        })}
      </RowGroup>

      <RowGroup title="Gigs — honest work">
        <ActionRow
          title={boot.catalog.gig.name}
          desc={boot.catalog.gig.flavor}
          meta={
            <>
              <span>Focus {boot.catalog.gig.focusCost}</span>
              <span>Pays {boot.catalog.gig.payout}</span>
              <Chip tone="up">Settled</Chip>
              <span>Tool {p.gigCount % boot.catalog.gig.toolEvery}/{boot.catalog.gig.toolEvery}</span>
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
            hint="List a tool below, or wait for another Fox."
          />
        )}
        {listings.map((l) => {
          const short = !l.mine && p.scripSettled < l.price;
          return (
            <ListRow
              key={l.id}
              lead={<ItemThumb kind={l.itemKind} />}
              title={kindName(l.itemKind)}
              sub={l.mine ? 'Your listing' : l.seller}
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

      <RowGroup title="Your kit">
        {unlisted.length === 0 && (
          <EmptyState title="Nothing to list" hint="Run Gigs to earn tools." />
        )}
        {unlisted.map((i) => {
          const price = prices[i.id] ?? '';
          return (
            <ListRow
              key={i.id}
              lead={<ItemThumb kind={i.kind} />}
              title={kindName(i.kind)}
              sub={ITEM_KINDS[i.kind].desc}
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
  fee: 'Fee', refill: 'Refill', starter: 'Starter', carry: 'Carry',
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
          title={<Amount value={p.scripSettled} unit="Scrip" size="md" />}
          sub={<ProvenanceChip provenance="settled" />}
          trail={<span className="ofx-statline">Tradable · Cashable</span>}
        />
        <ListRow
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
