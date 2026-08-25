"""
G1-G12 exit-criteria gate (docs/ECONOMY-SIM-SPEC.md §13) — v2, post-audit.

Every evaluator measures a quantity the engine actually instruments and can fail:
  - G6 gates measured $ALPHA velocity (was: an unfailable "circulating > 0" proxy).
  - G7 gates wealth Gini AND the spec's Pareto tail_alpha >= 2 (was: Gini only).
  - G8 gates the CAPTURE share of total sink volume (was: an unfailable "treasury > 0").
  - G10 gates a real Bound-Credit leak ledger (was: a constant 0).
  - G11 gates the strict sybil share of realized cash-out value (escape hatch removed;
    honest players verify in funnel scenarios now, so the ratio is meaningful).
  - G12 gates ledger conservation ($ALPHA and Credit residuals ~ 0 every tick) plus
    exit-Gini. In-sim "proof of reserves" IS ledger integrity; on-chain PoR is an M4
    contract-in-the-loop property, not a thing this model can attest.

Each evaluator returns (passed: bool, value: float, detail: str).
"""
import numpy as np

SECOND_HALF = lambda rows: rows[len(rows) // 2:]
# Inflation/money-growth are STEADY-STATE targets: the growth ramp is inherently
# expansionary and a plateau transition is a one-off adjustment. Measured in the
# mature window after the §10 controller settles.
MATURE = lambda rows: rows[-150:]


def WINDOW(rows, sc):
    """Measurement window for G3/G4. Event scenarios (audit-2 fix) anchor the window AT
    the event so the attack and its aftermath are actually measured — not a calm stretch
    four months later (bank_run) or before the event entirely (whale_shock)."""
    ev = getattr(sc, "dump_tick", None) or getattr(sc, "whale_shock_tick", None)
    if ev is not None and ev < rows[-1]["t"]:
        return rows[ev:min(ev + 150, len(rows))]
    return rows[-150:]


def _series(rows, key):
    return np.array([r[key] for r in rows], float)


def g1_faucet_sink(rows, sc, p):
    h = SECOND_HALF(rows)
    faucet = float((_series(h, "mint_bound") + _series(h, "mint_clean")).sum())
    sink = float(_series(h, "sink").sum())
    val = faucet / max(sink, 1e-9)
    return val <= 1.0, val, "cumulative faucet:sink (2nd half) ≤ 1.0"


def g2_net_emission_zero_growth(rows, sc, p):
    # meaningful once growth has slowed; guard short horizons (no nan auto-fail)
    t0 = 180 if rows[-1]["t"] >= 270 else (2 * len(rows)) // 3
    tail = [r for r in rows if r["t"] >= t0]
    if not tail:
        return False, float("nan"), "horizon too short to evaluate"
    val = float(np.mean(_series(tail, "net_emission")))
    return val <= 0.0, val, f"mean net Credit emission, t≥{t0} ≤ 0"


def g3_money_growth(rows, sc, p):
    # monetary-inflation proxy: growth of money-per-unit-output M/Q (population-robust).
    # Note: this is the M-side signal for the spec's G3; absolute M tracks population.
    MQ = _series(WINDOW(rows, sc), "MQ")
    if MQ.size > 14:
        MQ = np.convolve(MQ, np.ones(14) / 14, mode="valid")
    g = [(MQ[i] - MQ[i - 30]) / MQ[i - 30] for i in range(30, len(MQ)) if MQ[i - 30] > 0]
    g = np.array(g) if g else np.array([0.0])
    worst = float(np.percentile(np.abs(g), 95))
    return worst <= 0.05, worst, "p95 |30-day smoothed M/Q growth| ≤ 5%/mo (mature window)"


def g4_cpi_band(rows, sc, p):
    infl = _series(WINDOW(rows, sc), "inflation")
    val = float(np.median(infl))
    return (-0.05 <= val <= 0.10), val, "median mature CPI inflation in [−5%, +10%] (annualised)"


def g5_velocity_stable(rows, sc, p):
    V = _series(rows, "V")
    mid = np.median(V[len(V) // 3:2 * len(V) // 3])
    end = np.median(V[-len(V) // 6:])
    ratio = end / mid if mid > 0 else 1.0
    return ratio >= 0.5, float(ratio), "credit velocity end ≥ 0.5× mid (no collapse)"


def g6_alpha_velocity(rows, sc, p):
    # measured $ALPHA turnover: monthly exchange volume / circulating supply, mature phase.
    # Band: alive (> 0.02×/mo — not a dead speculative brick) and not hot-potato
    # (< 30×/mo). Burniske-style reference V≈20/yr ≈ 1.7/mo sits comfortably inside.
    vv = _series(MATURE(rows), "alpha_velocity")
    val = float(np.median(vv))
    return (0.02 <= val <= 30.0), val, "median mature $ALPHA velocity in [0.02, 30]×/month"


def g7_gini(rows, sc, p):
    G = _series(SECOND_HALF(rows), "gini")
    gval = float(np.median(G))
    A = _series(MATURE(rows), "tail_alpha")
    A = A[~np.isnan(A)]
    aval = float(np.median(A)) if A.size else float("nan")
    # spec: Gini ≤ 0.70 AND Pareto tail tail_alpha ≥ 2 (tail_alpha < 2 = oligarchic capture)
    ok = gval <= 0.70 and (np.isnan(aval) or aval >= 2.0)
    return ok, gval, f"median wealth Gini ≤ 0.70 AND Pareto α ≥ 2 (α={aval:.2f})"


def g8_sink_efficacy(rows, sc, p):
    cs = _series(MATURE(rows), "capture_share")
    val = float(np.median(cs))
    return val >= 0.5, val, "CAPTURE share of cumulative sink volume ≥ 50% (sinks accrue value)"


def g9_no_gresham(rows, sc, p):
    e = _series(rows, "e")
    e0 = e[0]
    in_band = bool(np.all((e > 0.2 * e0) & (e < 5 * e0)))
    P = _series(rows, "P")
    pmax = float(P.max() / P[0])
    return (in_band and pmax < 3.0), pmax, "no hoard/dump split: e∈[0.2,5]×e0 and price <3×"


def g10_chance_leakage(rows, sc, p):
    # REAL ledger check: unexplained Bound-Credit outflow accumulated by the engine.
    # Any code path that moves Bound anywhere but its allowed sinks trips this.
    val = float(_series(rows, "chance_leak").max())
    return val == 0.0, val, "unexplained Bound (chance-origin) outflow = 0 (ledger-verified)"


def g11_sybil_share(rows, sc, p):
    # strict: sybil share of REALIZED cash-out value < 5%. No absolute-value escape
    # hatch — honest players verify in every scenario, so the denominator is real.
    val = float(rows[-1]["sybil_share"])
    return val < 0.05, val, "sybil share of realized cash-out value < 5%"


def g12_ledger_and_exit(rows, sc, p):
    last = rows[-1]
    alpha_ok = last["alpha_resid"] < 1e-3 * p["alpha_max"]          # ≤0.1% of the hard cap
    credit_ok = last["credit_resid"] < max(1e-3 * last["M"], 1.0)  # ≤0.1% of money supply
    eg = _series(rows, "exit_gini")
    egv = float(np.median(eg[eg > 0])) if (eg > 0).any() else 0.0
    ok = bool(alpha_ok and credit_ok and egv < 0.85)
    return ok, egv, (f"ledgers conserve ($ALPHA resid={last['alpha_resid']:.2f}, "
                     f"¢ resid={last['credit_resid']:.2f}) AND exit-Gini < 0.85")


GATE = [
    ("G1", g1_faucet_sink), ("G2", g2_net_emission_zero_growth),
    ("G3", g3_money_growth), ("G4", g4_cpi_band), ("G5", g5_velocity_stable),
    ("G6", g6_alpha_velocity), ("G7", g7_gini), ("G8", g8_sink_efficacy),
    ("G9", g9_no_gresham), ("G10", g10_chance_leakage),
    ("G11", g11_sybil_share), ("G12", g12_ledger_and_exit),
]


def evaluate(rows, sc, p):
    out = {}
    for code, fn in GATE:
        try:
            passed, val, detail = fn(rows, sc, p)
        except Exception as ex:  # noqa
            passed, val, detail = False, float("nan"), f"error: {ex}"
        out[code] = dict(passed=bool(passed), value=val, detail=detail)
    return out
