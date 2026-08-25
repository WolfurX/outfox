# Outfox — Economy Robustness Report (compiled)

> **SUPERSEDED — v1-era numbers, do not cite.** This report compiles results produced
> by the **v1 gate layer**, which the `ROBINHOOD-FEASIBILITY.md` §1 audit later found
> compromised (vacuous G10/G11, broken $ALPHA conservation, unfailable G6/G8) — sim/README
> line: *"v1's '12/12 pass' results are void."* Specific stale claims herein: the
> "OVERALL: ALL SCENARIOS PASS" scorecard (18 runs, v1 gates), G11 "<0.15%" (real v2
> figure after the fix: ~3.7%), the "w_cap ≤ ~80 must stay tight" sweep bound (v2 finding
> #5 reversed its direction), and §4b's "mitigation not yet implemented" (implemented and
> tested in v2). **Current status lives in `../sim/README.md` (v2/v3 engines, full-seed
> scorecards `v2_500.txt` / `v3_500.txt` and red-team equivalents) and `../sim/AUDIT-2.md`
> (open queue).** This document remains useful for its methodology narrative, the
> red-team attack taxonomy, and §5–§6's caveats/recommendations — which still stand.

> Capstone compilation of the Phase-0 economic validation: the build spec
> ([`ECONOMY-SIM-SPEC.md`](./ECONOMY-SIM-SPEC.md)), the Monte-Carlo simulation
> ([`/sim`](../sim/)), the M3 parameter sweep, and the adversarial red-team. Read this for the
> verdict; read `/sim/README.md` and `/sim/REDTEAM.md` for the detail.
>
> **One-line verdict:** the *structure* is sound and survives every stress test and four of six
> targeted attacks; the two surviving vulnerabilities are bounded, mitigated, and reduce to
> explicit design decisions — but the make-or-break question (sustained real-money demand) is
> **empirical and unproven by any simulation.**

---

## 1. How the economy was validated (three layers)

| Layer | What it does | Artifact |
|---|---|---|
| **Gate** | 12 pass/fail criteria (G1–G12) from the benchmark bands, across 6 stress scenarios | `sim/run.py`, `sim/gate.py` |
| **Sweep (M3)** | maps the *safe region* of parameter space around the calibrated point | `sim/sweep.py`, `sim/sweep.json` |
| **Red-team** | adversarial agents that attack the specific mechanics to *break* it | `sim/REDTEAM.md` |

Model caveats apply throughout (reduced-form CPI, assumed elasticities, archetype agents) —
see §5. These are directional results, not guarantees.

---

## 2. Standard gate — PASS

**`OVERALL: ALL SCENARIOS PASS`** — all twelve G1–G12 criteria pass (≥95% of Monte-Carlo runs)
across **baseline, whale_shock, plateau, bot_attack, gresham, funnel** (18 runs each, 24-month
horizon). The two Outfox-critical invariants are perfect everywhere:

- **G10 — chance-origin (Bound) value reaching cash-out = 0** in every run (structural firewall).
- **G11 — sybil cash-out share < 0.15%** even under a 30% bot attack and the mule funnel.

What hardened it: the **§10 adaptive monetary policy** (demurrage as a feedback controller —
loosen on deflation, tighten on inflation). It fixed the v0 deflation that appeared whenever
growth stalled. (Two findings folded in: a bursty treasury *recycle* made things worse via the
multiplicative-CPI volatility bias, so it's disabled; and inflation is measured as a
*steady-state* metric in the mature window, not across the inherently-expansionary growth ramp.)

---

## 3. Parameter sweep (M3) — the passing point is a wide basin, not a knife-edge

7 of 8 levers pass across their **entire** swept range; the calibrated value sits inside a
multi-point safe interval on **all 8**. The 2-D faucet/sink map (`delta × f2_cap`) is entirely
safe. The **one actionable bound**: the per-identity withdrawal cap must stay tight
(`w_cap ≤ ~80`) — a loose cap lets real-value cash-out concentrate and breaks exit-Gini (G12).

Notably, **`bot_pass_rate` passes even at a 10% PoP false-accept** — the anti-sybil design is
robust to a *weak* gate, because the per-identity cap + one-shot gate contain it. (Full table in
`sim/README.md`.)

---

## 4. Red-team — 6 attacks: 4 robust, 2 bounded vulnerabilities

| Attack | Verdict |
|---|---|
| **Bank run** (60% coordinated $ALPHA dump) | **ROBUST** — AMM depth + buyback-burn absorb it |
| **Smart sybil** (12-mule funnel under the cap) | **ROBUST** — one-shot PoP gate blocks bot-mules; real extraction negligible |
| **Floor split** (sybil micro-accounts dodge demurrage) | **ROBUST** — demurrage isn't the only sink; controller compensates |
| **Firewall wash-trade** (launder Bound→cashable) | **ROBUST by construction** — no code path moves Bound; G10=0 always |
| **Demurrage flight** (flee Credit → demurrage-free $ALPHA) | **VULNERABILITY — mitigated** |
| **Pump-dump cartel** (game the treasury triggers) | **VULNERABILITY — high-threshold** |

**Both vulnerabilities share a signature:** the *naive* attacker breaks the gate but **punishes
itself** via AMM slippage/fees; the *rational/feasible* version is contained. But each is a real
design surface:

### 4a. Flight-to-$ALPHA (the demurrage dodge)
Two currencies — Credit (decays) and $ALPHA (doesn't) — with a free exchange is an inherent
Gresham setup. A naive flight spiked $ALPHA **20×**; a rational, price-aware flight is contained at
~2.3× e0 (in band). **Mitigation applied:** symmetric treasury op — the treasury now *sells*
$ALPHA into a spike (mirroring buyback-burn on dips), no regression. **Residual / design decision:**
a finite reserve can't stop a *mania-driven, price-insensitive* flight; the clean root-cause fix
is a **holding cost on idle $ALPHA** (store-of-value via staking/locking) — contradicts the current
"$ALPHA has no holding cost" choice, so it's a team decision.

### 4b. Central-bank attack (pump-dump cartel)
Telegraphed, threshold-triggered treasury ops are gameable. Severity scales with cartel size:
10% → contained (+1.5%), 20% → edge (+9.6%), 30% → breaks (+29% inflation). Needs **~20%+
continuous, money-losing collusion**. **Mitigation (not yet implemented):** non-telegraphed /
TWAP treasury ops, wider no-op band, per-window op-size caps.

---

## 5. What no simulation settled (the honest limits)

1. **Sustained real-money demand is assumed, not proven.** Transfer-funded means someone must
   keep paying in for others to earn. The sim *assumes* this; it cannot create it. **This is the
   make-or-break risk** and it is behavioral/empirical.
2. **Reduced-form CPI.** No emergent basket price from a goods market — the single biggest open
   modelling item (spec §16). Treat all inflation numbers as directional.
3. **Agents are 5 archetypes with assumed elasticities.** Real players are more creative; the
   red-team only covers the attacks we thought of.
4. **Legal/regulatory** is untouched by the sim and remains the sharpest *unmitigated* risk
   (see `VALIDATION-BENCHMARKS.md` — the cash-out boundary critical).
5. **Calibration circularity.** The model, the criteria, and the parameters were authored
   together; "passes the gate" is partly "tuned to pass." The sweep + red-team partly offset this
   by testing *robustness* and *breakage*, not just the happy path.

---

## 6. Verdict & recommended next steps

**Is the economy robust enough?** The **bones are sound and unusually well-tested for Phase 0**:
transfer-funded (not emission-funded), a structural chance→cash firewall, sybil-resistance robust
even to a weak gate, and a wide safe parameter basin. It survives plateaus, whale shocks, bank
runs, and sybil funnels. That puts it ahead of the ~93% of GameFi that dies of emission-funded
collapse.

**But "robust enough to bet real money on" — not yet, and a sim can't get you there.** Two
bounded vulnerabilities reduce to explicit `ECONOMY.md` design decisions, and the binding
assumption (real-money demand) is empirical.

**Recommended, in priority order:**
1. **Take two `ECONOMY.md` design decisions:** (a) holding cost on idle $ALPHA (flight), (b)
   non-telegraphed/TWAP treasury ops (cartel). I can draft both with trade-offs.
2. **Legal scoping** of the cash-out boundary (the real unmitigated critical).
3. **Better price model + more red-team** (RMT arbitrage, market-corner, oracle manipulation).
4. **The one that actually settles it:** a **closed testnet with real humans** and the live
   M/V/P/Q/Gini + taint dashboards. The transfer-funded bet is behavioral; only real players
   resolve it.
