# Economy Design Document — "Outfox"

> **Status:** Phase 0 draft. **This is the priority-#1 contract.** Where any other doc
> disagrees with this one on an economic rule, this doc wins. It must be detailed enough to
> build directly into a **Machinations** Monte-Carlo model (§11 gate) *before* any economy
> code is written.
>
> **PIVOT NOTICE (2026-07-02 — read the platform words through it).** The **economic rules
> in this doc are frozen and unchanged**, but the project has pivoted off TON/Telegram to a
> **standalone web PWA on Robinhood Chain** (`PLAN.md` top notice;
> `ROBINHOOD-FEASIBILITY.md` §2 is the full mapping). Wherever this doc says a platform
> word, substitute:
> **Jetton** → ERC-20 on Robinhood Chain (chain id 4663) · **TON Connect** → SIWE/wagmi +
> Privy embedded smart accounts · **Telegram Stars** → stablecoin checkout · **"inside
> Telegram"** → the open-web PWA · **TON HumanCode** → World ID (Orb) with per-region KYC
> fallback · on-chain settlement "on TON" → on Robinhood Chain. Vocabulary note: **$ALPHA**
> and **Outfox** are this doc's frozen mechanics-layer names — the shipped token and game
> are **$ALPHA** / **Outfox** (`THEME-OUTFOX.md` §2; two-layer rule in `CLAUDE.md`). These
> substitutions change no economic rule; do not rewrite the sections below.
>
> **Canonical reference:** Vili Lehdonvirta & Edward Castronova, *Virtual Economies: Design
> and Analysis* (MIT Press, 2014) — abbreviated **L&C** below. This doc is structured as L&C
> prescribes: a *designed* economy *analyzed* with real micro / macro / monetary / behavioral
> theory, not GameFi folklore.

---

## 0. The thesis (why this design exists)

~93% of GameFi projects are dead by 2026, almost always from **emission-funded** P2E
economies: a token printer (faucet) funds player earnings, faucet > sink, hyperinflation,
collapse (Axie Infinity, StepN). Torn is the rare earning-first game that has lasted 20 years
because it is **transfer-funded**: players earn from *other players* + real-money convenience
spend, not from a printer. **We copy that structure exactly and resist the crypto reflex to
bolt on an emission faucet.**

**Core invariant (do not violate):**
> Player earnings are funded by **player-to-player transfer** and **real-money convenience
> spend**. There is **no emission faucet** minting free currency to players for showing up.

The currencies:
- **Credits (¢)** — soft cash, the working medium. Demurrage-bearing, P2P-transferable, **not
  directly cashable**. Where almost all gameplay value lives.
- **$ALPHA (Jetton)** — premium TON token: scarce store-of-value + premium-convenience access.
  Floating vs Credits (**never pegged**). The **only** cashable asset, behind the §9 gate.

---

## 1. Master model — Quantity Theory of Money (MV = PQ)

We manage inflation as a **macro system**, not with the crude "keep sink/faucet ≥ 1" heuristic.

| Symbol | Meaning in this game | How we measure it |
|---|---|---|
| **M** | Circulating money: Credits in player hands + the Credit-equivalent of liquid $ALPHA | Sum of balances, excluding sunk/locked/treasury |
| **V** | Velocity — how often a unit of M changes hands per period | (transaction volume) / M, per rolling window |
| **P** | Price level — cost of a representative basket of in-game goods | CPI over a fixed basket (tools, regen, top items) |
| **Q** | Real output — real value of goods & services actually traded (**in-game GDP**) | Real transaction volume (deflated by P) |

**The identity: `M · V = P · Q`.** Rearranged, the price level `P = (M · V) / Q`.

**Policy target — stable P.** Keep **M-growth ≈ Q-growth** (and V inside its band). If the
economy produces more real stuff (Q↑), money supply can grow proportionally without inflation.
If M or V outruns Q, P rises (inflation) and we tighten; if activity collapses (V↓, Q↓), we
stimulate. **All four variables are instrumented live** (§10) — this replaces folklore with a
real macro control loop.

---

## 2. The three existential levers (because $ALPHA is tradable)

A tradable token makes three failure modes existential. Each has dedicated levers.

### 2.1 Velocity control (manage **V**)
Two opposite dangers:
- **V too low (hoarding):** money sits still → trade starves → the token becomes pure
  speculation, the game-economy dies underneath it.
- **V too high (hot-potato dumping):** everyone offloads instantly → price collapse.

**Levers (tune V into its band):**
- **Demurrage on Credits (Gesell).** Credits carry a small **holding cost** (decay / negative
  interest) per period. Holding cash is costly → it must circulate or be spent → forces V up
  on the working currency and kills the "hoard cash forever" strategy. Demurrage revenue is a
  **sink** routed to the treasury. *(Tunable: rate, exemption floor, Safehouse shelter cap.)*
- **Staking / time-locks on $ALPHA.** Let holders lock $ALPHA for yield-in-*convenience* or
  status (NOT minted cash) → **cuts sell pressure**, lowers $ALPHA velocity precisely when
  dumping is the risk. *(Yield must be convenience/status, not emitted currency — invariant.)*
  **Idle (un-staked) $ALPHA also carries a holding cost (§13.A)** so staking is the *only* decay-free
  store — this is what closes the flight-to-$ALPHA Gresham dodge.
- **Spend-required sinks** (regen, fees, upkeep) — keep baseline V healthy.
- **Transaction fees** on Market/transfers — modest friction that both sinks money and damps
  hot-potato churn.

### 2.2 Gresham dynamics ("bad money drives out good")
The two-currency failure mode: if **Credits inflate** while **$ALPHA appreciates** under any
peg, rational players **spend Credits and hoard $ALPHA** → $ALPHA velocity dies, the token
becomes a speculative brick, and the working economy floods with depreciating cash.

**Defenses:**
- **Floating exchange, NEVER pegged.** No fixed or guaranteed Credit↔$ALPHA rate. A peg is what
  *creates* the arbitrage that drives the Gresham split. Price is discovered on a floating
  market only.
- **$ALPHA-denominated sinks.** Some premium goods/fees are priced in $ALPHA, forcing token
  *spending* (demand for use, not just holding) → keeps $ALPHA velocity alive.
- **Holding cost on *idle* $ALPHA (§13.A), not just Credits.** Demurrage on Credits alone is
  **not** enough — a decay-free $ALPHA *is* the superior hoard, and the red-team's flight-to-$ALPHA
  attack exploits exactly that. The fix: idle liquid $ALPHA decays too (≈ Credit rate); only
  **staked/locked** $ALPHA is exempt — and staked $ALPHA **never pays the base rate at any size**.
  Above the published per-identity shelter (§13.D) the *total* position pays the progressive
  carry regardless of bucket (idle pays base + progressive; staked pays progressive only), so
  the sole free lunch is *locked, ordinarily-sized* $ALPHA and locking still strictly beats
  idle at every hoard size.
- **Strict role separation:** **$ALPHA = store-of-value / premium access**; **Credits = working
  medium**. They are not substitutes, so they don't compete as "the money you hoard vs spend."

### 2.3 Value-accruing sinks (sinks must **capture** value, not just burn time)
A sink that merely deletes currency (e.g. "pay 100¢ to click") controls M but produces nothing.
L&C's point: good sinks **capture** the value they remove.

- **Veblen-good status cosmetics.** Demand *rises* with price (conspicuous consumption) →
  drains whales' Credits/$ALPHA **without selling power** → controls M and Gini simultaneously.
- **Auction-based primary sales of rares.** Sell scarce items by **auction** (not fixed price)
  → extracts true willingness-to-pay → proceeds to treasury. Use **sealed-bid / Vickrey**
  formats to resist bot sniping and reveal honest demand (auction theory, §4). The primary
  **$ALPHA** sale itself follows the same logic as a posted-price schedule: allocation declines
  with the buyer's existing position (**wealth-indexed primary issuance, §13.D**).
- **Fee-burn / buyback (symmetric, non-telegraphed).** Route captured value to holders/treasury:
  burn a fraction of fees ($ALPHA scarcity ↑) and/or buy back $ALPHA with treasury revenue. The
  treasury also **sells $ALPHA into a price spike** (symmetric stabilization), and runs these as
  **TWAP/gradual, non-telegraphed ops** so a cartel can't game predictable triggers (§13.B).
- **Commons donations (charity-for-status).** Players/guilds donate Credits or $ALPHA in exchange
  for **standing** (reputation tiers, titles, regalia — status, never power). A **voluntary
  Veblen sink with prosocial framing**: gift size drives status demand, draining whale wealth
  *by choice* alongside progressive demurrage — a policy-side **Gini lever** (the audit-2
  response to inequality control leaning on demand-mix assumptions). Donations are
  CAPTURE-tagged to the treasury and fund public **share-out events** (never direct cashable
  transfers); Bound Credits are donatable (a sink — allowed destination); standing is
  non-transferable. Fiction layer: `THEME-OUTFOX.md` §4 ("The Commons").

> **Rule:** sinks ≥ faucets in aggregate, but prefer **valuable** sinks (capture) over
> **dead** sinks (pure burn). Every sink is tagged in instrumentation by *efficacy* (§10).

---

## 3. Monetary + fiscal policy framing (run as central-bank-plus-treasury, by *rule*)

Operate with **pre-committed rules, not discretion** (discretion invites manipulation and
loss of player trust; rules are credible and auditable).

- **Monetary policy (manage M & V):** demurrage rate, $ALPHA staking yield, any
  convenience-funded injection schedule, fee levels. Inflation high → tighten (raise sinks /
  demurrage, cut injections); activity low → loosen.
- **Fiscal policy (manage demand & inequality):**
  - **Taxes / fees (sinks):** Market fee, transfer fee, Operation upkeep, PvP/Quarantine costs.
  - **Spending (stimulus):** event prize pools, syndicate-war rewards, buyback-burn.
  - **Redistribution:** progressive luxury pricing + targeted rewards to keep **Gini** bounded
    without flattening achievement.
- **Pre-committed rule set** (published to players for trust): e.g. "demurrage rate adjusts on
  a fixed schedule within band X–Y as a function of measured CPI," not "the team changes
  numbers whenever." Every rule is a tunable parameter in the Machinations model first.
- **Operator revenue (round-6 decision — pre-committed like everything else).** The operator
  is paid from the **fiat side only**; the in-game economy is never the profit source. Three
  channels, three different rules:
  1. **F4 primary token sales** — fiat receipts are 100% operator revenue. The model never
     books this money into the economy (only the token allocation is modeled, §13.D), so
     extraction is invisible to the validated economy *by construction*.
  2. **F3 convenience spend** — split by the published **operator-take rate**
     (`op_take_f3`, §12-swept). The retained share funds the game treasury (the §13.B
     market-defense ammunition). Round-6 validation: the rate has **zero dynamic effect
     anywhere in [0, 0.9]** — the §13.B ops bind on their own caps before the treasury
     balance ever binds, so the take only shrinks an unspent buffer (~97% of which is
     internally captured value anyway). The production rate is an owner decision inside
     that proven interval, published like every other rule (record: `sim/AUDIT-2.md`
     §8, incl. the condition under which the interval must be re-proven). One boundary
     caveat: real-money reserves for defending the *external* $ALPHA market (DEX
     liquidity) are outside the model — hold an operator-side reserve for that, sized
     at launch.
  3. **Boundary fees (cash-out) — operator revenue, split by a published rate.** The
     withdrawal fee + seasoning surcharge are charged in $ALPHA on value that is *already
     exiting* the economy, so the operator taking its share (`op_take_wdfee`, §12-swept)
     adds **zero counterfactual sell pressure** — this is the standard platform/exchange
     fee model. Round-6b validation: zero dynamic effect anywhere in **[0, 1.0]** (the
     $ALPHA treasury never binds F4 issuance or §13.B sell ops at current calibration;
     equivalence + probe in `sim/v6_wdfee_probe.txt`, re-prove condition recorded in
     `sim/AUDIT-2.md` §8b).
  4. **In-loop captured value — never.** Fees, demurrage, and the §13.D carry on value
     that *stays in the game* (Credits, or $ALPHA moving between in-game buckets) are money
     supply and policy ammunition; converting them to fiat means the operator trades
     against its own players. Treasury $ALPHA is likewise policy-only (§13.B ops, Commons
     share-outs), never operator profit. The boundary/in-loop line is the rule: **a fee
     is revenue only where real value was leaving anyway.**
  The distribution plan's commitments (revenue floor, growth pool) come out of the operator
  side, after this split.

---

## 4. Microfoundations (value & price)

- **Subjective theory of value (L&C ch. on value).** Players earn by **creating what others
  subjectively value** (items, services, Operation output) — *not* by labor-grind. This kills
  the "I grinded, therefore I'm *owed* a payout" ponzi logic that funds emission faucets.
- **Marginal utility.** Diminishing returns on repeated reward; **progressive luxury pricing**
  on status goods (each tier costs disproportionately more).
- **Supply & demand / price discovery.** The **Market** (order book) and **Exchange** use
  floating player-set prices — **never fixed prices**. The game sets *rules*, players set
  *prices*.
- **Comparative advantage (Ricardo).** Operation/profession **specialization** → gains from
  trade → a thick, interdependent economy → **raises Q** (real GDP), the denominator that lets
  M grow without inflation. Interdependence is a feature, designed-in.
- **Auction theory.** Rare **primary** sales by auction reveal true demand; **sealed-bid /
  Vickrey** formats resist bot sniping and discourage shill bidding.

---

## 5. Commons & integrity — Tragedy of the commons (Hardin)

Shared faucets/resources get over-extracted, especially by bots.

- **Enclosure:** private property — **Operations** and **Safehouses** turn open commons into
  owned, managed assets (owners self-regulate extraction).
- **Quotas / rate-limits:** **Compute / Nerve caps** and regen rates throttle per-account
  extraction (also the core pacing mechanic).
- **Congestion pricing:** costs rise on over-used shared actions/resources to self-balance load
  and deny bots cheap bulk extraction.

---

## 6. Behavioral layer (engagement + conversion) — **WITH guardrails**

These drive engagement and conversion; **all are bounded** because of the legal exposure (§8).

- **Variable-ratio reinforcement (Skinner)** on Exploits/loot — the engagement engine.
- **Loss aversion** — streaks, losable syndicate territory, downtime states.
- **Endowment effect** — **true ownership** of assets → attachment → *lowers* sell pressure
  (helps V control).
- **Anchoring + sunk cost** — reference pricing + sticky long-term progression.

> **GUARDRAIL (hard rule):** variable-ratio + loss aversion + a **cashable** token =
> gambling-law and predatory-design exposure. Therefore:
> 1. **Chance outcomes pay *Bound Credits* — a non-transferable, non-exchangeable, sink-only
>    balance — never $ALPHA and never transferable ("Clean") Credits.** The invariant is
>    **"no chance-origin unit may reach the cash-out gate."** Chance-won value can only be
>    *spent on sinks* (regen, fees, upkeep, treasury cosmetics); it can never be transferred to
>    another player nor swapped to $ALPHA. Provenance is **taint-tagged server-side** (§10) so the
>    separation is structural, not nominal — this closes the
>    chance→Credit→exchange→$ALPHA→cash-out path that the word "directly" alone left open.
> 2. **No real-money loot boxes / no paid randomized power.**
> 3. **Bound losses** — PvP/Exploit failure costs are capped; no total-wipeout.
> 4. **Get counsel before launch** (Phase-4 gate). See §8.

---

## 7. Two-currency mechanics (now theory-justified)

| Property | **Credits (¢)** — soft cash | **$ALPHA (Jetton)** — premium token |
|---|---|---|
| Role | Working medium | Store-of-value + premium **convenience, not power** |
| Source | **P2P transfer** (PvP, Market, Operations) + real-money convenience spend | Bought via **TON Connect** (TON) / earned via the floating exchange; **never emission-minted to players**, and **never via Telegram Stars** |
| Holding cost | **Demurrage** (Gesell) — decays if hoarded; progressive above a threshold | **Idle: decays** (≈ Credit rate, §13.A) · **Staked/locked: never pays the base rate**; the total position above the published per-identity shelter pays the progressive carry (§13.D) whatever the bucket — locking still strictly beats idle everywhere + convenience/status yield |
| Cashable? | **No** (internal only) | **Yes**, behind the §9 gate |
| Provenance | **Clean** (P2P / Operations / Market) = transferable + exchangeable to $ALPHA · **Bound** (chance: Exploit loot, PvP RNG) = **non-transferable, non-exchangeable, sink-only** (§6) | Single class; only **Clean Credits** can be swapped in |
| Velocity goal | Keep high (working money) | Keep alive but stable (use-driven, not dump-driven) |
| Throttle | Compute / Nerve gate the actions that earn it | n/a |

- **Earning is player-to-player and real-money-funded, not emission-funded** (the invariant).
- **Energy/nerve (Compute/Nerve)** act as both **throttle** and **sink** (paid refills).
- **Cash-out** ($ALPHA → real value) sits behind **identity gate + fees + vesting** (§9).

---

## 8. Legal/regulatory economics (design-level mitigations)

A cashable token + earning-as-draw + variable-ratio/loss-aversion can trigger **gambling,
securities, and money-transmission** law simultaneously. Economy-design mitigations:
- **Separate chance from real-money value** (§6 guardrail #1) — the single most important rule.
- **Floating, unpegged $ALPHA** and **separating the internal Exchange (fictional "stocks")
  from the real token** to limit securities characterization.
- **Cash-out gate** (PoP + KYC-capable + fees + vesting) addresses money-transmission/AML.
- **Bounded behavioral mechanics** (§6) reduce predatory-design exposure.
- **Counsel before launch** — these are mitigations, not legal advice; a real review is a
  Phase-4 gate (`PLAN.md` §6). See `VALIDATION-BENCHMARKS.md` §1 for the recommendation to pull
  a legal/MT scoping gate forward to Phase 0/1.

---

## 9. Cash-out boundary (where real value exits)

The **only** place internal value becomes real money. Designed as a controlled valve:

> **Provenance invariant (load-bearing):** only **Clean Credits** can be swapped to $ALPHA, and
> only $ALPHA can be withdrawn. **Bound (chance-origin) Credits never reach the exchange or this
> gate** (§6, §7) — so no chance-won value is ever cashable. Server-side taint tracking (§10)
> enforces this, and the §11 gate proves it holds under stress.

1. **Proof-of-personhood gate** — one-time, **only at cash-out** (all gameplay stays inside
   Telegram). Provider TBD (World ID / KYC vendor / TON HumanCode) — Phase-3 decision.
2. **Fees** — a withdrawal fee (sink + spam/sybil disincentive).
3. **Vesting / time-lock** — withdrawals vest over time (damps hot-potato dumping, smooths
   $ALPHA velocity, gives anti-fraud a window).
4. **On-chain settlement only at the edge** — deposits/withdrawals settle on TON; the hot-loop
   economy stays off-chain (server-authoritative) for cost/speed.

This valve is also a **sybil economic backstop**: even if bots farm Credits, value can't *exit*
without passing PoP + fees + vesting, capping multi-account extraction ROI.

---

## 10. Instrumentation (L&C "measuring virtual economies")

> **Architecture contract:** `DATA-ARCHITECTURE.md` (2026-07-11) — append-only economic
> events, an on-chain holder/DEX indexer, and live metrics computed with the **sim's own
> estimators**, so the gate criteria double as production SLOs (G11 by funding-graph
> proxy — the sim's ground-truth mule identity does not exist live) and measured
> behavior recalibrates the model.

Live dashboards, built from day one (they are acceptance criteria, not nice-to-haves):
- **M** — circulating Credits + liquid-$ALPHA equivalent.
- **V** — overall and per-currency velocity, vs target band.
- **P** — CPI over a fixed basket; inflation rate.
- **Q** — real in-game GDP (deflated transaction volume).
- **Gini** — wealth concentration, vs bound.
- **$ALPHA velocity** specifically.
- **Per-source faucet** volume (PvP, Market spread, Operations, convenience spend) and
  **per-sink** volume **tagged by efficacy** (value-capturing vs dead burn).
- **Sybil/bot rate** and cash-out flow (gated volume, fee take, vesting backlog).
- **Provenance / taint tracking** — every Credit carries a Clean/Bound origin tag; the dashboard
  proves **zero** Bound (chance-origin) value reaches the exchange or cash-out, and reports
  **real-value-exit concentration** (an *exit*-Gini over who actually withdraws), not just
  in-game Gini.

Every monetary/fiscal lever in §2–3 maps to a parameter, and every parameter maps to a metric
here — closing the control loop.

---

## 11. Validation — the Machinations gate (Phase 0 → Phase 1)

Before any economy code: model the **full MV=PQ system + $ALPHA flow** in
**[Machinations](https://machinations.io/tokenomics-design)** (Monte-Carlo) and stress it.

> **Build spec:** the runnable model — stocks, flows, agent archetypes, the Clean/Bound firewall,
> the $ALPHA token model, parameters with sweep ranges, scenario configs, and the gate scorecard —
> is specified in [`ECONOMY-SIM-SPEC.md`](./ECONOMY-SIM-SPEC.md). The exit criteria below are
> formalized there as G1–G12 with sourced thresholds.

**Stress scenarios (must all hold):**
- **Whale-inflow shock** — sudden large real-money buy-in.
- **Player-count plateau** — growth stops (the Axie/StepN killer: faucets keep running, demand
  doesn't).
- **Farmer / bot attack** — mass sybil extraction on shared faucets.
- **Gresham split** — Credits inflate while $ALPHA appreciates.
- **Pre-cashout funnel** — many bot accounts farm and funnel value via P2P transfer to one
  PoP-verified casher (the mule pattern that PoP-at-cash-out alone does not stop).

**Exit criteria (the gate — every one required):**
1. **Bounded inflation** — **P** stays stable across all scenarios.
2. **Velocity in band** — **V** stays inside target (no hoard, no dump), for both currencies.
3. **No Gresham hoard/dump split** — neither currency becomes the dominated "bad money."
4. **Value-accruing sinks** — sinks demonstrably *capture* value (efficacy > threshold), not
   merely burn.
5. **Bounded Gini** — wealth concentration within bounds under all scenarios; **exit-Gini**
   (real-value withdrawal concentration) also bounded.
6. **No chance-origin leakage** — flow-tracing proves **Bound (chance-won) Credits cannot reach
   the Credit↔$ALPHA exchange or the cash-out gate** under any scenario, including the
   **pre-cashout funnel**. (This is the §6/§9 provenance invariant, validated.)

> **No economy code ships until this model passes.** The same five criteria are then re-checked
> on **testnet** against the live §10 dashboards (`PLAN.md` Verification).

---

## 12. Open parameters (set during Machinations modeling)

Demurrage rate & exemption floor · Compute/Nerve caps & regen rates · Market/transfer/withdraw
fee schedule · $ALPHA staking yield curve · auction reserve/format params · vesting schedule ·
V target band · Gini bound · CPI basket composition · **idle-$ALPHA holding-cost rate (§13.A)** ·
**treasury-op TWAP window, no-op band & per-window cap (§13.B)** · **$ALPHA progressive-carry
shelter & rate (§13.D)** · **primary-issuance wealth index γ & scale (§13.D)** · **operator
take on F3 (§3)**. **All are model inputs first, code second.**

---

## 13. Adversarial hardening (red-team-driven decisions)

These two decisions come from the simulation red-team (see `ECONOMY-ROBUSTNESS.md` and
`sim/REDTEAM.md`), which found that the standard sink/faucet gate **passed** but two adversarial
attacks broke the economy. Both reduce to a design choice; the chosen design is stated here and
is itself a Machinations input (§12), not yet final-tuned.

### 13.A Flight-to-$ALPHA (the demurrage dodge) — decision

**Problem.** Credit is demurraged; $ALPHA has *no* holding cost; the exchange is free. That is an
inherent **Gresham trap**: rational actors flee the decaying Credit into the decay-free $ALPHA and
hoard it. The §2.2 claim that "demurrage ensures cash isn't a *superior* hoard" is false on its
own — **$ALPHA is the superior hoard.** A determined flight detaches the $ALPHA price (a naive flight
spiked it 20×; a finite treasury reserve cannot defend it).

**Options & trade-offs:**
| Option | Effect | Trade-off |
|---|---|---|
| (a) **Holding cost on *idle* (un-staked) $ALPHA; staked/locked $ALPHA exempt** | removes the dodge at its root — the only decay-free store becomes **locked** $ALPHA, which can't be dumped | contradicts "$ALPHA has no holding cost"; store-of-value now *requires* locking; needs careful rate |
| (b) $ALPHA-denominated sinks that force spending | drains hoards indirectly | doesn't remove the incentive; relies on compelling sinks |
| (c) Conversion throttle / progressive exchange fee on rapid Credit→$ALPHA | slows a flight burst | friction on legitimate users; misses slow accumulation |
| (d) Symmetric treasury op (sell $ALPHA into a spike) | leans against the spike | finite reserve; fails under a mania (already implemented as the market backstop) |

**Decision — layered, primary = (a).** Apply a **holding cost on idle liquid $ALPHA**, set ≈ the
Credit demurrage rate so neither liquid currency is a superior hoard; **staked/time-locked $ALPHA is
exempt** (locking *is* how you store value without decay — and locked $ALPHA can't fuel a dump).
This converts "hoard liquid $ALPHA" into "lock $ALPHA long-term," which is the *desired* behavior
(cuts sell pressure). Keep (d) as the market backstop and (b) as support. Net currency hierarchy:
**Credit (decays, working) ≈ idle $ALPHA (decays, no advantage) ≪ staked $ALPHA (exempt, locked).**
This closes the Gresham trap without a peg.

### 13.B Central-bank attack (pump-dump cartel) — decision

**Problem.** The treasury's stabilization ops fire on **fixed, telegraphed e-thresholds**
(buyback when e weak, sell when e strong). A cartel can deliberately push e past a trigger to
force the treasury to trade predictably, then trade against it — bleeding the reserve. It needs
~20%+ continuous, money-losing collusion to break the gate, but the mechanism is real (rule-based,
*predictable* market-making is gameable).

**Options & trade-offs:**
| Option | Effect | Trade-off |
|---|---|---|
| (a) **TWAP / gradual ops on a moving average of e** | no sharp trigger to game; smooths the response | slower to react to a genuine shock |
| (b) **Per-window op-size cap + wider no-op band** | the reserve can't be bled; ignores small manipulations | less firepower in a real crisis |
| (c) Randomised / non-telegraphed timing | unpredictable to the attacker | harder to reason about / audit |
| (d) Commit-reveal / batch-auction exchange | kills front-running outright | added protocol complexity |

**Decision — (a) + (b).** Replace threshold-triggered ops with **TWAP-style gradual operations
keyed to a moving average of e**, plus a **per-rolling-window cap on total treasury op size** and
a **wider no-op band**. This makes the treasury non-gameable (no predictable trigger, bounded
spend) while still leaning against *sustained* deviations — and, combined with the fact the attack
needs implausible sustained collusion, reduces it to impractical. (c)/(d) held in reserve if a
real cartel emerges.

### 13.C Cash-out seasoning + staking unbonding (audit-2 hardening)

- **Seasoning (replaces the provenance discount, which was AMM-washable):** ANY newly
  acquired $ALPHA — AMM buy, primary buy, transfer-in, unstake — is *unseasoned* and pays a
  withdrawal surcharge until it ages (~60d). Wash-proof by construction: every acquisition
  path resets the clock, and **time cannot be laundered**. A patient attacker who waits pays
  the §13.A idle decay instead. Sim result: extraction contained to **~0.45% per
  attacker-controlled verified identity** — the residual scales with verified identities, so
  the binding real-world defense is **PoP quality**, an explicit design conclusion.
- **Unbonding:** unstaking is a *request*; tokens sit locked, non-sellable, and decaying for
  an unbonding period before becoming liquid (and return *unseasoned*). "Locked can't dump"
  is now a mechanism, not a parameter. **On-chain caveat:** liquid-staking wrappers could
  reconstruct dumpable exposure — staking positions must be **non-transferable at the
  contract level**, and third-party wrapper markets remain a named residual risk.

### 13.D Whale-tail concentration (the oligarchic α) — decision

**Problem.** Under whale-dominant token demand (the `whale_market` red-team scenario), the
wealth **Gini** is policy-controlled (Commons sink) but the **Pareto tail stays oligarchic**
(Hill α ≈ 1.1 vs the G7 bar of ≥ 2). The verified diagnosis (sim audit round 5): every $ALPHA
*sink* — Veblen status goods, Commons donations, exchange sells, withdrawals — draws on
*liquid* $ALPHA only, and **staked** $ALPHA pays no holding cost at all (unbonding pays the §13.A
base rate), so the bulk of a large position sits sheltered; and the F4 primary-purchase
schedule is flat, so a whale's inflow is ~12–50× a mid-tier player's. Together these set
archetype wealth *plateaus* 4–7× apart, and the tail index reads that plateau gap. Two
structural facts follow: sinks and tolls on the *stock* alone cannot close the gap at
defensible rates (measured: α ≤ ~1.5 even at confiscatory settings), and the *inflow* gap
must be compressed at the source.

**Options & trade-offs:**
| Option | Effect | Trade-off / verdict |
|---|---|---|
| (a) Staked-only rent above an exemption | taxes the shelter directly | **rejected — magnitude-capped**: the rent must stay below the idle rate or staking stops dominating idle (breaks the §13.A Gresham closure); at that cap it moves the plateau ≤ ~10% |
| (b) **Progressive carry on the TOTAL $ALPHA position** (liquid+staked+unbonding) above a published per-identity shelter | closes the shelter loophole; unstaking cannot dodge it; rate ordering preserved at every hoard size | needs a companion inflow lever (stock-side alone measured at α ≤ ~1.5) |
| (c) Value-indexed shelter (threshold in ¢ at the TWAP anchor) | auto-tightens with price | **rejected — regime-sign error**: whale-demand scenarios run at *depressed* e, so the shelter widens exactly when bite is needed |
| (d) **Wealth-indexed primary issuance** (F4 allocation declines with the buyer's position) | compresses the inflow gap at the source; extracts willingness-to-pay to treasury | reshapes top-end holdings in normal play too (one parameter set, no scenario-conditional tuning) — accepted; suite-wide validation recorded in `sim/AUDIT-2.md` §7 |
| (e) Treasury share-out dividend (per-capita Bound credits) | lifts the tail's floor | **rejected as the tail lever**: standalone α ceiling ~1.2; re-opens the treasury-injection CPI channel `recycle_kp` was disabled for |

**Decision — (b) + (d), both live, both swept.**
- **Progressive $ALPHA carry (`alpha_prog_thresh` / `alpha_prog_rate`):** each identity's total
  $ALPHA position above a published shelter pays a daily carry on the excess, deducted
  staked-first, proceeds to the $ALPHA treasury (CAPTURE). The **staked exemption applies to
  the base rate only**: below the shelter staked $ALPHA still decays at 0; above it, staked
  pays the progressive component alone while idle pays base + progressive — **locking stays
  strictly cheaper than idle at every hoard size**, so §13.A's anti-dump lock and the
  Gresham closure survive intact. This is the $ALPHA twin of the accepted Credits progressive
  demurrage (`demurrage_prog_thresh/rate`), same schedule family and rate scale. The
  carry applies to the account's balances **regardless of play activity — dormancy is
  not a shelter** (same posture as §13.A's dormant decay); it is a server-ledger rule,
  not a login-gated one. *(Sim note: the model's pooled dormant bucket cannot carry
  per-identity thresholds, so the sim under-applies the carry to churned wallets — a
  conservative simplification recorded in `sim/AUDIT-2.md` §7; churn is exogenous
  in-model, so no in-sim strategy exploits it.)*
- **Wealth-indexed primary issuance (`alpha_primary_gamma` / `alpha_primary_href`):** the $ALPHA
  allocated per primary purchase declines with the buyer's existing position —
  `alloc = base · (1 + H/href)^−γ` — i.e. the **primary price rises with wealth**:
  second-degree price discrimination, the rule-based posted-price analogue of the §2.3
  auction prescription (Veblen-consistent: the top of the demand curve pays its
  willingness-to-pay). Unissued $ALPHA never leaves the treasury (more §13.B op ammunition);
  no bucket moves, so the ledger is untouched.

**Named residuals (honest bounds):**
1. **Identity-splitting bypasses BOTH levers at acquisition — the load-bearing residual.**
   A buyer who routes purchases through fresh identities gets the full primary allocation
   (a ~10–40× token advantage over a consolidated position at plateau) and keeps every
   wallet under the carry shelter; the in-game tolls (unstake toll on non-transferable
   staked positions, φ_transfer + seasoning reset, per-identity PoP at exit) bind only at
   *transfer, unstake, or cash-out* — **none binds on buy-and-hold**. Quantified bound:
   under full split evasion both levers are inert and the economy reverts to the v4
   record — corrected-metric α ≈ 1.0 (`sim/v5_calibration.txt`), i.e. **the G7 pass is
   conditional on per-identity measurement holding**. The binding defense is therefore
   **product-level purchase-identity binding**: primary $ALPHA purchase only through the
   PoP-linkable game identity, plus wallet-age/funding-graph clustering
   (`ROBINHOOD-FEASIBILITY.md` §2) — the same conclusion class as smart_sybil. Follow-up
   red-team (open queue): a *split-hoard* whale_market variant with identity-graph
   machinery, to price partial evasion rather than assume zero.
2. **The α gate partially measures the demand-mix assumption**: the Hill window (top 10%)
   is ~2× the whale population share, so a more extreme demand monopoly would re-break the
   gate. Launch instrumentation of the actual payer mix (§10) remains the real-world guard.
3. Player-facing fiction naming for the carry and the primary schedule → `THEME-OUTFOX.md`
   (a later vocabulary pass; mechanics are canon as of this section).

> All §13 decisions are **pre-committed rules** (§3) — published, auditable, parameterised —
> not discretionary interventions. They are added to the §12 sweep before any code.
