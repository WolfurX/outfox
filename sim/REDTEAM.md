# Red-team — adversarial attacks on the MEMPOOL economy

> **v2 CORRECTION (read first).** The independent code audit (`docs/ROBINHOOD-FEASIBILITY.md`
> §1) showed that several v1 verdicts below were **vacuous**: the smart-sybil "ROBUST" verdict
> passed because mules could never PoP-verify (extraction was structurally impossible, so the
> defenses were never tested), and G10 read a constant. The v1 narrative is kept below for the
> record; the **v2 results with real gates** are in the "v2 re-run" section at the end — including
> the honest finding that the 12-mule attack DID beat the original defenses (5.4–5.5% extraction)
> until the spec's provenance-discount surcharge was implemented.

Honest attempt to **break** the economy (not confirm it passes). Adversarial agents attack
MEMPOOL's *specific* mechanics, run against the **calibrated params** via `run.py --scenario
redteam`. The point is to find genuine vulnerabilities — and one real one surfaced.

## Attacks and verdicts

| Attack | What it does | Verdict |
|---|---|---|
| **bank_run** | 60% of holders dump ~all $VIG simultaneously at t=420 (the StepN death-spiral) | **ROBUST** — AMM depth + buyback-burn absorb it; e ends near e0, reserves backed, gate passes |
| **smart_sybil** | 30% bots run a 12-mule funnel, splitting extraction to slip under the per-identity cap | **ROBUST** — the **one-shot PoP gate** blocks bot-mules regardless of funnel cleverness; total real extraction ≈700¢ (negligible). The cap is secondary; PoP-pass is the real defense |
| **floor_split** | 50% spread holdings across sybil micro-accounts under the demurrage floor, escaping the velocity sink | **ROBUST** — demurrage isn't the only sink (bound-spend/clean-sink/fees dominate) and the adaptive controller compensates; gate passes |
| **firewall wash-trade** | colluders try to launder Bound (chance-origin) Credits into transferable/cashable value | **ROBUST by construction** — no code path moves Bound into transfer/exchange/withdrawal; G10 = 0 in every run of every scenario |
| **demurrage_flight** | 50% flee the demurraged Credit into the **demurrage-free $VIG** and hoard it | **VULNERABILITY (mitigated)** — see below |
| **pump_dump** | a cartel cycles pump/dump to drain the treasury's threshold-triggered stabilization ops | **VULNERABILITY (high-threshold)** — see below |

## The real finding: demurrage-driven flight to $VIG

**Root cause.** Two currencies — Credit (demurraged) and $VIG (no holding cost) — with a free
floating exchange is an inherent Gresham setup: rational actors hold the asset that doesn't
decay. The design's stated defenses ("demurrage so cash isn't a superior hoard", "$VIG-
denominated sinks") proved **insufficient** against a determined flight.

**Naive worst case (price-insensitive bot):** $VIG price spiked **20× (e: 100 → 2053)**,
triggering the exact Gresham hoard/dump split the design claims to prevent (G9 fail), plus
inflationary faucet:sink (G1/G2) and wealth concentration (G7). A finite treasury $VIG reserve
**cannot** defend the price here — it sells out in ~13 ticks, then the price runs away. *You
cannot defend a token price with a finite reserve against unbounded demand.*

**Realistic case (rational, price-aware flight):** a real hoarder stops fleeing once $VIG is
pumped — the AMM **slippage** makes converting more a terrible deal (you'd pay 20× to hoard).
With that single dose of rationality, the attack is **contained**: e settles at ~2.3× e0
(inside the G9 band) and the gate **passes**. The 20× spike was largely an artifact of an
*irrational* adversary punishing itself.

## The fix added (defends the residual, design-consistent)

**Symmetric treasury market operation.** The treasury already did buyback-burn to defend $VIG
price *collapse*; it now also **sells $VIG from the cap into a price spike** (`sell_e_trigger`,
`sell_budget_frac`) — the central-bank "lean against the wind" on *both* sides. The $VIG is sold
*for Credits* (a market op within `VIG_max`, not emission). This caps residual spikes; combined
with AMM slippage it holds a rational flight inside the band. **No regression** — all six
standard scenarios still pass with it active.

## Honest residual risk (what the sim still can't settle)

- The fix is a **finite-reserve** defense. A sufficiently large, *coordinated, price-insensitive*
  flight (irrational, or motivated by something other than hoarding ROI — e.g. a speculative
  mania or an attack to grief the economy) can still exhaust the reserve and detach $VIG. The
  AMM slippage is the deeper backstop, but a mania can override rationality.
- The deeper, design-level options if this risk is unacceptable (not yet implemented — these are
  recommendations for `ECONOMY.md`):
  1. **Holding cost on *idle* $VIG, exempt when staked/locked.** Removes the demurrage-dodge
     incentive at its root; the store-of-value role then requires *locking* $VIG (which also cuts
     dump risk). This contradicts the current "$VIG has no holding cost" choice — that choice is
     precisely what creates the vulnerability.
  2. **Strong $VIG-denominated sinks** that force hoarders to spend (drain the hoard).
  3. **Conversion throttle / progressive exchange fee** on large/rapid Credit→$VIG flow.

## The second finding: central-bank attack (pump-dump cartel)

**What it is.** A cartel cycles between pumping $VIG (driving e above the treasury's
`sell_e_trigger`) and dumping it (driving e below `buyback_e_trigger`), to **game the
treasury's threshold-triggered stabilization** — buy the $VIG the treasury is forced to sell
cheap, sell into the price the buyback supports.

**Severity is threshold-dependent (cartel size):**

| Cartel | Mature inflation | e (end) | Verdict |
|---|---|---|---|
| 10% | +1.5% | 2.4× e0 | contained (in band) |
| 20% | +9.6% | 3.0× e0 | at the edge |
| 30% | +28.8% | 2.8× e0 | **breaks** (G1/G3/G4/G9) |

So it needs **~20%+ of the playerbase in continuous, coordinated collusion** to break the gate —
and the naive cartel **loses money every cycle** to slippage + exchange fees (self-punishing), so
a rational cartel would only sustain it if it can reliably profit by gaming the triggers.

**Why it works at scale:** rule-based, *telegraphed* treasury ops (fixed e-thresholds) are
exploitable — the attacker knows exactly when the treasury will trade. **Mitigations (not yet
implemented — `ECONOMY.md` design notes):** non-telegraphed / randomised op timing, **TWAP-style
gradual** ops instead of threshold triggers, a wider no-op band, and per-window caps on treasury
op size so it can't be bled.

## Bottom line

Six attack classes tested. **Four are robust** (bank run, multi-mule sybil, demurrage-floor
split, Bound-firewall wash-trade). **Two are real but bounded vulnerabilities**, and both share a
signature: the *naive* attacker breaks the gate but **punishes itself** (pays massive slippage),
while the *rational/feasible* version is contained — yet the underlying mechanism is a genuine
design surface:

1. **Flight-to-$VIG** (demurrage dodge) — mitigated by AMM slippage + the new symmetric treasury
   op; clean root-cause fix is a holding cost on idle $VIG (store-of-value via staking).
2. **Central-bank attack** (pump-dump cartel) — needs ~20%+ coordinated collusion; mitigation is
   non-telegraphed / TWAP treasury ops with per-window caps.

Both are `ECONOMY.md` design decisions for the team, not silent sim tweaks. The lesson: the
standard gate alone would have missed both — only adversarial testing surfaces them.

---

# v2 re-run — real gates, honest verdicts (post-audit engine)

The v2 engine (exact conservation ledgers, PoP-verified mules, real Bound-leak detection,
staking/vesting/transfer-fee implemented, §13.A idle decay + §13.B TWAP ops live) changes the
red-team picture materially. Two-tier gate: survival criteria (G1, G2, G5, G7–G12) strict;
peacetime-stability criteria (G3/G4) reported as under-attack diagnostics.

| Attack | v1 verdict | v2 verdict (real gates) |
|---|---|---|
| **demurrage_flight** | vuln→mitigated | **PASS (survival)** — §13.A removes the dodge at the root: fleeing into *liquid* $VIG no longer escapes demurrage at all; e stays in band. Diagnostic: mature M/Q wobble ~7%/mo during a permanent 50% mania. |
| **bank_run** (now a 30-day panic, not a permanent exodus) | "ROBUST" (weak test: no vesting existed) | **PASS (survival)** — with a real vesting queue and TWAP absorption, e troughs then recovers to ~0.4×e0; ledgers hold; Gini fine. Diagnostics show the panic's transient deflation (−6.6%) — the recovery signature. |
| **smart_sybil** (12 PoP-verified mules) | "ROBUST" — **vacuous** (mules couldn't verify) | **FAILED FIRST, then fixed.** Real test: 5.4–5.5% of cash-out value extracted (> 5% bar). Tightening `w_cap` made it WORSE (caps bind honest whales harder than distributed mules). The **provenance-discount surcharge** on transferred-in $VIG (ECONOMY §9) is the designed lever that works: **3.7% ✓**. |
| **floor_split** | ROBUST | **PASS 12/12** — no diagnostics even triggered. |
| **pump_dump** (30% cartel) | vuln (CPI break) | **PASS (survival)** — §13.B TWAP + window caps stop treasury bleed; the level-based CPI no longer ratchets. Diagnostic kept honest: the cartel still imposes ~0.86/mo M/Q swings — a 30% coordinated capital-cycling cartel makes short-run monetary noise no policy can smooth; the economy survives it (all survival criteria hold). |

**Net lessons v2 added:**
1. **Per-identity withdrawal caps are not a sybil defense** — they tax honest concentration
   harder than distributed mule extraction. Provenance discounting is the working lever.
2. **§13.A (idle decay) is the real flight fix** — the symmetric treasury op is now just a
   backstop instead of the load-bearing defense.
3. **A "bank run" must be modeled as a panic window**, not a permanent every-tick exodus — no
   economy holds price against a majority permanently exiting (conservation, not design).
4. The remaining honest exposure is **short-run monetary volatility during large coordinated
   attacks** (G3/G4 diagnostics) — visible, bounded, and survivable, but real.
