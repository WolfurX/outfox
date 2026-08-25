# Outfox — economy Monte-Carlo simulation (v5 — round-5, §13.D whale-tail levers)

> **Vocabulary note (2026-08-25).** The sim code and living docs now use the unified
> Outfox vocabulary ($ALPHA; `tail_alpha` = the Pareto tail index). The committed
> result records below (`v*.txt`, `results_*.json`, `sweep_*`, `AUDIT-2.md`,
> `REDTEAM.md`, `M4-CONTRACT-LOOP.md`) predate the rename and keep the retired
> names ($VIG, MEMPOOL) — they are immutable evidence, not drift. Rename purity was
> proven on 2026-08-25 by an identical-seed A/B run (standard 24 seeds + red-team 12
> seeds, full horizon): results identical to the last digit modulo the name map.

An agent-based Monte-Carlo model of the Outfox economy, implementing
[`docs/ECONOMY-SIM-SPEC.md`](../docs/ECONOMY-SIM-SPEC.md) plus the
[`docs/ECONOMY.md`](../docs/ECONOMY.md) §13 adversarial-hardening decisions. It runs the
**Phase-0 → Phase-1 gate**: the economy is stress-tested against the **G1–G12 exit
criteria** (sourced thresholds: [`docs/VALIDATION-BENCHMARKS.md`](../docs/VALIDATION-BENCHMARKS.md) §2)
*before* any economy code is written.

> **v2 in one line:** an independent audit (see `docs/ROBINHOOD-FEASIBILITY.md` §1) found the
> v1 gate layer could not fail — v2 rebuilt the engine around **exact conservation ledgers and
> genuinely failable gates**, implemented every stubbed mechanism, and re-calibrated honestly.
> v1's "12/12 pass" results are void; v2's results below are the real ones.

## Files
- `simulation.py` — the engine: state (§3), archetypes (§4), faucets (§5), sinks (§6),
  the Clean/Bound firewall (§7), the $ALPHA AMM/staking/vesting/cash-out model (§8), the
  per-tick loop + MV=PQ instrumentation (§9), policy levers (§10), §13.A idle-decay,
  §13.B TWAP treasury ops, §13.D progressive carry + wealth-indexed primary issuance.
  Parameters (§11) in `DEFAULT_PARAMS`.
- `gate.py` — the G1–G12 criteria, all failable (see "What v2 fixed").
- `run.py` — Monte-Carlo driver (`--procs` multiprocessing) + scorecard.
- `sweep.py` — OAT sensitivity + 2-D safe-region sweep (5-scenario stress subset incl. funnel).

## Run it
```bash
pip install numpy
cd sim
python3 run.py --scenario all --runs 500 --ticks 720 --procs 4   # the validation run
python3 run.py --scenario redteam --runs 100 --procs 4           # adversarial suite
python3 run.py --scenario baseline --runs 8 --procs 4            # quick check
python3 sweep.py                                                  # safe-region sweep
```
Scorecard: per criterion, **pass-rate** across seeds + **median value**. `OK ≥95%`,
`~ 50–95%`, `XX <50%`, `DG` = diagnostic (see two-tier gate below).

## What v2 fixed (every audit finding, verified)

**Ledgers & accounting (the big ones):**
- **Exact $ALPHA conservation**, asserted every tick: `liquid + staked + dormant + AMM pool +
  escrow + treasury + burned + exited == ALPHA_max`. Residual = **0.0000** (v1 silently
  destroyed ~794k of the 2M cap). Churned players' $ALPHA goes **dormant** (still owned on-chain),
  not deleted; exchange fees are taken once, on the correct side; no phantom burns.
- **Exact Credit conservation**: `minted + external-inflow == held + treasury-captured +
  pool-delta + destroyed`, asserted every tick. (Finding the F3 external-inflow hole was v2's
  own catch, beyond the audit.)
- **Symmetric faucet/sink accounting**: join grants and the gresham forcing count as mints;
  churn exits count as dead sinks; upkeep S4, both exchange-fee legs, and the P2P transfer fee
  are real, captured, and tagged (CAPTURE vs dead) for G8.

**Gates that can actually fail now:**
- **G10** reads a per-tick **Bound-Credit ledger**: any unexplained Bound outflow (a
  firewall leak introduced by any future code) accumulates and fails the gate. (v1: constant 0.)
- **G11** is a real test: funnel **mules are PoP-verified** (spec §12.5) and re-designated on
  churn; honest players verify in funnel scenarios, so sybil share has a real denominator; the
  absolute-value escape hatch is gone. (v1: extraction was structurally impossible, so the
  defenses were never tested.)
- **G12** = ledger integrity (both conservation residuals ~0 every tick) + exit-Gini. In-sim
  "proof of reserves" *is* conservation; on-chain PoR is an M4 contract property.
- **G6** gates measured $ALPHA velocity (exchange + token-use + primary volume / circulating);
  **G7** enforces the spec's Pareto α ≥ 2 alongside Gini; **G8** gates the CAPTURE share of
  sink volume (≥50%). All previously unfailable.

**Mechanisms that existed only as parameters:** staking (real lock/unlock; staked $ALPHA is
un-dumpable and §13.A-exempt), a real **vesting queue** (withdrawal value realizes at release,
bearing price risk), the P2P transfer fee, upkeep S4, mule replacement after churn. Item
inventory formally **descoped** (spec §16). `sweep.py`'s majority/interval/label bugs fixed.

**§13 decisions, now implemented and tested (previously paper-only):**
- **§13.A idle-$ALPHA holding cost** (≈ Credit demurrage; staked exempt; dormant decays too).
- **§13.B TWAP treasury ops**: fast-vs-slow EMA of `e`, ±20% no-op band, per-tick and rolling
  30-day volume caps — no telegraphed thresholds to game.
- **Provenance-discount withdrawal surcharge** (ECONOMY §9): the transferred-in fraction of a
  holder's $ALPHA pays an extra fee at cash-out — the designed anti-funnel lever, and the thing
  that actually beat the 12-mule attack (see below).

## Economics findings from the v2 re-calibration (the point of doing it)

1. **The inflation target and the faucet:sink gate are coupled.** Targeting +2% CPI makes M
   grow, which makes cumulative faucet exceed sinks by construction. The policy target is now
   ~price stability (+0.5%).
2. **A growing population legitimately mints more than it sinks.** G1 is only meaningful at
   steady state — the baseline now reaches its population equilibrium inside the horizon.
3. **§13.A concentrates wealth into staked $ALPHA** (the only decay-free store) — the spec's own
   counterweight is **$ALPHA-denominated Veblen/status sinks** (ECONOMY §2.2/§2.3), now
   implemented: they drain whale hoards (burn + capture) without selling power.
4. **The v1 Gini "problem" was a demand-mix assumption, not an economy failure.** Whale-only
   primary $ALPHA distribution made token Gini 0.86 by construction; a Catizen-style retail payer
   mix (many small payers) yields Gini ≈ 0.60 and Pareto α ≈ 4. **Corollary: reported equality
   depends on that demand-mix assumption holding in reality — instrument it at launch.**
5. **Per-identity withdrawal caps do NOT reduce sybil share** — they bind honest whales harder
   than 12 distributed mules (tightening w_cap made sybil share *worse*). The lever that works
   is **provenance discounting** of transferred-in value.
6. **The v1 CPI integrator ratcheted permanently on transient M swings** — replaced with a
   level-based, mean-reverting MV=PQ form (P tracks smoothed M/Q level). This was the spec §16
   "reduced-form CPI" caveat biting in practice.

## The two-tier gate (be precise about what passes what)

- **Standard scenarios** (baseline, whale_shock, plateau, bot_attack, gresham, funnel):
  **all 12 criteria enforced strictly.**
- **Red-team scenarios** (deliberate attacks: demurrage_flight, bank_run 30-day panic,
  smart_sybil 12 verified mules, floor_split, pump_dump 30% cartel): the **survival criteria
  (G1, G2, G5, G7–G12) are enforced strictly**; the peacetime-stability criteria (**G3
  monetary smoothness, G4 CPI band**) are reported as **under-attack diagnostics** (`DG`),
  because no economy holds peacetime CPI variance during a coordinated 30%-population attack —
  what must hold is integrity, solvency, bounded inequality, working sinks, and recovery.
  This scoping is printed on every scorecard; nothing is silently waived.

## Status — v5 FINAL results (500 seeds standard / 100 seeds red-team, 24-month horizon)

The round-5 engine adds the **§13.D whale-tail levers** (progressive carry on the total
$ALPHA position + wealth-indexed primary issuance — see `AUDIT-2.md` §7) and an
**honest-measurement fix** (networth/alpha_circ now include `ALPHA_unbonding`, which had
hidden ~25% of a mature whale's position from Gini/α — the corrected v4 whale_market α
was **1.02**, not the reported 1.13). Scorecards: `v5_500.txt` / `results_v5_500.json`,
`v5_redteam_100.txt` / `results_v5_redteam.json`, `sweep_v5.txt` / `sweep_v5.json`,
calibration record `v5_calibration.txt`. (The v4 scorecards remain in-tree as the
immediate-prior record.)

**Standard scenarios — the formal Phase-0 → Phase-1 gate (all 12 criteria strict, 500
seeds): ALL 6 SCENARIOS PASS, every criterion ≥ 95%** on the corrected metric (plateau
G3 at 99%). The levers *improve* the standard economy's inequality profile — Gini
medians fall ~0.07 suite-wide (baseline 0.594 → 0.525, funnel 0.674 → 0.595) — with G6
velocity essentially unchanged and funnel G11 at 1.24% (a denominator composition
effect, far under the 5% bar).

**Red-team scenarios (survival criteria strict; G3/G4 diagnostic; 100 seeds): 6 of 7
pass — up from 5/7 in v4.** The §13.D levers close the whale-tail failure; the one
remaining item is the product-level PoP-quality residual, reported not tuned away:

| Scenario | Verdict | Detail |
|---|---|---|
| demurrage_flight | **PASS** | |
| bank_run | **PASS** | (§13.B, unchanged) |
| floor_split | **PASS** | |
| pump_dump | **PASS** | (§13.B, unchanged) |
| confidence_crisis | **PASS** | |
| smart_sybil | **FAIL G11** — median **6.07%** vs <5% | The known product-level residual. The v4→v5 move (5.39 → 6.07%) is a *composition* effect, decomposed in `AUDIT-2.md` §7: absolute mule extraction **fell 14%** (mules pay the carry too) but honest cash-out volume fell 23% (the F4 throttle), so the ratio rose. Binding defense remains PoP quality (`bot_pass_rate`) |
| whale_market | **PASS** *(fixed by §13.D)* | α median **2.80** (was 1.02 corrected / bar ≥ 2), Gini **0.653**, G7 100% of seeds. Collateral: e ends ~65¢/$ALPHA (was ~25¢) — throttled top-end issuance removes structural sell pressure |

**Net verdict:** the Phase-0 → Phase-1 gate (`ECONOMY-SIM-SPEC.md` §13: G1–G12 across the
§12 standard scenarios at ≥500 seeds) **PASSES**. The red-team suite leaves exactly
**one** open item: PoP quality (smart_sybil), product-level by design conclusion. The
whale-tail class is closed — with one honestly-bounded condition: the G7 pass is
**per-identity**, and full split-identity evasion of the §13.D levers would revert to
the v4 record (ECONOMY.md §13.D residual 1; split-hoard red-team variant on the queue).

**Round-6 addendum (operator revenue):** the ECONOMY §3 operator-take rate on F3
(`op_take_f3`, default 0 = engine unchanged) has **zero dynamic effect anywhere in
[0, 0.9]**: the §13.B ops bind on their tick/window caps before the treasury balance
ever binds, so every take in the interval replays the v5 record bit-for-bit outside the
treasury balance itself (equivalence check + probe in `v6_optake_probe.txt`; record in
`AUDIT-2.md` §8). The ¢ treasury is ~97% internally captured value, so the fiat split
is an owner/business decision, not an economy lever. Round-6b extends this to
**boundary fees**: the cash-out fee + seasoning surcharge are operator revenue at any
split in [0, 1.0] (`op_take_wdfee`, default 0; `v6_wdfee_probe.txt`, `AUDIT-2.md` §8b)
— value already exiting carries no counterfactual sell pressure. In-loop fees remain
fiscal, never revenue.

**Round-6c addendum (the global cap):** the deployed Settlement's global rolling
withdrawal cap is now modeled (`wd_global_cap`, default 0 = the v5 engine exactly;
release-side FIFO leaky bucket, deferred vouchers stay in escrow). The smart_sybil
re-judge at k = 12/50/200 mules (`v6_globalcap_redteam.txt`, `AUDIT-2.md` §11): the cap
**never binds the ring at production sizing** (the ring is acquisition-bound at ~2% of
its own exit ceiling) and **cannot move the G11 share** even when binding (sybil and
honest exits defer in the same queue). No throughput cap — per-identity or global — is
a sybil-share defense; PoP quality is the binding G11 lever, now unconditionally.
windowCap stays what M4 said it is: catastrophic-event insurance with zero honest
friction at 1×-p95-honest-volume sizing.

### The §13.D whale-tail levers (what fixed whale_market)

Both are `ECONOMY.md` §13.D decisions from a 7-agent adversarial design panel, then
empirical grid calibration (`v5_calibration.txt`); both are swept §12 params with exact
zero-points (verified bit-identical to v4 including RNG state):

- **Progressive carry** (`alpha_prog_thresh`=250, `alpha_prog_rate`=0.045): each identity's
  total $ALPHA position (liquid+staked+unbonding) above the shelter pays the carry on the
  excess, staked-first, to the $ALPHA treasury. Staked pays only this progressive
  component — locking still strictly beats idle at every hoard size, so the §13.A
  Gresham closure survives. Measured alone: α tops out ~1.5 (stock-side compression
  cannot close the archetype plateau gap).
- **Wealth-indexed primary issuance** (`alpha_primary_gamma`=2.0, `alpha_primary_href`=750):
  F4 allocation = base·(1+H/href)^−γ — the primary price rises with the buyer's
  position (the §2.3 auction logic as a posted-price rule). This compresses the 12–50×
  archetype inflow gap that actually sets the wealth-plateau ratio the Hill α reads.
  Measured alone: α ≤ ~1.7. **Together: α 2.80, a wide passing region, no knife-edge.**

### The §13.B market defenses (what fixed pump_dump and bank_run in v4)

All three are `ECONOMY.md` §13.B options that graduated from "held in reserve" to
implemented mechanics; all are swept §12 parameters:

- **(d) Flow cap** (`ex_flow_cap`, per-tick net flow per side ≤ fraction of that side's
  pool reserve, pro-rata fills, unfilled flow re-queues) — the in-model proxy for a
  commit-reveal batch auction. Bounds any cartel's or panic's per-tick price impact
  (the direct G9 fix) without blocking exit: a dump is spread across ticks as an orderly
  book, not stopped at a wall.
- **Volatility-scaled exchange fee** (`vol_fee_k`, `phi_ex` multiplier grows with
  sustained fast-vs-slow deviation beyond the no-op band, capped) — a cartel cycling
  buy/dump pays escalating tolls, restoring the Credit-side sink that pump_dump's tail
  emission was starving; calm trade never leaves the 1× multiplier.
- **(c) TWAP op jitter** (`twap_jitter`, random share of treasury-op ticks skipped) —
  breaks phase-locking so an adversary can't time a pump/dump against the treasury's
  cadence.

**Load-bearing evidence is the red-team delta, not the sweep.** The v3 engine (defenses
off) failed pump_dump and bank_run; the v4 engine (defenses on) passes both, standard
suite unchanged. The sweep runs on the *standard* subset (no cartel), so its zero-points
(`ex_flow_cap=1.0`/off, `vol_fee_k=0`/off, `twap_jitter=0`) all PASS there — confirming
the defenses don't harm normal play across their full range, which is the *other* thing
that had to be true.

**Parameter sweep at the v5 defaults** (`sweep_v5.txt` / `sweep_v5.json`): **all 21
levers robust, zero knife-edges** — every calibrated value inside a multi-point safe
interval, including the four new §13.D levers (each passes at every swept point on the
standard subset, including its zero-point — like `commons_prob`, they are not
gate-load-bearing there; the load-bearing evidence is the whale_market red-team delta).
Prior falsification results stand: §13.A idle decay is load-bearing
(`alpha_idle_decay_mult=0` fails G2/G6); the Commons sink is not gate-load-bearing
(`commons_prob=0` passes — it is the Gini/whale lever); `delta_kp=0.08` overreacts
(G3/G4); demurrage binds from below (safe δ ∈ [0.0035, 0.008]). One prior falsification
is **resolved by §13.D**: `stake_prob=0.7` — v4's G7 wealth-concentration corner — now
passes (safe interval [0.15, 0.7]): the progressive carry closes the staked-shelter
concentration that corner exposed. *(Reporting note:
`bound_spend_frac` shows "OUTSIDE" only because the calibrated 0.56 is interior to but
not one of the five swept points; all five pass and the validation ran at 0.56 —
unchanged from v4.)*

## Historical — v2 FINAL results (superseded by v3 above)

**Standard scenarios (all 12 criteria strict):**

| Scenario | Result | Sybil share | Gini | e (¢/$ALPHA) |
|---|---|---|---|---|
| baseline | **ALL 12 ≥95%** | 0.02% | 0.605 | 60 |
| whale_shock | **ALL 12 ≥95%** | 0.02% | 0.604 | 60 |
| plateau | 11/12 — **G3 at 86%** (see below) | 0.01% | 0.610 | 65 |
| bot_attack | **ALL 12 ≥95%** | 0.08% | 0.668 | 93 |
| gresham | **ALL 12 ≥95%** | 0.02% | 0.621 | 79 |
| funnel | **ALL 12 ≥95%** | 0.64% | 0.680 | 85 |

**The one honest exception — plateau G3 (86%):** the p95 |30-day M/Q growth| criterion
exceeds 5%/mo in ~14% of seeds. Median is 0.035 (well inside the band); the misses are
statistical tail spikes during post-plateau re-equilibration in the smallest-population
scenario (N* ≈ 670 — small-N variance in the ratio statistic, not a drifting price level:
G4 passes at 100%). Reported as a known, bounded exception rather than tuned away.

**Red-team scenarios (survival criteria strict; G3/G4 = under-attack diagnostics):**
all five **PASS** — demurrage_flight, bank_run (30-day panic; recovers), smart_sybil
(**3.74%** extraction vs 5% bar — the provenance surcharge is the working defense; the honest
pre-fix test failed at 5.4–5.5%), floor_split (all 12 incl. diagnostics), pump_dump
(treasury not bled; diagnostics honestly show a 30% cartel imposes ~0.88/mo M/Q swings and
transient CPI wobble the economy survives but no policy smooths).

Full data: `results_v2_500.json`, `results_v2_redteam.json`.

## Audit round 2 (independent verification) — see `AUDIT-2.md`

A 17-agent independent verification confirmed **every v1 audit finding genuinely fixed**
(with injected-fault detection tests: a planted Bound siphon trips G10; planted destruction
trips G12), then found **14 new material issues**. Fixed immediately: the Hill-α +1 inflation
(corrected mature α = 2.59, still ≥2), the G1 churn-crutch (churned balances now go dormant
and decay via demurrage — a designed sink; designed-only faucet:sink = 0.984), the provenance
denominator, fee accounting, and sweep gaps. The **open queue** (AMM-wash evasion of the
provenance surcharge → seasoning; staked-corner equilibrium; CPI velocity-blindness; unfunded
AMM depth; assumption-controlled Gini; return-inelastic demand / death-spiral scenario;
demurrage magnitude vs precedent) is documented with planned responses in `AUDIT-2.md` §3.
The honest status: **validated structure, named conditions, open queue** — not "proven safe."


## Remaining caveats (do not over-read)
- CPI is still reduced-form (level-based M/Q, not an emergent goods-market basket) — spec §16.
- The exchange is an aggregate per-tick AMM, not per-order matching.
- Real-money demand (F3/F4 propensities) is the weakest-grounded input; the Gini result
  explicitly depends on the retail payer-mix assumption (finding #4).
- `DEFAULT_PARAMS` are calibrated v2 estimates — the sweep maps the region, production
  constants come later (spec's TEC discipline).
