# Data architecture — everything is telemetry

**Standing decision (owner, 2026-07-11):** the game is **data-oriented from day one**.
Every transaction, every wallet holding $ALPHA, every economic mutation is recorded as
analyzable data, because every future tuning decision — the §3/§10 policy levers, the
payer-mix recalibration, sybil clustering, the split-hoard red-team, the external-market
watch — runs on this telemetry. `ECONOMY.md` §10 already makes the dashboards acceptance
criteria; this doc is the architecture contract that makes them buildable. Every Phase-2+
server/indexer module builds against it.

*Vocabulary note (two-layer rule, repo `CLAUDE.md`): this doc straddles both layers by
necessity — on-chain artifacts are named as deployed (**$ALPHA**, `Settlement`), while
economy internals use the frozen mechanics vocabulary. $ALPHA **is** the mechanics
layer's $ALPHA (`THEME-OUTFOX.md` §2).*

## 1. Principles

1. **Append-only events are the source of truth.** No economic fact is ever stored only
   as mutable state: state is a fold over events. The slice's single-mutation-gate +
   provenance-tagged ledger is the seed of this pattern; it becomes the rule. Raw events
   are never aggregated away — store raw, derive views, so metrics we haven't thought of
   yet can be computed retroactively ("everything is data that *can* be used later").
2. **Live gates are the sim gates.** Production metrics are computed with the **same
   estimators as the sim's metric layer** (`sim/simulation.py` — `_gini`, `_hill_alpha`
   top-decile +1-free, the velocity/faucet:sink/CAPTURE-share accounting;
   `sim/gate.py` holds the windows and thresholds, whose tick-windows need defined live
   analogues, e.g. the mature-window median). **CPI is computed twice**: the real
   fixed-basket CPI (§10's definition — the production truth) *and* the sim's
   reduced-form M/Q level (kept solely for sim comparability; it is a named model
   limitation, not a definition). G1–G12 thereby become **live SLOs — with one carve-out:
   G11 (sybil share) has ground-truth mule identity only in the sim; live G11 and
   `bot_pass_rate` are proxy estimates from funding-graph clustering, and must be
   labeled as such.** Sim predictions become falsifiable against production, and
   measured behavior recalibrates `DEFAULT_PARAMS` (the TEC loop closed with real data).
3. **The central bank is auditable.** Every policy-parameter change is itself an event
   (old value, new value, which pre-committed rule fired). Discretion leaves a log.
4. **Pseudonymous by construction.** Events key on account ids and
   public chain addresses — no PII in the event stream (auth identifiers live only in
   the auth tables; deleting an identity = severing the id mapping, events stay valid).
   The stack is **self-hosted** (Postgres + in-house jobs + self-hosted dashboards): no
   third-party analytics SaaS — leaner (bootstrap budget), and no vendor holds a
   correlatable picture of the game's economy or its operator.

## 2. Event streams

| Stream | Events (all: actor id, rung, tick/timestamp, amounts, currency) | Feeds |
|---|---|---|
| `econ.*` (game ledger) | faucet grants (source, provenance Clean/Bound), sinks (class, CAPTURE/dead tag), P2P transfers + fees, internal-exchange trades (side, fee, rate — the G9 price series), stake/unstake/unbond, carry + demurrage assessments, seasoning state changes, withdrawal lifecycle (requested → voucher signed → chain-confirmed → vested/released), deposit credited | M, V, P, Q, faucet:sink, sink efficacy, G1–G10 |
| `chain.*` (indexer) | every $ALPHA `Transfer` from genesis → **holders table** (address, balance, first_seen, last_active, **first-funder edge** — the funding-graph input), `Settlement` `Deposited`/`Withdrawn`, DEX pool events on $ALPHA pairs (swaps, liquidity) → external price/volume/depth series | wallet census, sybil clustering (feasibility §2), split-hoard detection (§13.D residual 1), external-market watch (AUDIT-2 §9), on-chain PoR vs ledger liabilities (G12 live) |
| `policy.*` | parameter changes (old, new, rule invoked), treasury ops (TWAP legs, share-outs), pause/signer events | rule-compliance audit, §3 pre-commitment proof |
| `identity.*` | rung transitions, PoP attempts + outcomes (→ live `bot_pass_rate`), wallet links/unlinks, device handoffs | G11 live, sybil KPIs, R-ladder funnel |

## 3. Storage & metric layer

- **Postgres, append-only event tables** (versioned schemas; new fields additive), with
  derived **materialized views** per dashboard metric. The slice's `node:sqlite` ledger
  migrates into this shape with the PostgreSQL move (`PLAN.md` §4).
- **Metric jobs** recompute the §10 series (M, V, P, Q, CPI, Gini, α, per-source faucet /
  per-sink efficacy, token velocity, sybil share, exit-Gini) on a fixed cadence with the
  `gate.py` estimators — shared implementation, ported once, tested against sim fixtures
  so live and sim numbers are definitionally comparable.
- **Alerting = the gate thresholds.** A live G-criterion leaving its band pages the
  operator and points at the pre-committed §3 response. Parameter moves stay inside the
  sweep-validated intervals; anything outside requires a new sim round first.

## 4. What this enables (already queued)

- **Payer-mix instrumentation at launch** (README finding #4 — the Gini result's guard).
- **Funding-graph clustering** for the split-hoard residual and smart_sybil's
  product-level defense (PoP quality measured, not assumed).
- **The round-7 external-venue model** calibrated from real DEX + valve data
  (AUDIT-2 §9) and the POL depth decision.
- **DEFAULT_PARAMS recalibration** from measured behavior — the sim stays the twin of
  the live economy, not a launch-time snapshot.

## 5. Boundaries

Chain data is public by nature; game-ledger events are internal. Nothing here creates a
PII store: legal/retention review of the identity tables joins the counsel gate
(`VALIDATION-BENCHMARKS.md` §4). A pre-publication redaction sweep applies to any published
dashboard or dataset.
