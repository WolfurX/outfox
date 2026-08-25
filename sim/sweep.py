"""
Parameter sweep (spec ECONOMY-SIM-SPEC.md milestone M3).

Turns the single calibrated passing point into a mapped SAFE REGION:
  1) one-at-a-time (OAT) sensitivity — for each key lever, the interval over which the
     economy still passes the full G1-G12 gate across all scenarios (knife-edge vs basin);
  2) a 2-D map over the core faucet/sink pair (demurrage × Operations-output cap).

This is the cadCAD "parameter sweep + ensemble" step, implemented on our own engine. A point
PASSES if, for every scenario, every G1-G12 criterion passes in the majority of its
Monte-Carlo runs.

Usage:
  python3 sweep.py                 # OAT + 2D, default settings
  python3 sweep.py --runs 3 --ticks 600 --json sweep.json
  python3 sweep.py --quick         # fewer points/runs for a fast look
"""
import argparse, json, statistics
from multiprocessing import Pool
from simulation import Sim, make_scenarios, DEFAULT_PARAMS
import gate as gatemod

_POOL = None  # initialised in main(); same worker pattern as run.py


def _sweep_one(job):
    """Worker: one (params, scenario, seed) sim -> per-criterion pass dict."""
    p, sc, seed = job
    rows = Sim(p, sc, seed=seed).run()
    g = gatemod.evaluate(rows, sc, p)
    return {code: g[code]["passed"] for code, _ in gatemod.GATE}

# Stress subset for the sweep — covers every distinct failure mode: normal (baseline),
# growth-stop deflation (plateau), sybil + load (bot_attack), currency split (gresham),
# and the mule funnel (audit fix: funnel is exactly where w_cap / bot_pass_rate bind).
# Only whale_shock is excluded (wide-margin pass everywhere; adds cost without signal).
SCEN = ["baseline", "plateau", "bot_attack", "gresham", "funnel"]

# OAT sweep ranges, centred on the calibrated DEFAULT_PARAMS value (marked * in output).
OAT = {
    "delta":               [0.002, 0.0035, 0.0045, 0.006, 0.008],
    "delta_kp":            [0.0, 0.015, 0.03, 0.05, 0.08],     # 0 = controller OFF
    "bound_spend_frac":    [0.40, 0.50, 0.53, 0.60, 0.70],
    "f2_cap":              [80, 100, 112, 135, 165],
    "phi_market":          [0.02, 0.035, 0.05, 0.07, 0.10],
    "w_cap":               [40, 58, 80, 120, 200],
    "bot_pass_rate":       [0.005, 0.01, 0.02, 0.05, 0.10],
    "demurrage_prog_rate": [0.006, 0.012, 0.018, 0.030, 0.045],  # incl. calibrated 0.018
    # round-3 / §13-era levers (AUDIT-2 open item: never swept at the new defaults).
    # Zero points deliberately test whether each mechanism is load-bearing.
    "alpha_idle_decay_mult": [0.0, 0.5, 1.0, 1.5, 2.5],     # §13.A holding cost (0 = off)
    "seasoning_days":      [15, 30, 60, 90, 120],          # §13.C cash-out seasoning
    "unbond_days":         [2, 4, 7, 14, 28],              # §13.A real unbonding period
    "stake_prob":          [0.15, 0.25, 0.35, 0.50, 0.70], # staking propensity
    "alpha_status_burn":     [0.0, 0.30, 0.65, 0.85, 1.0],   # Veblen split burn/capture
    "commons_prob":        [0.0, 0.02, 0.05, 0.10, 0.20],  # Commons sink (0 = off; THEME-OUTFOX §4 acceptance)
    # §13.B activated market defenses (v4): zero/identity points test load-bearing-ness
    "ex_flow_cap":         [0.005, 0.01, 0.02, 0.05, 1.0],  # 1.0 = cap effectively off
    "vol_fee_k":           [0.0, 4.0, 8.0, 16.0, 32.0],     # 0 = circuit-breaker off
    "twap_jitter":         [0.0, 0.15, 0.30, 0.50, 0.70],   # 0 = deterministic ops
    # §13.D whale-tail levers (v5): 0 = off. Like commons_prob, not expected to be
    # gate-load-bearing on this standard subset — they are the whale_market tail levers;
    # the load-bearing evidence is the red-team delta (AUDIT-2.md §7, v5_calibration.txt).
    "alpha_prog_rate":       [0.0, 0.015, 0.03, 0.045, 0.06],
    "alpha_prog_thresh":     [125, 250, 500, 1000, 2000],
    "alpha_primary_gamma":   [0.0, 1.0, 2.0, 2.5, 3.0],       # 0 = flat primary pricing
    "alpha_primary_href":    [375, 750, 1500, 3000, 6000],
    # operator take on F3 (round-6): 0 = all fiat value retained by the game treasury.
    # The binding constraint is red-team treasury-defense ammunition, not this standard
    # subset — see the round-6 red-team probe in AUDIT-2.
    "op_take_f3":          [0.0, 0.25, 0.5, 0.75, 0.9],
    # operator take on cash-out fees (round-6b): can bind via the F4 issuance cap and
    # §13.B sell-side ammunition (ALPHA_treasury) — see AUDIT-2 §8b.
    "op_take_wdfee":       [0.0, 0.25, 0.5, 0.75, 1.0],
}
GRID_X = ("delta", [0.003, 0.0045, 0.006, 0.008])
GRID_Y = ("f2_cap", [90, 112, 140, 170])


def eval_point(overrides, runs, ticks):
    """Return (all_pass, {failing_criterion: [scenarios]}) for a parameter point."""
    p = dict(DEFAULT_PARAMS); p.update(overrides); p["horizon"] = ticks
    scns = make_scenarios()
    jobs = [(p, scns[name], s) for name in SCEN for s in range(runs)]
    results = _POOL.map(_sweep_one, jobs) if _POOL else [_sweep_one(j) for j in jobs]
    fails = {}
    all_pass = True
    for i, name in enumerate(SCEN):
        per_run = results[i * runs:(i + 1) * runs]
        for code, _ in gatemod.GATE:
            pr = sum(g[code] for g in per_run) / len(per_run)
            if pr <= 0.5:                # STRICT majority required (audit fix: 50% ≠ majority)
                all_pass = False
                fails.setdefault(code, []).append(name)
    return all_pass, fails


def contiguous_pass_interval(values, passes):
    """Largest contiguous run of passing values -> (lo, hi) or None."""
    best = None; cur = None
    for v, ok in zip(values, passes):
        if ok:
            cur = (v, v) if cur is None else (cur[0], v)
            if best is None or (cur[1] - cur[0]) >= (best[1] - best[0]):
                best = cur
        else:
            cur = None
    return best


def run_oat(runs, ticks):
    print(f"\n==================  OAT SENSITIVITY SWEEP  (runs={runs}, ticks={ticks})  ==================")
    print(f"For each lever: which values keep the FULL G1-G12 gate passing across the "
          f"{len(SCEN)}-scenario stress subset ({', '.join(SCEN)}).\n")
    out = {}
    for param, values in OAT.items():
        cal = DEFAULT_PARAMS[param]
        passes, detail = [], []
        for v in values:
            ok, fails = eval_point({param: v}, runs, ticks)
            passes.append(ok)
            tag = "*" if v == cal else " "
            mark = "PASS" if ok else "FAIL:" + ",".join(
                f"{c}({'/'.join(s[:3] for s in sc)})" for c, sc in fails.items())
            detail.append(f"    {tag}{param}={v:<8} {mark}")
        interval = contiguous_pass_interval(values, passes)
        # audit fix: judge the calibrated value by its OWN result, not by whether it
        # falls inside the largest interval (disjoint pass regions misreported before)
        cal_in = (cal in values) and passes[values.index(cal)]
        print(f"  {param}  (calibrated={cal})")
        for line in detail:
            print(line)
        if interval:
            print(f"    -> safe interval: [{interval[0]}, {interval[1]}]  "
                  f"calibrated {'INSIDE' if cal_in else 'OUTSIDE'} the interval")
        else:
            print("    -> NO passing value in swept range")
        print()
        out[param] = dict(values=values, passes=passes,
                          interval=interval, calibrated=cal, cal_in=cal_in)
    return out


def run_grid(runs, ticks):
    px, xs = GRID_X
    py, ys = GRID_Y
    print(f"\n==================  2-D SAFE-REGION MAP: {px} × {py}  ==================")
    print(f"(core faucet/sink balance; ✓ = full gate passes all scenarios, runs={runs})\n")
    header = f"    {px:>10} \\ {py}:  " + "  ".join(f"{y:>6}" for y in ys)
    print(header)
    grid = []
    for x in xs:
        row = []
        cells = []
        for y in ys:
            ok, _ = eval_point({px: x, py: y}, runs, ticks)
            row.append(ok)
            cells.append("   ✓  " if ok else "   ·  ")
        grid.append(row)
        print(f"    {x:>13}   " + "".join(cells))
    print("\n    ✓ = all G1-G12 pass in all scenarios · · = at least one fails")
    return dict(x_param=px, x=xs, y_param=py, y=ys, grid=grid)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3)  # 3 seeds -> strict majority = 2/3
    ap.add_argument("--ticks", type=int, default=720)  # mature-window gate needs full horizon
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--json", default="sweep.json")
    ap.add_argument("--procs", type=int, default=1)
    args = ap.parse_args()
    runs, ticks = args.runs, args.ticks
    if args.quick:
        runs, ticks = 2, 480
    global _POOL
    if args.procs > 1:
        _POOL = Pool(args.procs)

    oat = run_oat(runs, ticks)
    grid = run_grid(runs, ticks)

    # summary
    knife = [p for p, d in oat.items()
             if d["interval"] and d["values"].index(d["interval"][1]) ==
             d["values"].index(d["interval"][0])]
    robust = [p for p, d in oat.items()
              if d["interval"] and d["cal_in"] and
              d["values"].index(d["interval"][0]) < d["values"].index(d["interval"][1])]
    print("\n==================  SUMMARY  ==================")
    print(f"  Robust levers (calibrated value sits inside a multi-point safe interval): "
          f"{', '.join(robust) or 'none'}")
    print(f"  Knife-edge levers (single passing point — tighten tolerance): "
          f"{', '.join(knife) or 'none'}")

    with open(args.json, "w") as f:
        json.dump({"oat": oat, "grid": grid, "runs": runs, "ticks": ticks}, f,
                  indent=2, default=float)
    print(f"\n  wrote {args.json}")


if __name__ == "__main__":
    main()
