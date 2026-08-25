# Audit round 2 — independent verification of the v2 remediation

An independent 17-agent verification workflow re-checked the v2 engine: (a) every original
audit finding re-verified against the code **with injected-fault tests**, (b) a fresh-eyes
code hunt, (c) a thorough economics-fundamentals review, (d) skeptical adjudication of every
new finding. This file is the honest record: what's confirmed fixed, what round 2 found, what
was fixed immediately, and the open queue with planned responses.

## 1. Remediation verdict: ALL original findings genuinely fixed (verified)

Every v1 finding was re-verified by code reading **and empirical tests**, including
detection-power proofs: an injected mid-tick Bound siphon tripped G10 (leak=806.5 → FAIL);
injected $VIG and Credit destruction tripped G12. Conservation residuals: **~4e-9 $VIG /
~1e-7 ¢ across all 11 scenarios**. Mules verifiably cash out (G11 is live); staking, vesting,
transfer fee, upkeep all real; G6/G7/G8 empirically shown failable.

## 2. Round-2 findings — fixed in this session

| Sev | Finding | Fix |
|---|---|---|
| HIGH | **Hill α estimator inflated by +1** (true tail index 1.2 reported as 2.2 — the G7 oligarchy check was near-unfailable; the exact defect class v2 claimed to eliminate) | `+1` removed; corrected mature α = **2.59**, still ≥ 2 — the retail-mix calibration survives the honest estimator |
| HIGH | **G1 passed only via churn wipe-outs** (~10% of sink volume was involuntary balance destruction; designed sinks alone ran 1.06–1.09 > 1) | **Dormant-credit pool**: churned balances persist (as in reality) and decay to treasury via demurrage — a *designed* sink now captures them over time. Designed-only faucet:sink = **0.984**, capture share = 100% |
| LOW | Provenance-surcharge denominator double-counted (`balance + amt`), understating the anti-mule fee by up to ~33% | Denominator corrected to the true pre-debit balance |
| LOW | Exchange buy-leg fee excluded from sink accounting | Counted (captured) |
| LOW | Sweep OAT omitted the calibrated `demurrage_prog_rate`, printing a false "calibrated OUTSIDE" | Value added |

## 3. Round-2 findings — queue status after the round-3 implementation pass

**RESOLVED:** AMM-wash evasion → **seasoning** implemented (ECONOMY §13.C; wash-capable
smart_sybil now exercises it; residual quantified at ~0.45%/verified identity — 12 mules =
5.4%, at the 5% line; binding defense identified as PoP quality). Staked-corner "lock" →
**real unbonding period** implemented (locked, decaying, non-sellable; wrapper risk documented
in §13.C). Unfunded AMM depth → pool now **protocol-funded in-ledger at realistic depth**
(3M¢/30k, swept via amm_depth_mult). Return-inelastic demand → **procyclical demand
elasticity** implemented + **confidence_crisis scenario**: a 60-day demand collapse + 3×
panic selling **does not self-reinforce** — e recovers to baseline (the death spiral is
broken by TWAP ops/burns/sinks). Gini lever → **Commons sink** implemented; under
whale-dominant demand (whale_market scenario) it moves Gini 0.86 → **0.69 (passes)**, BUT the
**Pareto tail stays oligarchic (α≈1.2)** — an honest residual: median concentration is
policy-controllable, tail concentration under whale-only demand is not (yet). G5/velocity →
V now includes Market trade volume (collapse-detectable); CPI itself still M/Q-based —
basket CPI (§16) remains the real fix. Event-anchored G3/G4 windows implemented (bank_run/
whale_shock measured AT the event). exit-Gini churn history preserved; smart_sybil dead tag
now drives the wash behavior.

**REMAINING OPEN:** basket CPI (§16); demurrage-magnitude precedent sweep + item hoard
vehicle; whale-market tail (α) lever; §13-parameter full sweep re-run at the new defaults.

### Original queue (for the record)

**HIGH — Provenance surcharge is evadable via AMM wash.** Taint doesn't survive the exchange:
sell tainted $VIG → transfer Credits → rebuy → withdraw "clean" costs ~7% (fees+slippage) vs
the 30% surcharge; the 3.7% headline holds only because the simulated attacker uses the taxed
path. *Planned response:* **seasoning** (holding-period-based surcharge — recently *acquired*
$VIG pays the surcharge regardless of source; time can't be washed), plus an upgraded
wash-capable smart-sybil scenario to verify. Design decision for ECONOMY §9.

**HIGH — §13.A creates a staked-corner equilibrium.** ~87% of player $VIG ends up staked;
price discovery, Veblen sinks, and exchange volume run on a thin liquid sliver — and
"locked can't dump" currently rests on an assumed `unstake_prob`, not a lock mechanism; on
chain, liquid-staking wrappers could void it entirely. *Planned response:* model a real
unbonding period; sweep `stake/unstake` rates; ECONOMY §13.A addendum on wrapper risk
(non-transferable staking positions as a contract constraint).

**HIGH — The "level-based CPI" is not full MV=PQ.** V is dropped (velocity-driven inflation is
invisible to the controller), Q is issuance rather than real transacted output, and the
controller stabilizes its own metric. *Planned response:* broaden Q to real transaction volume
(Market + Operations), reintroduce measured V into the price proxy, and keep the basket-CPI
(spec §16) as the real fix. Affects G3/G4/G5 readings → requires re-validation when done.

**MEDIUM — G5 can't detect a trading collapse** (V proxy excludes Market/exchange volume).
Same root as above; fix together.

**HIGH — Exogenous, unfunded AMM depth is load-bearing.** The 10M¢/100k-$VIG pool (~9× the
end-state money supply) is owned by no one and funds every "absorbed by slippage" verdict.
*Planned response:* model protocol-owned liquidity funded from treasury (bootstrapped, its
credits inside the ledger), and add pool depth to the sweep. Expect several robustness
margins to shrink honestly.

**HIGH — Gini is assumption-controlled, not policy-controlled.** The G7 pass rests on the
retail payer-mix demand assumption; the advertised redistribution levers demonstrably could
not hold Gini under whale-dominant demand. *Planned response:* sweep the payer mix as a
first-class axis; add a whale-dominant-demand scenario to the standard suite; and implement
the **Commons donation sink** (charity-for-status — a voluntary, whale-biased Veblen sink now
specced in ECONOMY.md §2.3 / THEME-OUTFOX.md §4) as the new policy-side Gini lever; acceptance =
measurable Gini improvement under whale-dominant demand at equal faucet:sink.

**MEDIUM — $VIG demand is return-inelastic in the model** while the token has negative carry
and a drifting price — the actual GameFi death spiral (price↓ → demand↓ → price↓) is outside
the model class. *Planned response:* demand-elasticity coupling (procyclical F4/F3) + a
death-spiral scenario. This is the single most important realism upgrade left.

**MEDIUM — Demurrage magnitude (~70–80%/yr) is far beyond precedent** (Wörgl ~5–12%/yr), and
the predictable hoard-migration to items/commodity-money is unobservable because items are
descoped. *Planned response:* sweep `delta` down an order of magnitude to find the minimum
effective rate; un-descope a minimal item/inventory hoard vehicle before trusting the
"no flight-to-items" conclusion.

**MEDIUM — Two-tier diagnostic windows.** bank_run's G3/G4 diagnostic is measured 4 months
*after* the attack (hiding persistent post-attack deflation), while whale_shock's event never
enters the window. *Planned response:* event-anchored measurement windows for event scenarios.

**LOW — w_cap "passes" exit-Gini by rationing everyone** (inverts the metric's intent);
**LOW — §13-era parameters (idle decay, stake rates, Veblen constants, surcharge) never
swept**; **LOW — exit-Gini per-slot erasure on recycling; smart_sybil's dead `adversary` tag.**
*Planned:* fold into the next sweep + metric pass.

## 4. What this round changes about the confidence claim

The engine's **accounting is now verified trustworthy** (independently, with injected faults),
and the corrected gates survive their own correction (α, G1-designed). But round 2's economics
findings mean the **robustness verdicts are conditional on modeling assumptions** that are now
explicitly named: AMM depth, payer mix, return-inelastic demand, unswept §13 constants, and a
CPI proxy blind to velocity. The honest status is: *validated structure, named conditions,
open queue* — not "proven safe." Round 3 = the queue above, then the cadCAD port (M3) and the
basket CPI (§16).

## 5. Round-3 full-seed validation addendum (2026-07-02)

The round-3 engine was validated at the spec's full seed counts (500 standard /
100 red-team — `v3_500.txt`, `v3_redteam_100.txt`). Outcome against this document's queue:

- **Standard gate: ALL 6 scenarios pass, every criterion ≥95%** — including plateau G3 at
  97% (v2's documented 86% exception is resolved by the round-3 changes).
- **Stale smoke logs:** the interim 8-seed `v3_all.txt`/`v3_redteam.txt` scorecards
  (plateau G3 88%, demurrage_flight G2 88%) were generated by a pre-final engine state
  and are deleted; the committed engine reproduces neither failure.
- **§3 REMAINING-OPEN item "whale-market tail (α) lever" — now formally measured:**
  whale_market fails G7's α leg at 100 seeds (α = 1.16 < 2; Gini 0.694 passes). Open.
- **Seasoning residual — measured at the line, lands over it:** smart_sybil G11 median
  5.32% vs the <5% bar (the predicted ~0.45% × 12 mules ≈ 5.4%). Binding defense is PoP
  quality (`bot_pass_rate`), as §3 anticipated. Open (product-level, not sim-level).
- **NEW findings from honest finite AMM depth** (the unfunded-depth HIGH fix biting):
  **pump_dump now genuinely breaks** (G1 9% / G2 0% with tail net emission +3006¢/tick
  median / G9 0%) — cartel dump legs push pool Credits back into player supply; and
  **bank_run transiently breaches the G9 price floor** (recovers: final e ≈ 0.83×e0,
  G5/G12 100%). v2's red-team passes were partly flattered by exogenous depth.
  *Queue addition:* spec + simulate the §13.B reserve defenses ((c) randomized op
  timing, (d) commit-reveal/batch-auction exchange) and a pool-depth/treasury-defense
  policy, then re-judge both scenarios.
- **§3 "§13-era parameters never swept" — closed:** `sweep.py` now sweeps the six
  round-3/§13-era levers (idle-decay multiplier, seasoning days, unbonding days, stake
  propensity, Veblen burn split, Commons probability) with zero-points, at the new
  defaults (`sweep_v3.txt`/`sweep_v3.json`).

Still open after this round: basket CPI (§16), demurrage-magnitude precedent sweep +
item hoard vehicle, whale-tail α lever, the new §13.B market-defense work above, and the
cadCAD port (M3).

## 6. Round-4: §13.B market defenses (2026-07-03)

The two market-manipulation red-team failures from §5 (pump_dump G1/G2/G9; bank_run G9)
are **closed** by activating three `ECONOMY.md` §13.B reserve options as implemented,
swept mechanics — the round-3 findings had graduated them from "held in reserve" to
required work.

**Implemented (all swept §12 params, all robust in `sweep_v4`):**
- `ex_flow_cap` — §13.B(d) batch-auction proxy: per-tick net exchange flow per side is
  capped at a fraction of that side's pool reserve and filled pro-rata; unfilled flow
  re-queues on later ticks. Bounds per-tick price impact (the G9 fix) without walling
  off exit — a dump becomes an orderly multi-tick book, not a blocked order.
- `vol_fee_k` / `vol_fee_mult_max` — volatility-scaled exchange fee: `phi_ex` escalates
  with sustained fast-vs-slow price deviation beyond the no-op band (capped). A cycling
  cartel pays rising tolls on every leg, restoring the Credit-side sink pump_dump's tail
  emission was starving; calm trade stays at the 1× multiplier.
- `twap_jitter` — §13.B(c) randomized op timing: a random share of treasury-op ticks is
  skipped (EMAs and window bookkeeping still update), so a pump/dump cannot phase-lock
  against the treasury cadence.

**Result (full seeds):** standard 6/6 unchanged; red-team pump_dump PASS
(G1 100% / G2 −6597 / G9 100%) and bank_run PASS (G9 100%; recovers, G5/G12 100%).
Red-team suite 4/7 → 5/7. The market-manipulation class is closed.

**Still open after round 4 (both non-market, both pre-existing on this queue):**
1. **smart_sybil G11** (median 5.39% vs <5%) — the seasoning residual at scale; binding
   defense is **PoP quality** (`bot_pass_rate`), a product-level decision, not sim work.
2. **whale_market G7 α-leg** (α≈1.13) — §3 REMAINING-OPEN item #3, the whale-tail
   concentration lever under whale-only demand. Median Gini is policy-controlled (Commons
   sink); the tail is not yet. *(Closed in round 5, §7 below.)*

Also still open (unchanged): basket CPI (§16), demurrage-magnitude precedent sweep +
item hoard vehicle, the cadCAD port (M3).

## 7. Round-5: the whale-tail lever (§13.D) + honest-measurement fix (2026-07-11)

§3 REMAINING-OPEN item #3 — the whale_market G7 α-leg — is **closed**. The design ran the
house discipline: a 7-agent verification-and-design workflow (1 adversarial code-level
diagnosis verification, 3 independent designers, 3 adversarial judges with distinct
lenses), then empirical calibration on the engine before anything was adopted.

**The verified diagnosis first overturned the working hypothesis.** The naive story
("staked hoards compound unboundedly") is wrong: staking yields nothing and whale hoards
SATURATE (whales cycle their full stake through the liquid drain gauntlet at 6%/day via
`status_unstake_mult`; equilibrium hoard ≈ inflow/effective-drain ≈ 4,000–4,400 $VIG,
~58-day time constant — whales are paradoxically the *least* sheltered archetype). The
real cause of α ≈ 1.1 is an **archetype plateau-gap mixture**: every $VIG *sink* draws on
liquid only and staked $VIG pays no holding cost at all (unbonding pays the §13.A base
rate), and the flat F4 primary schedule gives whales 12–50× the inflow of mid-tier players — setting archetype wealth plateaus 4–7× apart, which the Hill
estimator reads as an oligarchic tail because its top-10% window is ~2× the 5% whale
share (x_min anchors in the non-whale shoulder). Two measured negative results shaped the
decision and are kept for the record: (a) a **flat** staked toll *widens* the gap (the
shoulder is more sheltered than whales — 82–92% vs 61% staked); (b) stock-side levers
alone top out at **α ≈ 1.5 even at confiscatory settings** (post-hoc compression screen +
live grid) — the inflow gap must be compressed at the source.

**Adopted (ECONOMY.md §13.D, both swept; zero-points verified bit-identical to v4 in
full engine state AND RNG bit-generator state over 720 ticks across 5 scenarios —
independent review check; only the intentionally-corrected metrics differ. The one
refactored path, F4's treasury-exhaustion pro-rata branch, can differ from v4 by 1 ulp
and never fired in any verification run — minimum observed treasury 334k $VIG):**
- `vig_prog_thresh`/`vig_prog_rate` — progressive carry on the TOTAL $VIG position
  (liquid+staked+unbonding) above a per-identity shelter, deducted staked-first, proceeds
  to the $VIG treasury. Staked pays only the progressive component; idle pays base +
  progressive — locking stays strictly cheaper at every hoard size (§13.A ordering
  survives by construction).
- `vig_primary_gamma`/`vig_primary_href` — wealth-indexed primary issuance: F4 allocation
  = base·(1+H/href)^−γ. Rejected alternatives (staked-only rent: magnitude-capped by the
  Gresham ordering; value-indexed shelter: regime-sign error — whale_market runs at
  *depressed* e; treasury share-out dividend: α ceiling ~1.2 + the disabled-recycle CPI
  trap) are documented in §13.D's options table.

**Honest-measurement fix shipped with the round:** `networth` and `vig_circ` had excluded
`VIG_unbonding` — ~25% of a mature whale's position was invisible to Gini/α/velocity
every tick. Including it made the gate HARDER (the true v4 whale_market α was **1.02**,
not the reported 1.13; Gini 0.72, not 0.695). The round-5 calibration was run against the
corrected metric.

**Results (red-team 100 seeds):** whale_market **PASS at 100%** — α median **2.80**
(bar ≥ 2), Gini **0.653** (bar ≤ 0.70). The calibration grid (recorded in
`v5_calibration.txt`) shows a wide passing region — G7=100% at 8 seeds across the tested
box γ∈[2,3] × href∈[500,1000] × thresh∈[250,500] × rate∈[0.03,0.045] **except its
gentlest corner** (γ=2, href=1000, thresh=500: 50% at rate=0.03, 88% at rate=0.045) —
and the v5 OAT sweep straddles every default on both sides. The chosen default sits well
inside the region (100% at 8, 32, and 100 seeds).
Collateral: whale_market e ends at ~65¢/$VIG vs ~25¢ in v4 — throttled top-end issuance
removes structural sell pressure. No regressions: demurrage_flight, bank_run,
floor_split, pump_dump, confidence_crisis all PASS unchanged. **smart_sybil G11 moved
5.39% → 6.07% — a denominator composition effect, decomposed honestly:** absolute mule
extraction FELL 14% (416k → 359k¢; mules pay the carry like everyone), but honest
cash-out volume fell 23% (the F4 throttle shrinks honest $VIG acquisition), so the
*ratio* rose. The §3 conclusion stands: the binding defense is PoP quality
(`bot_pass_rate`), product-level, not sim machinery.

**Named residuals (per §13.D; sharpened by the round-5 adversarial review):**
(1) **Identity-splitting bypasses both levers at acquisition** — fresh identities get the
full primary allocation (~10–40× the consolidated rate at plateau) and stay under the
carry shelter, and the in-game tolls bind only at transfer/unstake/exit, never on
buy-and-hold; no sim scenario can expose it (bots have `vigbuy_prob=0`). Quantified
bound: full evasion ⇒ both levers inert ⇒ the v4 record (corrected-metric α ≈ 1.0). The
G7 pass is **conditional on per-identity measurement**; the binding defense is
product-level purchase-identity binding + funding-graph clustering. Split-hoard
whale_market variant with identity-graph machinery = open-queue red-team work.
(2) The α gate partially measures the demand-mix assumption (Hill window 2× whale share)
— a more extreme demand monopoly would re-break it; launch payer-mix instrumentation
remains the real-world guard.
(3) The sim's pooled dormant bucket cannot carry per-identity thresholds, so churned
wallets pay only the base §13.A decay — a conservative under-application of the §13.D
carry (production applies it regardless of activity; ECONOMY.md §13.D now says so).
Churn is exogenous in-model, so no in-sim strategy exploits the gap.
Metric note: `exit_gini`/G12 and conservation were already unbonding-aware; only the
wealth/velocity metrics changed. F4 accounting note: `spent_real` (a stat, gate-inert)
charges the wealth-indexed price e/fac on delivered tokens, matching §13.D's
price-discrimination language; at γ=0 it equals the v4 accounting on every branch.

**Standard suite (the formal gate) at 500 seeds: ALL 6 SCENARIOS PASS, every criterion
≥ 95%** on the corrected metric — plateau G3 at 99% as in v4; Gini medians *improve*
~0.07 suite-wide (baseline 0.594 → 0.525, funnel 0.674 → 0.595: the levers compress
top-end holdings in normal play, as §13.D row (d) accepts); funnel G11 1.02% → 1.24%
(the same denominator composition effect as smart_sybil, far under the 5% bar); G6
velocity essentially unchanged. Scorecards: `v5_500.txt` / `results_v5_500.json`.

**Sweep at the v5 defaults (`sweep_v5.txt`): all 21 levers robust, zero knife-edges** —
the four §13.D levers pass at every swept point on the standard subset including their
zero-points (not gate-load-bearing there, by design; the red-team delta is the
evidence), and `stake_prob=0.7` — the G7 concentration corner that failed in v3/v4 —
now passes: the carry closes the staked-shelter concentration it exposed.

**Still open after round 5:** smart_sybil G11 (PoP quality — the only red-team failure,
suite now 6/7); the split-hoard whale_market variant (residual 1 above); basket CPI
(§16); demurrage-magnitude precedent sweep + item hoard vehicle; the cadCAD port (M3);
THEME-OUTFOX naming pass for the §13.D mechanics.

## 8. Round-6: operator revenue — the F3 take rate is not gate-binding (2026-07-11)

**Question (owner):** how does the operator take profit without disturbing the economy?
The design answer is ECONOMY §3's new operator-revenue rule (three channels: F4 fiat =
100% extractable by model construction; F3 fiat = split by a published take rate;
in-game captured value = never). The empirical question was the F3 rate: the sim books
F3's ¢-value into `treasury_credits`, which funds the §13.B TWAP defenses — how much can
be diverted before the red-team suite breaks?

**Mechanism (`op_take_f3`, swept):** the diverted share of F3 never enters the ledger —
only the retained share is booked as external inflow, so Credit conservation stays exact
with no new buckets. Default **0.0 = bit-identical to the v5 record** (float ×1.0, no
RNG change), preserving artifact integrity; the production rate is an owner decision
inside the validated interval, published per §3.

**Finding — stronger than "not gate-binding": the take has ZERO dynamic effect in
[0, 0.9].** The adversarial review of this round refuted the first-draft
"monotone-harm, test-the-endpoint" argument (per-gate harm need not be monotone once
trajectories diverge) and replaced it with a constancy proof: an equivalence check
(recorded in `v6_optake_probe.txt`; 6 scenarios × 3 seeds, take 0.9 vs 0.0) shows every
final-row metric **bit-identical except the treasury balance itself**. Mechanism: the
§13.B ops bind on their per-tick / rolling-window caps before the treasury balance ever
binds — `min(tick_cap, cap_left, treasury_credits)` never selects the treasury — so the
diversion changes an unspent buffer, not behavior. Certification: treasury(t) is
pointwise decreasing in the take, so if it never binds at 0.9 it never binds at any
interior rate; **every take in [0, 0.9] replays the v5 record exactly** (100-seed
scorecards at take=0.9 came out byte-identical to the v5 artifacts, which are therefore
the record for the whole interval — no separate scorecards kept). Corroborating scale:
cumulative F3 ≈ **5.5M¢ ≈ 2.9%** of the ~191M¢ baseline treasury; internal capture
(demurrage, fees, bound spend — ¢-side; the §13.D carry accrues to the *$VIG* treasury)
funds ~97% of the ¢ ammunition. Probe scorecards (8 seeds, all 7 red-team scenarios at
take ∈ {0, .25, .5, .75, .9}): all pass at every rate, smart_sybil G11 at its known
level. Boundary of the claim: if a future recalibration ever makes the treasury the
binding term of a §13.B op, the interval must be re-proven — the constancy argument, not
an endpoint test, is what certifies it.

**Named model boundary:** the sim's treasury is game-ledger money; real-money reserves
for defending the *external* $VIG market (DEX liquidity) are outside the model class —
ECONOMY §3 directs an operator-side reserve for that, sized at launch (ties to the
protocol-owned-liquidity discussion in §3 REMAINING-OPEN history).

### 8b. Round-6b: boundary fees (cash-out) as operator revenue (2026-07-11)

Owner follow-up: "crypto platforms take fees as revenue." Correct — with the line drawn
at the real-value boundary (now ECONOMY §3 channels 3/4): the withdrawal fee + seasoning
surcharge are charged on value already exiting, so diverting the operator's share adds
zero counterfactual sell pressure; in-loop fees remain fiscal. Mechanism
(`op_take_wdfee`): the diverted $VIG is booked to `VIG_exited` at the valve —
conservation-exact, default 0 = the v5 engine. Unlike F3, this one *could* bind
(VIG_treasury caps F4 issuance and funds the §13.B sell leg), so the equivalence check
was the decisive test: **take=1.0 vs 0.0 is bit-identical on every final-row metric
except the absorbing buckets** (baseline/whale_market/bank_run × 3 seeds), and the gate
probe passes all 10 scenarios at take ∈ {0, .5, 1.0} (`v6_wdfee_probe.txt`). The ~1.97M
$VIG treasury dwarfs cumulative exit-fee inflow, so neither the F4 cap nor a sell op
ever selects it within the horizon. **Proven interval [0, 1.0]**; re-prove condition: a
future calibration where VIG_treasury becomes the binding term of F4 issuance or a
§13.B sell op.

## 9. Queue entry: the external open market (round-7 scope, 2026-07-11)

The external DEX venue is a **named model boundary**: the sim's speculation scenarios
stress the *internal* exchange, and external chaos reaches the game only through the
deposit/withdraw valve (withdrawals: w_cap/PoP/vesting/seasoning; deposit-fed selling:
the same §13.B flow cap + volatility fee that closed bank_run/pump_dump). Two assessment
probes (`v6_extdump_probe.txt`; the first was review-corrected — its dump saturated the
flow cap on only ~15% of ticks): (A) a **permanent 20%-of-holders self-funded dump**
ends e at 12.8¢ (−87%); (B) the honest worst case, a **permanent cap-pinned dump** (the
entire external float recycled through the valve at the flow-cap rate) ends e at
**3.0¢ (−97%)** — and in both, **every playability-load-bearing gate (G1, G2, G5, G8,
G10, G12) stays green at 100%** while only the token price band (G9) breaks. The
role-separation firewall decouples playability from price, as designed.

## 10. M4 contract-in-the-loop — a bound the model does not credit (2026-07-11)

Full record: `M4-CONTRACT-LOOP.md`. The real contracts + the real server valve were driven
on a time-warped local EVM and G10/G12 re-checked green against observed behaviour (PoR
holds at every intermediate step; chance-origin Scrip provably cannot reach the valve —
the only writer of an ALPHA balance is a confirmed on-chain deposit).

**Two findings that bear on the sim's open queue:**

1. **The deployed `Settlement` enforces a GLOBAL rolling withdrawal cap (leaky bucket)
   that the model has no representation for.** The sim throttles extraction *per identity*
   only (`w_cap`), which is why its G11 analysis is pessimistic about identity-splitting by
   construction. Verified live: once the rolling cap is spent, **even a validly signed
   voucher is refused, regardless of which identity presents it**; the cap refills linearly
   (no boundary burst). So split-identity extraction is bounded by
   **min(k · w_cap_weekly, windowCap_daily · 7)** — sizing `windowCap` near real daily
   withdrawal volume caps *aggregate* sybil throughput independently of PoP quality. It
   does not replace PoP (which governs *who* may exit) but it bounds *how much* can exit
   per unit time. **Queue item: model the global cap and re-judge `smart_sybil` (G11) and
   the §13.D split-hoard variant with it** — both currently assume no such ceiling exists.
   *(Executed 2026-08-15 — §11: the cap is modeled; the smart_sybil re-judge shows it
   never binds the ring at production sizing and cannot move the G11 share; the
   split-hoard variant remains queued.)*
2. **Round-trip extraction through the real valve is priced: −45%** (5% fee + 40%
   unseasoned surcharge). Fast in-and-out is *strictly value-destroying*, so a mule ring
   must wait out the 60-day seasoning — during which §13.A idle decay applies. This
   confirms, on real code, the containment the sim credits §13.C with.

**Scope limit (honest):** the spec's M4 covers "the exchange + cash-out". There is **no
Scrip⇄ALPHA exchange in the build yet**, so the farm→cash-out channel that `funnel` /
`smart_sybil` assume does not physically exist today; only the *valve* half of M4 is
verified. G11's full re-check waits on the exchange module.

**Round-7 scope (build with the server⇄Settlement integration, when the valve constants
and deposit plumbing are real):** an external-venue red-team scenario — external price
process (jump/bubble paths), arbitrageur agents trading the internal/external gap
through the valve, deposit plumbing (VIG_exited re-entry), **endogenous churn coupled to
realized earnings value** (the morale channel the probes cannot see), and an
external-reference-price variant (the DEX leads, the internal exchange follows).
**Acceptance: the standard red-team survival set (G1, G2, G5, G7–G12 strict; G3/G4
diagnostic), with ONE documented extension of the two-tier rule: G9 is reclassified as
diagnostic on permanent-exodus *crash* paths only (the engine's own design note — no
economy holds price against a permanent exodus) and stays strict on mania/bubble paths,
where the price<3× arm is exactly what §13.B was validated to hold.** The POL depth
decision (ECONOMY §3 boundary caveat) gets a swept parameter.

## 11. The global cap modeled — smart_sybil re-judged at scale (2026-08-15)

The §10 queue item is executed: `wd_global_cap` models the deployed Settlement's global
rolling withdrawal cap (leaky bucket → per-tick release budget at this model's daily
granularity), binding at RELEASE exactly as the contract does — FIFO over the vesting
queue, a voucher too big for the remaining window waits for refill while smaller later
ones pass, deferred value stays in escrow (delayed, never voided) and keeps bearing
price risk. Default 0 = off. Artifact: `v6_globalcap_redteam.txt`
(`probe_globalcap.py`, 100 seeds/cell, defaults).

**Regression is exact.** The (12 mules, cap off) cell reproduces the committed
`v5_redteam_100.txt` smart_sybil scorecard **to the cent** (G11 median 6.07%, realized
cash-out 5,920,168¢, same seeds) — the cap-off engine is the v5 engine. *(Numbering
note: §3's "12 mules = 5.4%" was the round-3 measurement; the judged v5 artifact reads
6.07% and is the baseline this round reproduces.)*

**Sizing (contract guidance: "near real daily volume").** Honest mature release,
baseline scenario, 25 seeds: median 75.2, p95 147.4 $VIG/day → candidate caps 147
(1× p95) and 294 (2×) per day.

| mules | cap/day | G11 med | bot cash-out ¢ | escrow end | other fails |
|---|---|---|---|---|---|
| 12 | off | 6.07% | 357,690 | 832 | — |
| 12 | 147 | 6.07% | 357,712 | 832 | — |
| 50 | off / 147 | 10.71% | 655,910 | 844 | — |
| 200 | off / 147 / 294 | 17.33% | 1,680,339 | 882 | G1 60%, G2 100% of seeds |

**Findings (the §10 hypothesis is refuted for the share metric, and the refutation is
the useful result):**

1. **The cap never binds the modeled ring, at any k.** The ring is
   **acquisition-bound, not exit-bound**: realized mule exit at k=200 is ~28 $VIG/day —
   ~2% of its own per-identity ceiling (200·58/7 ≈ 1,657/day) and ~19% of the 1×-p95
   cap. Funnel inflow (bot farming, AMM flow caps, fees, the seasoning surcharge)
   limits extraction long before either throughput ceiling is reached.
2. **No throughput cap is a G11 defense — now proven for the full cap stack.** G11 is
   a *share*; even a binding global cap defers sybil and honest exit in the same FIFO,
   leaving the ratio fixed. This extends the v2 lesson ("per-identity withdrawal caps
   are not a sybil defense") to the global cap at any defensible sizing. **The binding
   G11 defense remains PoP quality** — unconditionally, since the last non-PoP lever is
   now measured at zero effect.
3. **Scaling record:** G11 = 6.07 / 10.71 / 17.33% at k = 12 / 50 / 200 — sub-linear
   (mule cash-outs crowd the denominator too). At k=200 the attack additionally breaks
   G1 (60% of seeds) and G2 (100%): a ring that size is a visible macro attack on the
   faucet:sink economy, not a stealth extraction — the standard gate sees it.
4. **windowCap's real role is unchanged from §10:** catastrophic-event insurance. It
   bounds value-at-risk per unit time against exactly the behaviors this model's mules
   do not exhibit (burst-exit of a whole hoard into one window; a stolen signer), and
   at 1×-p95 sizing its honest-player friction is **zero** (escrow end identical to
   cap-off in every cell). Size it near honest p95 daily volume; do not expect G11
   movement from it.

**Still queued:** the §13.D split-hoard whale_market variant (needs its own scenario —
the carve is about sheltering wealth, not exit throughput); burst-exit mule variant if
the cap's insurance margin ever needs quantifying in-model.
