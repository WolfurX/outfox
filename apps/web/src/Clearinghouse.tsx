/**
 * The Clearinghouse — the only surface where value crosses the boundary
 * (DESIGN-SYSTEM-WEB §13; ECONOMY.md §9). Composition follows the Claude Design
 * ClearinghouseScreen; every number is REAL: fees and caps come from @outfox/shared
 * (the sim-calibrated constants), rates and quotes from the live server.
 *
 * Rules enforced here (§12/§13):
 *  - Dates, not durations: every future event shows an absolute device-local date.
 *  - Over-cap entry is impossible, not an error: inputs clamp to live capacity.
 *  - A quote never worsens after display: swaps carry minOut; cash-out fees are
 *    priced at request time and seasoning only ages in the player's favor.
 *  - The client carries no chain code: wallets sign server-built transactions as-is.
 *  - Unseasoned is NOT Unsettled: seasoning is a time state on Settled-provenance
 *    ALPHA and must never borrow the firewall's hatch/tone.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlphaView, ExchangeView, PlayerView, ExchangeQuote } from '@outfox/shared';
import { ALPHA_BASE_UNITS, ALPHA_CARRY, EXCHANGE, VALVE } from '@outfox/shared';
import {
  ChevronLeft, Clock, Hourglass, Landmark, ScrollText, Shield, Wallet as WalletIcon,
} from 'lucide-react';
import { api } from './api';
import {
  Amount, Banner, Button, Chip, EmptyState, ListRow, Meter, RowGroup, Sheet, Skeleton, Spark,
} from './ds';
import {
  connect, hasWallet, pickWallet, rememberWallet, sendTx, signMessage, WalletError,
  type StdWallet,
} from './wallet';
import { WalletPicker } from './WalletPicker';

const WEI = ALPHA_BASE_UNITS;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// ----- exact ALPHA formatting (no floats near money; SPL 9dp base units) ------

function fmtAlpha(wei: bigint | string, dp = 4): string {
  const w = BigInt(wei);
  const whole = w / WEI;
  const frac = (w % WEI).toString().padStart(9, '0').slice(0, dp).replace(/0+$/, '');
  return `${whole.toLocaleString()}${frac ? '.' + frac : ''}`;
}

/** Machine form for input fills and clamps: never locale-grouped — in dot-grouping
 * locales (incl. id-ID) a grouped string re-parses 1000x off. Display uses fmtAlpha. */
function fmtAlphaPlain(wei: bigint): string {
  const frac = (wei % WEI).toString().padStart(9, '0').replace(/0+$/, '');
  return `${wei / WEI}${frac ? '.' + frac : ''}`;
}

function parseAlpha(s: string): bigint | null {
  const m = s.trim().match(/^(\d+)(?:\.(\d{0,9}))?$/);
  if (!m) return null;
  return BigInt(m[1]) * WEI + BigInt((m[2] ?? '').padEnd(9, '0') || '0');
}

const dateShort = (t: number) =>
  new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dateTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Client preview of the clearing fee — the same seasoned-first split the valve prices
 * at request time (settlement.ts priceWithdrawal). Seasoning only ages, so the real
 * quote can only match or improve on this preview. */
function previewFee(grossWei: bigint, balanceWei: bigint, unseasonedWei: bigint) {
  const seasoned = balanceWei - unseasonedWei;
  const unsConsumed = grossWei > seasoned ? grossWei - seasoned : 0n;
  const base = (grossWei * BigInt(VALVE.feeBps)) / 10_000n;
  const surcharge = (unsConsumed * BigInt(VALVE.unseasonedSurchargeBps)) / 10_000n;
  return { base, surcharge, fee: base + surcharge, net: grossWei - base - surcharge };
}

type Runner = <T extends object>(
  fn: () => Promise<T>, gate?: { reason: string },
) => Promise<T | null>;

export function Clearinghouse({ player, srvNow, run, onBack }: {
  player: PlayerView; srvNow: number; run: Runner; onBack: () => void;
}) {
  const [exchange, setExchange] = useState<ExchangeView | null>(null);
  const [exchangeOff, setExchangeOff] = useState(false);
  const [alphaV, setAlphaV] = useState<AlphaView | null>(null);
  const [chainOff, setChainOff] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [rules, setRules] = useState(false);
  const [note, setNote] = useState<string | null>(null); // wallet-step status line
  // A flow that needs a wallet parks its continuation here when several wallets are
  // detected and none is remembered; the picker sheet resumes it.
  const [pick, setPick] = useState<((w: StdWallet) => void) | null>(null);

  const withWallet = useCallback((fn: (w: StdWallet) => void) => {
    const w = pickWallet();
    if (w) fn(w);
    else setPick(() => fn);
  }, []);

  const refreshAlpha = useCallback(() => {
    api.alpha()
      .then((r) => { setAlphaV(r.alpha); setChainOff(false); })
      .catch(() => setChainOff(true));
  }, []);

  const refreshExchange = useCallback(() => {
    api.exchange()
      .then((r) => { setExchange(r.exchange); if (r.alpha) setAlphaV(r.alpha); setExchangeOff(false); })
      .catch(() => setExchangeOff(true));
    api.exchangeHistory()
      .then((r) => setHistory(r.points.map((p) => p.rate)))
      .catch(() => setHistory([]));
  }, []);

  useEffect(() => { refreshAlpha(); refreshExchange(); }, [refreshAlpha, refreshExchange]);

  return (
    <>
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft size={16} strokeWidth={1.75} /> Ledger
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Landmark size={20} strokeWidth={1.75} style={{ color: 'var(--c-text-2)' }} />
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semi)',
          letterSpacing: 'var(--track-caps-wide)', textTransform: 'uppercase',
        }}>
          The Clearinghouse
        </span>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="ghost" size="sm" onClick={() => setRules(true)}>
            <ScrollText size={14} strokeWidth={1.75} /> Rules
          </Button>
        </span>
      </div>

      {note && <Banner icon={<Clock size={16} strokeWidth={1.75} />}>{note}</Banner>}

      <RateStrip exchange={exchange} off={exchangeOff} history={history} />
      <ExchangeDesk
        player={player} exchange={exchange} off={exchangeOff} run={run}
        alphaWei={alphaV?.balanceWei ?? '0'}
        onDone={(ex, al) => { setExchange(ex); if (al) setAlphaV(al); refreshExchange(); }}
      />
      <AlphaBook alphaV={alphaV} chainOff={chainOff} srvNow={srvNow} />
      <CashOut
        player={player} alphaV={alphaV} chainOff={chainOff} srvNow={srvNow} run={run}
        setNote={setNote} onAlpha={setAlphaV} refresh={refreshAlpha} withWallet={withWallet}
      />
      <Deposit player={player} alphaV={alphaV} chainOff={chainOff} setNote={setNote} withWallet={withWallet} />

      {pick && (
        <Sheet title="Choose a wallet" onClose={() => setPick(null)}
          footer={<Button variant="secondary" full onClick={() => setPick(null)}>Cancel</Button>}>
          <WalletPicker onPick={(w) => {
            rememberWallet(w);
            const resume = pick;
            setPick(null);
            resume(w);
          }} />
        </Sheet>
      )}

      {rules && (
        <Sheet title="Clearinghouse Rules" onClose={() => setRules(false)}
          footer={<Button variant="secondary" full onClick={() => setRules(false)}>Close</Button>}>
          <ListRow title="Clearing fee" sub="On every cash-out, charged in $ALPHA."
            trail={<Amount value={VALVE.feeBps / 100} unit="%" />} />
          <ListRow title="Fresh $ALPHA surcharge"
            sub={`Any newly acquired $ALPHA pays this extra until it has aged ${VALVE.seasoningDays} days. Every acquisition starts its own clock.`}
            trail={<Amount value={VALVE.unseasonedSurchargeBps / 100} unit="%" />} />
          <ListRow title="Holding cost"
            sub="Idle $ALPHA pays this daily carry, same as idle Scrip — parked money is never the best seat in the house. It shows in the Ledger as Carry."
            trail={<Amount value={ALPHA_CARRY.idleRatePerDayBps / 100} unit="%/day" />} />
          <ListRow title="The shelter"
            sub={`Your first ${ALPHA_CARRY.progShelterAlpha} $ALPHA carry no extra cost. Above that, the excess pays ${ALPHA_CARRY.progRatePerDayBps / 100}% a day on top — deep pockets pay for the parking.`}
            trail={<Amount value={ALPHA_CARRY.progShelterAlpha} unit="$ALPHA" />} />
          <ListRow title="Vesting" sub="A clearance vests before its voucher can be redeemed."
            trail={<Amount value={VALVE.vestingDays} unit="days" />} />
          <ListRow title="Weekly capacity" sub="Per Fox, over a rolling 7 days."
            trail={<Amount value={VALVE.weeklyCapAlpha} unit="$ALPHA" />} />
          <ListRow title="Exchange fee" sub="Per swap. Rises during sustained one-way pressure, capped at 4x, and returns to base when trade calms."
            trail={<Amount value={EXCHANGE.feeBps / 100} unit="%" />} />
          <ListRow title="Exchange capacity" sub="Per side, per rolling day, as a share of the pool. Unfilled orders can retry later."
            trail={<Amount value={EXCHANGE.flowCapBps / 100} unit="%" />} />
        </Sheet>
      )}
    </>
  );
}

// ----- the rate strip ----------------------------------------------------------

function RateStrip({ exchange, off, history }: {
  exchange: ExchangeView | null; off: boolean; history: number[];
}) {
  if (off) return null;
  if (!exchange) return <Skeleton height={72} />;
  const rate = Number(exchange.rateCentsPerAlpha);
  const first = history[0] ?? rate;
  const chg = first > 0 ? ((rate - first) / first) * 100 : 0;
  const toll = exchange.effectiveFeeBps > exchange.baseFeeBps;
  return (
    <RowGroup title="$ALPHA · Scrip">
      <div style={{
        padding: 'var(--space-3) var(--space-1) var(--space-4)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Amount value={rate.toFixed(2)} unit="Scrip" size="lg" />
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {history.length >= 2 && (
              <span className="ofx-statline" style={{ color: chg >= 0 ? 'var(--c-up)' : 'var(--c-down)' }}>
                {chg >= 0 ? '+' : ''}{chg.toFixed(1)}%
              </span>
            )}
            {toll
              ? <Chip tone="warn">Toll {(exchange.effectiveFeeBps / 100).toFixed(1)}%</Chip>
              : <span className="ofx-statline">Fee {(exchange.baseFeeBps / 100).toFixed(1)}%</span>}
          </span>
        </div>
        {history.length >= 2 && (
          <Spark data={history} width={560} height={48} fill
            ariaLabel="$ALPHA to Scrip, recent sessions" />
        )}
      </div>
    </RowGroup>
  );
}

// ----- the exchange desk -------------------------------------------------------

function ExchangeDesk({ player, exchange, off, run, alphaWei, onDone }: {
  player: PlayerView; exchange: ExchangeView | null; off: boolean; run: Runner;
  alphaWei: string; onDone: (ex: ExchangeView, al?: AlphaView) => void;
}) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amt, setAmt] = useState('');
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [quoteNote, setQuoteNote] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const timer = useRef<number>();

  if (off) {
    return (
      <RowGroup title="The Exchange">
        <EmptyState icon={<Landmark size={20} strokeWidth={1.5} />}
          title="The exchange is not open yet"
          hint="Scrip and $ALPHA will trade here once the pool opens." />
      </RowGroup>
    );
  }
  if (!exchange) return <Skeleton height={180} />;

  // §13: over-cap entry is impossible — clamp to balance and live capacity
  const buyCap = Math.min(player.scripSettled, exchange.buyCapacityCents);
  const sellCap = (() => {
    const cap = BigInt(exchange.sellCapacityWei);
    const bal = BigInt(alphaWei);
    return bal < cap ? bal : cap;
  })();

  const amountRaw: bigint | null = side === 'buy'
    ? (/^\d+$/.test(amt) ? BigInt(amt) : null)
    : parseAlpha(amt);
  const valid = amountRaw !== null && amountRaw > 0n;

  const requote = (s: 'buy' | 'sell', text: string) => {
    window.clearTimeout(timer.current);
    setQuote(null);
    setQuoteNote(null);
    const raw = s === 'buy' ? (/^\d+$/.test(text) ? BigInt(text) : null) : parseAlpha(text);
    if (raw === null || raw <= 0n) return;
    timer.current = window.setTimeout(() => {
      api.exchangeQuote(s, raw.toString())
        .then((r) => { setQuote(r.quote ?? null); onDone(r.exchange); })
        .catch((e) => setQuoteNote((e as Error).message));
    }, 250);
  };

  const setAmount = (text: string) => {
    let clean = text.replace(side === 'buy' ? /[^0-9]/g : /[^0-9.]/g, '');
    if (side === 'buy' && clean && Number(clean) > buyCap) clean = String(buyCap);
    if (side === 'sell') {
      const parsed = parseAlpha(clean);
      if (parsed !== null && parsed > sellCap) clean = fmtAlphaPlain(sellCap);
    }
    setAmt(clean);
    requote(side, clean);
  };

  const flip = (s: 'buy' | 'sell') => { setSide(s); setAmt(''); setQuote(null); setQuoteNote(null); };

  const doSwap = async () => {
    if (!quote) return;
    setConfirm(false);
    const r = await run(
      () => api.exchangeSwap(side, quote.amountIn, quote.amountOut),
      { reason: 'The exchange is for registered Foxes.' },
    );
    if (r && 'exchange' in r) {
      onDone((r as { exchange: ExchangeView; alpha?: AlphaView }).exchange,
        (r as { alpha?: AlphaView }).alpha);
      setAmt('');
      setQuote(null);
    }
  };

  const receiveLabel = quote
    ? side === 'buy' ? `${fmtAlpha(quote.amountOut)} $ALPHA` : `${Number(quote.amountOut).toLocaleString()} Scrip`
    : null;

  return (
    <RowGroup title="The Exchange">
      <div style={{ padding: 'var(--space-3) var(--space-1)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant={side === 'buy' ? 'primary' : 'secondary'} size="sm" onClick={() => flip('buy')}>
            Buy $ALPHA
          </Button>
          <Button variant={side === 'sell' ? 'primary' : 'secondary'} size="sm" onClick={() => flip('sell')}>
            Sell $ALPHA
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            className="ofx-input" inputMode="decimal" style={{ flex: 1 }}
            aria-label={side === 'buy' ? 'Scrip to spend' : '$ALPHA to sell'}
            placeholder={side === 'buy' ? 'Scrip to spend' : '$ALPHA to sell'}
            value={amt} onChange={(e) => setAmount(e.target.value)}
          />
          <Button size="sm" onClick={() => setAmount(side === 'buy' ? String(buyCap) : fmtAlphaPlain(sellCap))}>
            Max
          </Button>
        </div>
        {quoteNote && <span className="ofx-statline">{quoteNote}</span>}
      </div>
      {quote && (
        <>
          <ListRow title={`Exchange fee (${(quote.effectiveFeeBps / 100).toFixed(1)}%)`}
            trail={<Amount value={side === 'buy' ? `-${Number(quote.fee).toLocaleString()}` : `-${fmtAlpha(quote.fee)}`} unit={side === 'buy' ? 'Scrip' : '$ALPHA'} size="sm" tone="muted" />} />
          <ListRow title="You receive" sub="At the pool rate this moment. If it moves against you before the swap lands, nothing executes."
            trail={<span className="ofx-row__title">{receiveLabel}</span>} />
        </>
      )}
      <div style={{ padding: 'var(--space-3) var(--space-1)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Meter
          label="Capacity today" tone="neutral" segments={10}
          value={side === 'buy'
            ? exchange.buyCapacityCents
            : Number(BigInt(exchange.sellCapacityWei) / WEI)}
          max={side === 'buy'
            ? Math.floor(exchange.poolScripCents * EXCHANGE.flowCapBps / 10_000)
            : Number((BigInt(exchange.poolAlphaWei) * BigInt(EXCHANGE.flowCapBps) / 10_000n) / WEI)}
        />
        <Button variant="primary" size="lg" full disabled={!valid || !quote} onClick={() => setConfirm(true)}>
          Review the swap
        </Button>
      </div>
      {confirm && quote && (
        <Sheet title="Confirm the swap" onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="primary" onClick={doSwap}>Swap</Button>
            </>
          }>
          <ListRow title={side === 'buy' ? 'You spend' : 'You sell'}
            trail={<span className="ofx-row__title">
              {side === 'buy' ? `${Number(quote.amountIn).toLocaleString()} Scrip` : `${fmtAlpha(quote.amountIn)} $ALPHA`}
            </span>} />
          <ListRow title={`Exchange fee (${(quote.effectiveFeeBps / 100).toFixed(1)}%)`}
            trail={<span className="ofx-row__title">
              {side === 'buy' ? `${Number(quote.fee).toLocaleString()} Scrip` : `${fmtAlpha(quote.fee)} $ALPHA`}
            </span>} />
          <ListRow title="You receive at least" sub="Quoted now. A worse rate cancels the swap instead of filling it."
            trail={<span className="ofx-row__title">{receiveLabel}</span>} />
        </Sheet>
      )}
    </RowGroup>
  );
}

// ----- $ALPHA balances ---------------------------------------------------------

function AlphaBook({ alphaV, chainOff, srvNow }: {
  alphaV: AlphaView | null; chainOff: boolean; srvNow: number;
}) {
  if (chainOff || !alphaV) return null;
  const bal = BigInt(alphaV.balanceWei);
  const uns = BigInt(alphaV.unseasonedWei);
  if (bal === 0n) return null;
  return (
    <RowGroup title="$ALPHA on your Book">
      <ListRow title={<Amount value={fmtAlpha(bal)} unit="$ALPHA" size="xl" />}
        sub="Spendable in the game. Cashing out passes the Clearinghouse." />
      {uns > 0n && (
        <ListRow title={<Amount value={fmtAlpha(uns)} unit="$ALPHA" size="md" />}
          sub={`Still fresh. Ages out of the ${VALVE.unseasonedSurchargeBps / 100}% surcharge ${VALVE.seasoningDays} days after each acquisition.`}
          trail={<Chip tone="warn">Fresh</Chip>} />
      )}
      <WeeklyCapacity alphaV={alphaV} srvNow={srvNow} />
    </RowGroup>
  );
}

function WeeklyCapacity({ alphaV, srvNow }: { alphaV: AlphaView; srvNow: number }) {
  const capWei = BigInt(VALVE.weeklyCapAlpha) * WEI;
  const remaining = BigInt(alphaV.weeklyRemainingWei);
  const used = capWei - remaining;
  const inWindow = alphaV.withdrawals.filter((w) => w.requestedAt > srvNow - WEEK_MS);
  const returnsAt = inWindow.length
    ? Math.min(...inWindow.map((w) => w.requestedAt)) + WEEK_MS
    : null;
  return (
    <div style={{ padding: 'var(--space-3) var(--space-1)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      <Meter label="Cleared this week" tone="accent" segments={10}
        value={Number(used / WEI)} max={VALVE.weeklyCapAlpha} />
      {used > 0n && returnsAt && (
        <span className="ofx-statline">Capacity returns {dateTime(returnsAt)}</span>
      )}
    </div>
  );
}

// ----- cash-out ----------------------------------------------------------------

function CashOut({ player, alphaV, chainOff, srvNow, run, setNote, onAlpha, refresh, withWallet }: {
  player: PlayerView; alphaV: AlphaView | null; chainOff: boolean; srvNow: number;
  run: Runner; setNote: (s: string | null) => void;
  onAlpha: (a: AlphaView) => void; refresh: () => void;
  withWallet: (fn: (w: StdWallet) => void) => void;
}) {
  const [amt, setAmt] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  if (chainOff) {
    return (
      <RowGroup title="Cash out">
        <EmptyState icon={<Landmark size={20} strokeWidth={1.5} />}
          title="The chain edge is not connected"
          hint="Deposits and cash-outs open when the Street connects to the chain." />
      </RowGroup>
    );
  }
  if (!alphaV) return <Skeleton height={120} />;

  const linkWallet = async (w: StdWallet) => {
    setBusy(true);
    setNote('Waiting for the wallet...');
    try {
      const account = await connect(w);
      const { nonce, message } = await api.walletNonce();
      setNote('Sign the link message in your wallet. It moves no funds.');
      const signature = await signMessage(w, account, message);
      const r = await run(() => api.walletLink(account.address, nonce, signature));
      if (r && 'alpha' in r) onAlpha((r as { alpha: AlphaView }).alpha);
      setNote(null);
    } catch (e) {
      setNote(e instanceof WalletError ? `Wallet: ${e.message}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    const r = await run(() => api.verifyDev());
    if (!r) setNote('Verification is not open on this build yet.');
    setBusy(false);
  };

  // the identity ladder, §13 steps 3 and 4 — the demanding surface triggers each upgrade
  if (player.rung < 2 || !alphaV.wallet) {
    return (
      <RowGroup title="Cash out">
        <ListRow
          lead={<WalletIcon size={18} strokeWidth={1.75} />}
          title="Link a wallet"
          sub="Cash-outs settle on chain, to a wallet you prove you control."
          trail={hasWallet()
            ? <Button variant="primary" size="sm" disabled={busy}
                onClick={() => withWallet((w) => void linkWallet(w))}>Link</Button>
            : <span className="ofx-statline">No wallet in this browser</span>}
        />
      </RowGroup>
    );
  }
  if (player.rung < VALVE.minRung) {
    return (
      <RowGroup title="Cash out">
        <ListRow
          lead={<Shield size={18} strokeWidth={1.75} />}
          title="Verify once"
          sub="One-time. Proves you're one Fox — the Clearinghouse clears people, not bots. We never see your identity documents."
          trail={<Button variant="primary" size="sm" disabled={busy} onClick={verify}>Verify</Button>}
        />
      </RowGroup>
    );
  }

  const bal = BigInt(alphaV.balanceWei);
  const cap = (() => {
    const weekly = BigInt(alphaV.weeklyRemainingWei);
    return bal < weekly ? bal : weekly;
  })();
  const gross = parseAlpha(amt);
  const valid = gross !== null && gross > 0n && gross <= cap;
  const fees = valid ? previewFee(gross!, bal, BigInt(alphaV.unseasonedWei)) : null;
  const settlesAt = srvNow + VALVE.vestingDays * DAY_MS;

  const setAmount = (text: string) => {
    let clean = text.replace(/[^0-9.]/g, '');
    const parsed = parseAlpha(clean);
    if (parsed !== null && parsed > cap) clean = fmtAlphaPlain(cap);
    setAmt(clean);
  };

  const doRequest = async () => {
    if (!gross) return;
    setConfirm(false);
    const r = await run(() => api.withdrawRequest(gross.toString()));
    if (r && 'alpha' in r) {
      onAlpha((r as { alpha: AlphaView }).alpha);
      setAmt('');
    }
  };

  return (
    <RowGroup title="Cash out">
      <div style={{ padding: 'var(--space-3) var(--space-1)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input
          className="ofx-input" inputMode="decimal" style={{ flex: 1 }}
          aria-label="$ALPHA to cash out" placeholder="$ALPHA to cash out"
          value={amt} onChange={(e) => setAmount(e.target.value)}
        />
        <Button size="sm" onClick={() => setAmount(fmtAlphaPlain(cap))}>Max</Button>
      </div>
      {fees !== null && gross !== null && (
        <>
          <ListRow title={`Clearing fee (${VALVE.feeBps / 100}% of the amount)`}
            trail={<span className="ofx-row__title">{fmtAlpha(fees.base)} $ALPHA</span>} />
          {fees.surcharge > 0n && (
            <ListRow title={`Fresh $ALPHA surcharge (${VALVE.unseasonedSurchargeBps / 100}%)`}
              sub="Applies only to the part acquired inside the seasoning window. Aged $ALPHA clears first."
              trail={<span className="ofx-row__title">{fmtAlpha(fees.surcharge)} $ALPHA</span>} />
          )}
          <ListRow title="Lands in your wallet" sub="Includes everything — nothing added later."
            trail={<Amount value={fmtAlpha(fees.net)} unit="$ALPHA" size="md" />} />
          <ListRow title={`Settles ${dateShort(settlesAt)}`}
            sub="Vests first, then you redeem the voucher from your wallet." />
        </>
      )}
      <div style={{ padding: 'var(--space-3) var(--space-1)' }}>
        <Button variant="primary" size="lg" full disabled={!valid} onClick={() => setConfirm(true)}>
          Cash out
        </Button>
      </div>
      {confirm && fees !== null && gross !== null && (
        <Sheet title="Confirm the clearance" onClose={() => setConfirm(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="primary" onClick={doRequest}>Confirm</Button>
            </>
          }>
          <ListRow title="Amount" trail={<span className="ofx-row__title">{fmtAlpha(gross)} $ALPHA</span>} />
          <ListRow title="Clearing fee, all in one line" sub="Includes everything — nothing added later."
            trail={<span className="ofx-row__title">{fmtAlpha(fees.fee)} $ALPHA</span>} />
          <ListRow title={`Lands ${dateShort(settlesAt)}`}
            trail={<Amount value={fmtAlpha(fees.net)} unit="$ALPHA" size="md" />} />
        </Sheet>
      )}
      <Pending alphaV={alphaV} setNote={setNote} refresh={refresh} withWallet={withWallet} />
    </RowGroup>
  );
}

// ----- pending clearances ------------------------------------------------------

function Pending({ alphaV, setNote, refresh, withWallet }: {
  alphaV: AlphaView; setNote: (s: string | null) => void; refresh: () => void;
  withWallet: (fn: (w: StdWallet) => void) => void;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);

  const redeem = async (w: StdWallet, id: number) => {
    setBusyId(id);
    setNote('Preparing the voucher...');
    try {
      const claim = await api.withdrawClaim(id);
      const account = await connect(w);
      // the server built the transaction with the voucher's recipient as fee payer —
      // only that wallet can sign it. Fail closed with the reason, not a wallet error.
      if (account.address !== claim.voucher.to) {
        setNote(`Switch to your linked wallet (${claim.voucher.to.slice(0, 4)}…${claim.voucher.to.slice(-4)}) — the voucher redeems from there.`);
        return;
      }
      setNote('Confirm the redemption in your wallet. Your wallet pays the network fee.');
      await sendTx(w, account, claim.redeemTx, claim.voucher.chainId);
      setNote('Sent. It lands after the chain confirms; this list updates on its own.');
      refresh();
    } catch (e) {
      setNote(e instanceof WalletError ? `Wallet: ${e.message}` : (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (alphaV.withdrawals.length === 0) {
    return (
      <ListRow lead={<Hourglass size={18} strokeWidth={1.75} />} title="Nothing pending"
        sub="A clearance vests here first, then settles on chain." />
    );
  }
  return (
    <>
      {alphaV.withdrawals.map((w) => {
        const net = fmtAlpha(w.netWei);
        if (w.status === 'vesting') {
          return (
            <ListRow key={w.id} lead={<Hourglass size={18} strokeWidth={1.75} />}
              title={`${net} $ALPHA`} sub={`Vests ${dateTime(w.vestsAt)}`}
              trail={<Chip tone="warn">Vesting</Chip>} />
          );
        }
        if (w.status === 'claimable' || w.status === 'signed') {
          return (
            <ListRow key={w.id} lead={<Clock size={18} strokeWidth={1.75} />}
              title={`${net} $ALPHA`} sub="Vested. Redeem it from your linked wallet."
              trail={
                <Button variant="primary" size="sm" disabled={busyId !== null}
                  onClick={() => withWallet((wal) => void redeem(wal, w.id))}>
                  Redeem
                </Button>
              } />
          );
        }
        return (
          <ListRow key={w.id} lead={<Landmark size={18} strokeWidth={1.75} />}
            title={`${net} $ALPHA`}
            sub={w.txHash ? `Settled on chain · ${w.txHash.slice(0, 10)}…` : 'Settled on chain'}
            trail={<Chip tone="up">Cleared</Chip>} />
        );
      })}
    </>
  );
}

// ----- deposits ----------------------------------------------------------------

function Deposit({ player, alphaV, chainOff, setNote, withWallet }: {
  player: PlayerView; alphaV: AlphaView | null; chainOff: boolean;
  setNote: (s: string | null) => void;
  withWallet: (fn: (w: StdWallet) => void) => void;
}) {
  const [amt, setAmt] = useState('');
  const [busy, setBusy] = useState(false);
  if (chainOff || player.rung < 2) return null;

  const wei = parseAlpha(amt);
  const valid = wei !== null && wei > 0n;

  const doDeposit = async (w: StdWallet) => {
    if (!wei) return;
    setBusy(true);
    try {
      const account = await connect(w);
      // deposits credit by depositor address: any other account's tokens would land
      // in escrow unclaimed with no way to link that address later. Fail closed.
      const linked = alphaV?.wallet?.address;
      if (linked && account.address !== linked) {
        setNote(`Switch to your linked wallet (${linked.slice(0, 4)}…${linked.slice(-4)}) — deposits from other wallets cannot reach your Book.`);
        return;
      }
      const prep = await api.depositPrepare(wei.toString(), account.address);
      setNote('Confirm the deposit in your wallet — one step. Your wallet pays the network fee.');
      await sendTx(w, account, prep.depositTx, prep.chainId);
      setNote('Deposit sent. It lands on your Book after the chain confirms.');
      setAmt('');
    } catch (e) {
      setNote(e instanceof WalletError ? `Wallet: ${e.message}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RowGroup title="Deposit from your wallet">
      <div style={{ padding: 'var(--space-3) var(--space-1)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
        <input
          className="ofx-input" inputMode="decimal" style={{ flex: 1 }}
          aria-label="$ALPHA to deposit" placeholder="$ALPHA to deposit"
          value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <Button variant="primary" size="sm" disabled={!valid || busy || !hasWallet()}
          onClick={() => withWallet((w) => void doDeposit(w))}>
          Deposit
        </Button>
      </div>
      <ListRow title="On-chain $ALPHA becomes Book $ALPHA"
        sub="Each deposit starts its own seasoning clock. Your wallet pays the network fee." />
    </RowGroup>
  );
}
