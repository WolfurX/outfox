"""
Monte-Carlo driver for the Outfox economy simulation.

Usage:
  python3 run.py                      # all scenarios, default runs
  python3 run.py --scenario baseline --runs 200 --ticks 720
  python3 run.py --smoke              # fast sanity (few runs, short horizon)
  python3 run.py --json out.json      # also dump aggregated results
"""
import argparse, json, sys, statistics
from multiprocessing import Pool
import numpy as np
from simulation import (Sim, make_scenarios, make_adversarial_scenarios, DEFAULT_PARAMS)
import gate as gatemod


def _one_run(job):
    """Worker: run one seed, return (gate_result, final_row). Rows stay in the worker
    (only reductions cross the process boundary — keeps ≥500-seed runs memory-sane)."""
    params, sc, seed = job
    rows = Sim(params, sc, seed=seed).run()
    return gatemod.evaluate(rows, sc, params), rows[-1]


def run_scenario(name, sc, params, runs, seed0, procs=1):
    jobs = [(params, sc, seed0 + r) for r in range(runs)]
    if procs > 1:
        with Pool(procs) as pool:
            out = pool.map(_one_run, jobs)
    else:
        out = [_one_run(j) for j in jobs]
    per_run_gate = [g for g, _ in out]
    last_rows = [lr for _, lr in out]
    # aggregate gate: pass-rate per criterion + median value
    agg = {}
    for code, _ in gatemod.GATE:
        passes = [g[code]["passed"] for g in per_run_gate]
        vals = [g[code]["value"] for g in per_run_gate
                if g[code]["value"] == g[code]["value"]]  # drop nan
        agg[code] = dict(
            pass_rate=sum(passes) / len(passes),
            median=(statistics.median(vals) if vals else float("nan")),
            detail=per_run_gate[0][code]["detail"],
        )
    # final-tick summary medians
    finals = {}
    for key in ("N", "M", "e", "gini", "faucet_sink", "sybil_share",
                "alpha_burned", "treasury", "cashout_total"):
        finals[key] = statistics.median([lr[key] for lr in last_rows])
    return agg, finals


# Two-tier gate (documented in README): STANDARD scenarios enforce all 12 criteria.
# RED-TEAM (deliberate-attack) scenarios enforce the SURVIVAL criteria strictly and
# report the peacetime-stability criteria (G3 monetary smoothness, G4 CPI band) as
# under-attack DIAGNOSTICS — no real economy holds peacetime CPI variance during a
# coordinated 30%-population attack; what must hold is integrity, solvency, bounded
# inequality, working sinks, and recovery. (Same philosophy as bank stress tests.)
DIAG_UNDER_ATTACK = {"G3", "G4"}


def print_scorecard(name, agg, finals, redteam=False):
    print(f"\n=== Scenario: {name} ==={' [red-team: G3/G4 diagnostic]' if redteam else ''}")
    print(f"  final medians: N={finals['N']:.0f}  M={finals['M']:,.0f}¢  "
          f"e={finals['e']:.1f}¢/$ALPHA  Gini={finals['gini']:.3f}  "
          f"cashout={finals['cashout_total']:,.0f}¢  sybil={finals['sybil_share']*100:.2f}%")
    print(f"  {'crit':5} {'pass%':>6}  {'median':>12}   detail")
    allpass = True
    for code, _ in gatemod.GATE:
        a = agg[code]
        pr = a["pass_rate"] * 100
        diag = redteam and code in DIAG_UNDER_ATTACK
        mark = "DG " if (diag and pr < 95) else ("OK " if pr >= 95 else ("~  " if pr >= 50 else "XX "))
        if pr < 95 and not diag:
            allpass = False
        med = a["median"]
        med_s = f"{med:12.4f}" if med == med else "         nan"
        note = "  [diagnostic under attack]" if diag else ""
        print(f"  {mark}{code:4} {pr:5.0f}% {med_s}   {a['detail']}{note}")
    print(f"  >>> {'GATE PASS' if allpass else 'GATE FAIL (see XX/~ rows)'}")
    return allpass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scenario", default="all")
    ap.add_argument("--runs", type=int, default=120)
    ap.add_argument("--ticks", type=int, default=None)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--procs", type=int, default=1)
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--json", default=None)
    args = ap.parse_args()

    params = dict(DEFAULT_PARAMS)
    if args.ticks:
        params["horizon"] = args.ticks
    runs = args.runs
    if args.smoke:
        params["horizon"] = 120
        params["n_max"] = 2500
        runs = 6

    scenarios = dict(make_scenarios())
    scenarios.update(make_adversarial_scenarios())  # red-team scenarios runnable by name / 'redteam'
    if args.scenario == "redteam":
        scenarios = make_adversarial_scenarios()
    elif args.scenario == "all":
        scenarios = make_scenarios()  # 'all' = the 6 standard scenarios only
    else:
        scenarios = {args.scenario: scenarios[args.scenario]}

    results = {}
    overall = True
    redteam_names = set(make_adversarial_scenarios().keys())
    for name, sc in scenarios.items():
        agg, finals = run_scenario(name, sc, params, runs, args.seed, procs=args.procs)
        ok = print_scorecard(name, agg, finals, redteam=(name in redteam_names))
        overall = overall and ok
        results[name] = dict(gate=agg, finals=finals)

    print(f"\n########  OVERALL: {'ALL SCENARIOS PASS' if overall else 'NOT ALL PASS'}  "
          f"(runs={runs}, horizon={params['horizon']})  ########")

    if args.json:
        with open(args.json, "w") as f:
            json.dump(results, f, indent=2, default=float)
        print(f"wrote {args.json}")


if __name__ == "__main__":
    main()
