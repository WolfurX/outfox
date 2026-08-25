# Economy Simulation Spec — Outfox

> **Status:** Phase-0 build spec. This turns [`ECONOMY.md`](./ECONOMY.md) into a model that is
> **directly buildable and runnable**. It is the input to the **Phase-0 → Phase-1 gate**
> (`ECONOMY.md` §11, `PLAN.md` §2): no economy code ships until this model passes the §13 exit
> criteria. Thresholds and sources come from [`VALIDATION-BENCHMARKS.md`](./VALIDATION-BENCHMARKS.md) §2.
>
> **Scope note:** this spec also bakes in three fixes the validation pass surfaced — the
> Credits-only numéraire (`econ-M-unit-inconsistency`), demurrage's dual P-channel made explicit
> (`econ-demurrage-raises-P-contradiction`), and staking yield modeled as non-monetary so it
> isn't a hidden faucet (`econ-staking-convenience-yield-is-hidden-faucet`).

---

## 1. Purpose, tooling, and how it gates

**Purpose.** Prove, before implementation, that the Outfox economy holds under stress: bounded
inflation, velocity in band, no Gresham split, value-accruing sinks, bounded inequality, and —
the load-bearing Outfox-specific invariant — **zero chance-origin (Bound) value reaching cash-out**.

**Tooling layers (build in this order; each is a higher-fidelity check):**
1. **Machinations** (stock-and-flow, Monte-Carlo) — model the §3 stocks / §5–6 flows / §10 levers as a
   resource diagram. Fast iteration; validates faucet ≤ sink and nominal convergence per archetype.
   *(machinations.io/tokenomics-design)*
2. **cadCAD** (Python, agent-based Monte-Carlo) — port the same state-update equations (§9) for
   parameter **sweeps** and ensemble runs; find where the parameter space breaks. *(cadcad.org)*
3. **TokenSPICE / contract-in-the-loop** — run the actual TON Jetton + exchange + cash-out logic
   so farming/MEV/exploit paths surface against real contract behavior. *(github.com/tokenspice)*

**Discipline (Token Engineering Commons):** every parameter that ships to production must first pass
**model → validate → test → iterate** here. No hand-tuned production constants that weren't swept.

**Gate.** The model must clear §13 across **all** §12 scenarios in Machinations, then survive the
cadCAD sweep without a parameter region that violates a hard criterion, before Phase-1 economy code.

---

## 2. Model boundary & numéraire (resolves the M-unit issue)

- **Numéraire = Credits (¢).** MV=PQ is run **on the Credit economy only**: `M` is Credits in
  circulation, `P`/`Q`/`V` are Credit-denominated. This avoids importing exchange-rate noise into
  the inflation control loop (the `econ-M-unit-inconsistency` fix).
- **$ALPHA is tracked as a separate asset**, not folded into `M`: its own circulating supply, its own
  velocity `V_alpha`, and a floating **FX rate** `e = ¢ per $ALPHA` discovered on the exchange (§8).
- **Two sub-economies, one firewall:** the **Credit economy** (working medium, has faucets+sinks)
  and the **$ALPHA economy** (premium/store-of-value, purchase- and transfer-funded only, never
  emission-minted). The **only** legal bridge is `Clean Credits ⇄ $ALPHA` on the floating exchange.
  **Bound Credits can never cross** (§7).
- **Tick = 1 simulated day.** Horizon = **720 ticks (24 months)**. Monte-Carlo: **≥ 500 runs** per
  scenario for distributions, not point estimates.

---

## 3. State variables (stocks)

**Per-agent `i`:**
| Var | Meaning |
|---|---|
| `C_clean[i]` | Clean Credits (transferable, exchangeable to $ALPHA) |
| `C_bound[i]` | Bound Credits (chance-origin; non-transferable, non-exchangeable, sink-only) |
| `ALPHA_liquid[i]` | $ALPHA held, withdrawable/exchangeable |
| `ALPHA_staked[i]` | $ALPHA time-locked (out of circulation; earns non-monetary status yield) |
| `compute[i]`, `nerve[i]` | regenerating action resources (caps `Cmax`,`Nmax`) |
| `stats[i]` | Cracking/Latency/Hardening/Stealth aggregate (gates action success) |
| `inv_value[i]` | mark-to-market value of item inventory (Credit-denominated) |
| `pop_verified[i]` | bool — passed proof-of-personhood (only set if/when cashing out) |
| `spent_real[i]` | cumulative real money spent (convenience + $ALPHA buys) |
| `withdrawn[i]` | cumulative real value withdrawn (for ROI / extraction metrics) |

**Global:**
| Var | Meaning |
|---|---|
| `M = Σ (C_clean + C_bound)` | Credit money supply (the MV=PQ `M`) |
| `ALPHA_supply` | $ALPHA circulating (excludes staked, treasury, burned) |
| `ALPHA_max` | hard cap on $ALPHA ever issued (no inflation beyond cap) |
| `ALPHA_burned`, `ALPHA_treasury` | burned + treasury-held $ALPHA |
| `treasury_credits` | Credits captured by sinks (demurrage, fees, auctions) |
| `e` | exchange rate ¢/$ALPHA (floating, §8) |
| `reserve_alpha` | on-chain treasury $ALPHA backing off-chain liquid balances (proof-of-reserves, §8) |
| `N` | active population |

---

## 4. Agent archetypes (population mix)

Each agent samples an archetype at join; archetype sets behavioral parameters. **Default mix**
(sweep ±10pp): **Casual 55% · Grinder 20% · Trader 12% · Whale 5% · Bot/Sybil 8%**.

| Archetype | Behavior (drivers to model) | Key params |
|---|---|---|
| **Casual** | short daily sessions, spends Nerve on Exploits, light Market use, occasional convenience buy | low session count, low real-spend prob |
| **Grinder** | maximizes actions, trains stats, sells loot on Market — the primary Bound-Credit faucet driver | high action rate, high sink exposure |
| **Trader** | works Operations, arbitrages the Market & exchange — the main Clean-Credit/Q driver | high Market volume, holds $ALPHA |
| **Whale** | high real-money convenience + $ALPHA purchases, buys Veblen status goods | high real-spend, high $ALPHA buy |
| **Bot/Sybil** | multi-account, maximizes extraction, funnels via P2P to a cash-out mule | many accounts, funnel behavior, evades PoP until cash-out |

Behavioral responses to price/yield (elasticities) are themselves swept parameters — agents
hoard more when demurrage is low, dump $ALPHA when FX spikes, etc.

---

## 5. Faucets (value sources) — each throttled and instrumented

> **Invariant:** **$ALPHA is never a faucet to players.** Players only *buy* $ALPHA (real money) or
> *receive* it via the exchange (a transfer from a seller). Every faucet below is a **Credit**
> faucet or an external-money injection.

| ID | Faucet | Output | Throttle | Notes |
|---|---|---|---|---|
| **F1** | Exploit / PvP-RNG reward | **Bound Credits** + items | `nerve` cap + cooldown; success ∝ stats | The variable-ratio engine; **firewalled** (§7). Primary internal inflation source to absorb. |
| **F2** | Operation base output (NPC demand) | **Clean Credits** (small, capped) | `compute` cap + upkeep | Bootstrap liquidity faucet; keep small — most Clean Credits should be transfer-driven. |
| **F3** | Real-money convenience spend | external value → other players' earnings | real-spend propensity | Stars (non-cashable consumables) **and** the demand side that funds F2/Market. Transfer-funded core. |
| **F4** | $ALPHA purchase (TON Connect) | $ALPHA into circulation from treasury allocation, **capped by `ALPHA_max`** | — | External money in; **not** minted to players for play. Funds the exchange liquidity others draw on. |
| **F5** | PvP / Market spread | Credits **transferred** player→player | fees (sink) | Zero-sum among players (a transfer, not a mint) minus fees. |

**`net_credit_emission(t) = (F1 + F2 minted) − (all Credit sinks burned)`.** This is the headline
faucet:sink quantity. **F5 nets to zero** (transfer) and is excluded from emission.

---

## 6. Sinks (value capture) — tagged by efficacy

Efficacy tag: **CAPTURE** (value routed to treasury/holders, re-deployable) vs **BURN** (deleted) vs
**THROTTLE** (paces play). Prefer CAPTURE (`ECONOMY.md` §2.3).

| ID | Sink | Removes | Efficacy | Lever param |
|---|---|---|---|---|
| **S1** | Demurrage on Credits | Credits (both classes) → treasury | CAPTURE | `δ` per-day rate, exemption floor, Safehouse shelter cap |
| **S2** | Regen / refill purchases | Credits (or Stars) | THROTTLE | refill price curve |
| **S3** | Market & transfer fees | Clean Credits → treasury (part burned) | CAPTURE/BURN | `φ_market`, `φ_transfer`, burn share |
| **S4** | Operation upkeep | Clean Credits → treasury | CAPTURE | upkeep schedule |
| **S5** | Veblen status goods / auctions | Credits & $ALPHA → treasury | CAPTURE | progressive luxury price curve; Vickrey reserve |
| **S6** | Quarantine / PvP costs | Credits | THROTTLE | downtime/penalty params |
| **S7** | $ALPHA fee-burn / buyback-burn | $ALPHA → burned (scarcity↑) | BURN | burn fraction, buyback budget |
| **S8** | Withdrawal fee + vesting | $ALPHA → fee to treasury; time-lock | CAPTURE/THROTTLE | `φ_wd`, vesting curve, per-identity cap |

**Bound Credits are spendable ONLY on S1, S2, S5(treasury cosmetics), S6** — never S3/transfer,
never the exchange. This is the firewall in sink form.

**Demurrage dual-channel check (explicit):** demurrage simultaneously raises `V` (holding cost →
spend; **inflationary**) and shrinks `M` via the treasury capture/burn portion (**deflationary**).
The model must **report both channels** and verify the net is **deflationary at the chosen `δ`**
(i.e. the M-reduction dominates the V-induced price pressure). `δ` is swept to find the band where
this holds (closes `econ-demurrage-raises-P-contradiction`).

---

## 7. The Clean/Bound provenance firewall (the Outfox-specific invariant)

Every Credit unit carries an origin tag. Rules enforced in the model and asserted as a gate:
- **Bound Credits** (origin = F1 chance/PvP-RNG): `transferable=false`, `exchangeable=false`.
  Allowed destinations: S1, S2, S5(treasury), S6 only.
- **Clean Credits** (origin = F2/F5 transfer/work/market): fully transferable and exchangeable to $ALPHA.
- **No mixing that launders origin:** spending is **Bound-first** on eligible sinks (so Bound drains
  before Clean), and the exchange accepts **Clean only**. A unit's tag never flips.
- **Gate metric `chance_leakage(t)`** = (Bound-origin value that reached the exchange or cash-out) /
  (total cash-out value). **Must be identically 0** under all scenarios, including the §12 funnel.

> This is the structural answer to the critical finding: chance can be fun and generous (Bound
> Credits) without ever creating a cashable, gambling-law-exposed payout path.

---

## 8. $ALPHA token model

- **Supply:** fixed cap `ALPHA_max`; no emission to players. Sources into circulation = F4 (purchase)
  and exchange sells by holders. Sinks = S7 (burn), staking lock, treasury reclaim.
- **Floating exchange (`Clean Credits ⇄ $ALPHA`):** model as a **constant-product AMM** pool
  `(R_credit, R_alpha)` with `e = R_credit / R_alpha`, fee `φ_ex` (part burned). **Never pegged.** Price is
  endogenous — whale buys and farmer dumps move `e`, which is exactly the Gresham/whale-shock test.
  *(Alternative order-book impl is a sweep variant; AMM is the baseline for tractability.)*
- **Staking:** `ALPHA_staked` is time-locked, removed from `ALPHA_supply` (cuts sell pressure / lowers
  `V_alpha`). **Yield = non-monetary** (status tier, convenience access) by default — it mints **no**
  currency, so it is **not** a faucet. A `staking_yield_mode` flag can switch to a *capped, modeled
  $ALPHA injection from treasury* (never newly minted); if enabled it is instrumented as a faucet and
  must be covered by S7 burn (closes `econ-staking-convenience-yield-is-hidden-faucet`).
- **Cash-out gate (§9 of ECONOMY):** `ALPHA_liquid → real` only if `pop_verified`, through `φ_wd` +
  vesting + **per-identity / per-window withdrawal cap** `W_cap`. Bound Credits structurally cannot
  reach here (§7).
- **Proof-of-reserves invariant:** `reserve_alpha ≥ Σ ALPHA_liquid[i]` must hold every tick (off-chain
  balances fully backed). A breach is a hard model failure (custody solvency).

---

## 9. Per-tick update loop (the simulation core)

For each tick `t` (1 day):

1. **Population:** add `joins(t)` (scenario-driven), remove `churn(t)` (retention curve §12).
2. **Regen:** `compute,nerve += regen` (capped). 
3. **Agent actions** (per archetype policy): allocate Nerve→Exploits (F1→Bound Credits), Compute→
   Operations/training (F2→Clean Credits), Market trades (F5 transfer, S3 fee), exchange ops
   (Clean⇄$ALPHA, moves `e`), real-money buys (F3/F4), status/auction buys (S5), withdrawals (S8 if verified).
4. **Apply sinks:** demurrage S1 (both classes, Bound-first exemptions), fees S3/S4, burns S7, etc.
5. **Update $ALPHA:** AMM reserves, `e`, `ALPHA_supply`, `ALPHA_burned`, staking locks, vesting releases.
6. **Instrument (compute and log every tick):**
   - `M = Σ(C_clean+C_bound)`; `M_growth = ΔM/M` (also monthly-annualized).
   - `Q` = real Credit-deflated transaction volume (Market + Operations + transfers).
   - `P` (CPI) = price of a **fixed basket** (top tools, regen unit, representative item) in Credits;
     inflation = ΔP YoY.
   - `V = (Credit transaction volume) / M`.
   - `V_alpha = (annual $ALPHA volume) / ALPHA_supply`.
   - `Gini` over net worth `(C_clean+C_bound+ e·ALPHA_liquid + inv_value)`; **Pareto α** of the top tail.
   - `exit_Gini` over `withdrawn[i]` (who actually extracts real value).
   - `faucet:sink = (F1+F2 minted) / (Credit sinks burned)` and `net_credit_emission`.
   - `sink_efficacy` = CAPTURE share of total sinks.
   - `chance_leakage` (§7) — must be 0.
   - `sybil_extraction_share` = withdrawn value attributable to Bot/Sybil ÷ total withdrawn.
   - `reserve_ok` = `reserve_alpha ≥ Σ ALPHA_liquid`.
7. **Apply policy rules (§10)** for next tick based on measured metrics.

---

## 10. Levers / policy control loop (pre-committed rules, not discretion)

Each is a **rule** with swept parameters (`ECONOMY.md` §3):
- **Demurrage `δ`:** adjusts on a fixed schedule within `[δ_min, δ_max]` as a function of measured CPI
  (CPI high → `δ↑`). Net effect must stay deflationary (§6 check).
- **Fees `φ_*`:** Market/transfer/exchange/withdrawal fees; burn-share routes to S7.
- **Buyback-burn S7:** treasury spends a budgeted Credit share to buy & burn $ALPHA when `e` weak.
- **Withdrawal cap `W_cap`:** per-identity + per-rolling-window; progressive (larger withdrawals face
  steeper vesting) to blunt whale/sybil extraction.
- **Stimulus:** event prize pools / syndicate-war rewards funded **from treasury** (captured sinks),
  never from new emission.

---

## 11. Parameters (initial values → sweep ranges)

> All values are **starting estimates to be calibrated**, anchored where possible to real data
> (`VALIDATION-BENCHMARKS.md` §2.1). Sweep ranges are the cadCAD search space.

| Symbol | Meaning | Init | Sweep |
|---|---|---|---|
| `δ` | demurrage / day | 0.5% | 0.1%–2% |
| `Cmax,Nmax` | Compute/Nerve caps | 150 / 50 | ±50% |
| `regen` | resource regen/day | full in ~24h | 12–48h |
| `φ_market` | Market fee | 5% | 2%–10% |
| `φ_transfer` | P2P transfer fee | 3% | 1%–8% |
| `φ_ex` | exchange fee (burn share 50%) | 1% | 0.3%–3% |
| `φ_wd` | withdrawal fee | 5% | 2%–10% |
| `W_cap` | per-identity withdraw / week | capped | sweep incl. ∞ (control) |
| vesting | withdrawal vest period | 14 days | 0–60 days |
| `ALPHA_max` | $ALPHA hard cap | fixed | fixed |
| S7 burn frac | fee → burn | 50% | 0%–100% |
| sink target | monthly supply sunk | ~0.33%/mo (Catizen) | 0.1%–1% |
| basket | CPI basket composition | TBD | fixed per run |
| `staking_yield_mode` | non-monetary / capped-injection | non-monetary | both |
| archetype mix | population split (§4) | §4 default | ±10pp |
| elasticities | hoard/dump responses | mid | low/mid/high |

---

## 12. Stress scenarios (each: 24-month horizon, ≥500 Monte-Carlo runs)

| # | Scenario | Config | What it attacks |
|---|---|---|---|
| **0** | **Baseline** | steady joins, default mix | sanity — economy stable in calm conditions |
| **1** | **Whale-inflow shock** | large `F4` $ALPHA buy + status-good demand spike at t=90 | `e` spike, M/V shock, Gini/Pareto stress |
| **2** | **Player-count plateau** | `joins → 0` after t=180, faucets keep running | **the Axie/StepN killer** — net emission at zero growth |
| **3** | **Farmer / bot attack** | Bot/Sybil share → 30%, max extraction | commons over-extraction, faucet:sink, sybil leakage |
| **4** | **Gresham split** | force Credit inflation while $ALPHA appreciates | hoard/dump split; firewall + floating-FX defense |
| **5** | **Pre-cashout funnel** | many bots farm → P2P-funnel → 1 PoP-verified mule | mule pattern; `W_cap` + provenance + exit-Gini |

Retention curve driving `churn(t)` is itself gated (D1 ≥20%, D7 ≥10%; `VALIDATION-BENCHMARKS.md` §2.4)
and varied as a sensitivity, since retention drives demand `Q`.

---

## 13. Exit criteria — the gate (must pass ALL, across ALL §12 scenarios)

Hard pass/fail, thresholds + sources from `VALIDATION-BENCHMARKS.md` §2.1/§2.3:

| # | Criterion | Threshold | Source |
|---|---|---|---|
| G1 | **Faucet:sink** | **≤ 1.0** sustained | ChainPlay; Axie SLP post-mortem |
| G2 | **Net Credit emission at zero growth** (scenario 2) | **≤ 0** | BNB Sustainable GameFi; Naavik StepN |
| G3 | **Money-supply growth** | **≤ ~3%/mo**; no month **> 5%** | EVE MER |
| G4 | **CPI / inflation** | **−5% … +10% YoY** (gate both tails) | EVE MER |
| G5 | **Credit velocity** | no sustained >2–3 mo decline; in band | EVE MER; L&C |
| G6 | **$ALPHA velocity** | near reference band (`V≈20` order-of-magnitude) | Burniske / HackerNoon |
| G7 | **Wealth Gini** | **≤ 0.70** (red flag > 0.80); Pareto **α ≥ 2** | Fuchs et al. PLOS ONE |
| G8 | **Sink efficacy** | CAPTURE share **> threshold** (sinks accrue value, not just burn) | `ECONOMY.md` §2.3 |
| G9 | **No Gresham split** (scenario 4) | neither currency becomes dominated bad-money | L&C |
| G10 | **Chance-origin leakage** | **= 0** (all scenarios incl. funnel) | Outfox invariant (§7) |
| G11 | **Sybil extraction share** (scenarios 3,5) | **< 5%** (stretch < 1%) of cash-out value | Arbitrum 21.8% baseline |
| G12 | **Exit-Gini & proof-of-reserves** | exit-Gini bounded; `reserve_alpha ≥ Σ ALPHA_liquid` every tick | §8; validation §3 |

A run **fails the gate** if any criterion is breached in any scenario at the chosen parameter point.
The cadCAD sweep must additionally show a **non-empty, contiguous safe region** of parameter space
satisfying G1–G12 (robustness, not a knife-edge).

---

## 14. Outputs & reporting

Per scenario, emit time-series + distributions for every §9 metric, plus a one-page **gate
scorecard** (G1–G12 pass/fail with the worst-case value and the tick it occurred). cadCAD sweeps
emit the **safe-region map** over the §11 parameters. These feed the live testnet dashboards
(`ECONOMY.md` §10) so the same instruments validate sim → testnet → production.

---

## 15. Build milestones

1. **M0 — Machinations baseline:** stocks/flows/levers for scenario 0; confirm faucet:sink ≤ 1 and
   stable P at the init params.
2. **M1 — Firewall + token:** add Clean/Bound tagging (§7) and the $ALPHA AMM/staking/cash-out (§8);
   confirm G10 = 0 and proof-of-reserves holds.
3. **M2 — All scenarios:** run §12 scenarios 1–5; tune levers to clear §13.
4. **M3 — cadCAD port:** replicate §9 equations; sweep §11; produce the safe-region map.
5. **M4 — TokenSPICE:** contract-in-the-loop for the exchange + cash-out + Jetton; re-check G10/G11/G12
   against real contract behavior.
6. **Gate review:** scorecard green across all scenarios → unlock Phase-1 economy code.

---

## 16. Open modeling questions

- CPI basket composition (which goods, what weights) — fixes `P`, must be set before runs.
- AMM vs order-book for the exchange (baseline AMM; order-book as a sweep variant).
- Should Exploits also pay a small **Clean** base wage (deterministic) on top of Bound loot, to keep
  the core loop economically meaningful without breaking the firewall? (Lean: yes, small, capped.)
- Real-money demand elasticity — the weakest-grounded input; flag for early playtest calibration.
- Bot/Sybil behavioral realism — coordinate with the sybil red-team plan (`PLAN.md` Phase 3).
