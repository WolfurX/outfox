/**
 * The public economy page (/economy): what the ledger and the chain say right now, for
 * anyone, without a session. Aggregates only (GET /api/economy) and public chain data
 * (GET /api/launch). It boots no player and loads no wallet code.
 *
 * Numbers print as they are: no count-ups, no rounding that flatters. An audit that does
 * not hold is shown as broken, in words as well as colour.
 */
import { useEffect, useState } from 'react';
import type { EconomyView, LaunchView } from '@outfox/shared';
import { api } from './api';
import { Amount, Banner, Chip, ListRow, Meter, RowGroup, Skeleton, Spark } from './ds';

const WEI = 10n ** 9n;
const REFRESH_MS = 30_000; // the server recomputes at most this often

function alpha(wei: string, dp = 2): string {
  const w = BigInt(wei);
  const frac = (w % WEI).toString().padStart(9, '0').slice(0, dp).replace(/0+$/, '');
  return `${(w / WEI).toLocaleString()}${frac ? '.' + frac : ''}`;
}
const usdc = (units: string) => (Number(BigInt(units) / 10_000n) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
const clock = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const EXPLORER: Record<number, string> = { 1: '?cluster=devnet', 2: '' };
// addresses are case-sensitive: the statline's uppercase must not apply
const ADDRESS = { textTransform: 'none', letterSpacing: 'normal' } as const;

function Verdict({ holds }: { holds: boolean | null }) {
  if (holds === null) return <Chip>Not checked</Chip>;
  return holds ? <Chip tone="up">Holds</Chip> : <Chip tone="down">Broken</Chip>;
}

function Address({ label, value, chainId }: { label: string; value: string; chainId: number | null }) {
  const short = `${value.slice(0, 4)}…${value.slice(-4)}`;
  const suffix = chainId === null ? undefined : EXPLORER[chainId];
  return (
    <ListRow
      title={label}
      trail={suffix === undefined
        ? <span className="ofx-statline" style={ADDRESS}><b>{short}</b></span>
        : <a className="ofx-statline" style={ADDRESS} title={value} href={`https://explorer.solana.com/address/${value}${suffix}`} target="_blank" rel="noreferrer"><b>{short}</b></a>}
    />
  );
}

function Launch({ launch, chainId }: { launch: LaunchView; chainId: number | null }) {
  const raised = Number(BigInt(launch.raised) / 1_000_000n);
  const threshold = Number(BigInt(launch.threshold) / 1_000_000n);
  const phase = { curve: 'Curve open', graduating: 'Curve complete', pool: 'Trading in the locked pool' }[launch.phase];
  return (
    <RowGroup title="$ALPHA on the open market">
      <ListRow title={phase} sub="Launched through Meteora"
        trail={<Amount value={launch.price.toFixed(4)} unit="USDC" size="lg" />} />
      {launch.phase !== 'pool' && (
        <div className="ofx-row" style={{ display: 'block' }}>
          <Meter label={`Raised of ${threshold.toLocaleString()} USDC`} value={raised} max={threshold} />
        </div>
      )}
      {launch.pool && (
        <>
          <ListRow title="Pool reserves"
            trail={<span className="ofx-row__title">{alpha(launch.pool.alpha)} $ALPHA · {usdc(launch.pool.quote)} USDC</span>} />
          <ListRow title="Permanently locked share of pool liquidity"
            sub="The launch liquidity cannot be withdrawn. Others can add their own on top."
            trail={<Amount value={(launch.pool.lockedBps / 100).toFixed(2)} unit="%" />} />
        </>
      )}
      <Address label="Token" value={launch.addresses.mint} chainId={chainId} />
      <Address label={launch.phase === 'pool' ? 'Pool' : 'Curve'} chainId={chainId}
        value={launch.phase === 'pool' ? launch.addresses.pool : launch.addresses.curve} />
    </RowGroup>
  );
}

export default function Economy() {
  const [eco, setEco] = useState<EconomyView | null | undefined>(undefined); // undefined: first load
  const [launch, setLaunch] = useState<{ view: LaunchView | null; chainId: number | null }>({ view: null, chainId: null });
  const [halted, setHalted] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const [e, l] = await Promise.all([api.economy(), api.launch()]);
        if (!live) return;
        setEco(e.economy);
        setLaunch({ view: l.launch, chainId: l.chainId });
        setHalted(false);
      } catch {
        if (live) setHalted(true);
      }
    };
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => { live = false; clearInterval(t); };
  }, []);

  useEffect(() => { document.title = 'Outfox · the economy, live'; }, []);

  const s = eco?.scrip;
  const liabilities = eco
    ? BigInt(eco.alpha.held) + BigInt(eco.alpha.exchangePool) + BigInt(eco.alpha.treasury) + BigInt(eco.alpha.cashingOut)
    : 0n;

  return (
    <div className="ofx-app">
      <div className="ofx-app__col">
        <header className="ofx-app__header">
          <a className="ofx-app__brand" href="/" style={{ color: 'inherit', textDecoration: 'none' }}>
            <span style={{ color: 'var(--c-accent-text)' }}>OUT</span>FOX
          </a>
          <a className="ofx-btn ofx-btn--secondary ofx-btn--sm" href="/">Play the game</a>
        </header>
        <main className="ofx-app__main">
          <div className="ofx-app__sections">
            <div>
              <h1 className="ofx-rowgroup__title">The economy, live</h1>
              <p className="ofx-sheet__text" style={{ margin: 0 }}>
                Totals from the ledger the game runs on, and the token as the chain shows it. No player is named here.
                {eco && <> As of {clock(eco.asOf)}.</>}
              </p>
            </div>

            {halted && (
              <Banner tone="halted" title="Tape halted">Can’t reach the Street. The figures below may be stale.</Banner>
            )}

            {eco === undefined && !halted && (
              <>
                <Skeleton height={52} />
                <Skeleton height={52} />
                <Skeleton height={52} />
              </>
            )}
            {eco === null && <Banner title="No reading yet">The Street has not published its figures. Try again in a minute.</Banner>}

            {eco && s && (
              <>
                <RowGroup title="Foxes">
                  <ListRow title="On the Street" trail={<Amount value={eco.players.total} size="lg" />} />
                  <ListRow title="Registered" trail={<Amount value={eco.players.registered} />} />
                  <ListRow title="Active in the last 24 hours" trail={<Amount value={eco.players.active24h} />} />
                </RowGroup>

                <RowGroup title="Scrip">
                  <ListRow title="Held by Foxes" sub={<Chip tone="up">Settled</Chip>}
                    trail={<Amount value={s.settled} unit="Scrip" size="lg" />} />
                  <ListRow title="Held by Foxes" sub={<Chip tone="unsettled" hatch dashed>Unsettled</Chip>}
                    trail={<Amount value={s.unsettled} unit="Scrip" size="lg" tone="unsettled" />} />
                  <ListRow title="Treasury" sub="Captured by fees, refills and the carry. Never operator revenue."
                    trail={<Amount value={s.treasury} unit="Scrip" />} />
                  <ListRow title="Exchange pool" trail={<Amount value={s.exchangePool} unit="Scrip" />} />
                  <ListRow title="Minted to date" sub="Every Scrip above is accounted for in this total."
                    trail={<Amount value={s.minted} unit="Scrip" />} />
                </RowGroup>

                <RowGroup title="Last 24 hours">
                  <ListRow title="Minted by play" trail={<Amount value={s.minted24h} unit="Scrip" signed />} />
                  <ListRow title="Captured by the sinks" trail={<Amount value={s.captured24h} unit="Scrip" />} />
                </RowGroup>

                <RowGroup title="$ALPHA in the game">
                  <ListRow title="Held by Foxes" trail={<Amount value={alpha(eco.alpha.held)} unit="$ALPHA" />} />
                  <ListRow title="Exchange pool" trail={<Amount value={alpha(eco.alpha.exchangePool)} unit="$ALPHA" />} />
                  <ListRow title="Treasury" trail={<Amount value={alpha(eco.alpha.treasury)} unit="$ALPHA" />} />
                  <ListRow title="Being cashed out" trail={<Amount value={alpha(eco.alpha.cashingOut)} unit="$ALPHA" />} />
                  <ListRow title="Owed in total" trail={<Amount value={alpha(liabilities.toString())} unit="$ALPHA" size="lg" />} />
                  <ListRow title="Held in escrow on chain"
                    sub={eco.alpha.reserve === null ? 'Not read from the chain right now.' : 'What backs every $ALPHA above.'}
                    trail={eco.alpha.reserve === null
                      ? <Chip>Not checked</Chip>
                      : <Amount value={alpha(eco.alpha.reserve)} unit="$ALPHA" size="lg" />} />
                </RowGroup>

                <RowGroup title="The exchange">
                  {eco.exchange
                    ? (
                      <>
                        <ListRow title="Scrip per $ALPHA" sub="Floats freely. Never pegged."
                          trail={<Amount value={Number(eco.exchange.rateCentsPerAlpha).toFixed(2)} unit="Scrip" size="lg" />} />
                        {eco.exchange.points.length > 1 && (
                          <div className="ofx-row" style={{ display: 'block' }}>
                            <Spark data={eco.exchange.points.map((p) => p.rate)} width={560} height={48} fill
                              ariaLabel="Scrip per $ALPHA, daily closes" />
                          </div>
                        )}
                      </>
                    )
                    : <ListRow title="Not open yet" sub="The pool is seeded by an explicit operator step." />}
                </RowGroup>

                {launch.view && <Launch launch={launch.view} chainId={launch.chainId} />}

                <RowGroup title="Audits">
                  <ListRow title="Scrip conservation" sub="Players, treasury and pool add up to everything minted."
                    trail={<Verdict holds={eco.audits.conservation} />} />
                  <ListRow title="$ALPHA ledger" sub="Every balance equals the sum of its entries."
                    trail={<Verdict holds={eco.audits.alphaLedger} />} />
                  <ListRow title="Exchange" sub="The pool equals the fold of its trades."
                    trail={<Verdict holds={eco.audits.exchange} />} />
                  <ListRow title="Proof of reserves" sub="Escrow on chain covers everything the game owes."
                    trail={<Verdict holds={eco.audits.solvency} />} />
                </RowGroup>

                <p className="ofx-sheet__text" style={{ margin: 0 }}>
                  Balances are as last settled: the carry is charged on a Fox’s next action. Velocity, the price index and
                  concentration are not on this page yet. The rules behind every figure are in
                  the <a href="https://outfox.gitbook.io/whitepaper/" target="_blank" rel="noreferrer">whitepaper</a>.
                </p>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
