"""
Signal Booster probe (2026-10-10): the slice's Gig tool becomes a consumable that adds
booster_pp to the success chance of one Exploit (Call), then is consumed. Owner default
under test: +5 points on one Call. Engine wiring and units: DEFAULT_PARAMS "Signal
Booster probe" block in simulation.py.

Phase 0 (identity): booster_pp=0 must reproduce the pre-booster engine (git BASE)
  exactly, every value of every daily row, standard and red-team scenarios.
Phase 1 (standard gate): all 6 standard scenarios at --runs seeds (500 for the record),
  Booster ON at the owner default; scorecards comparable with v5_500.txt (same seeds,
  booster-off engine == v5 engine).
Phase 2 (red-team gate): the adversarial suite at --rt-runs seeds (100), Booster ON;
  survival criteria strict, G3/G4 diagnostic (README two-tier rule).
Phase 3 (margin): baseline + smart_sybil at --grid-runs seeds over booster_pp x
  booster_price, plus a stress cell (a Booster from every Gig at +20 points).

Run:  python probe_booster.py                 (writes v7_booster_probe.txt/.json)
      python probe_booster.py --smoke         (quick wiring check, nothing written)
"""
import argparse, contextlib, importlib.util, io, json, os, statistics, subprocess, sys, tempfile, math
from multiprocessing import Pool

from simulation import Sim, DEFAULT_PARAMS, make_scenarios, make_adversarial_scenarios
import gate as gatemod
import run as runmod

BASE = "586f7c6"          # last commit with the pre-booster engine
OWNER = dict(booster_pp=0.05)
SURVIVAL = ("G1", "G2", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12")
BOOST_KEYS = ("boost_dropped", "boost_used", "boost_held", "boost_traded",
              "boost_trade_value", "boost_bonus_bound", "f1_base_bound")


def _job(job):
    params, sc, seed = job
    rows = Sim(params, sc, seed=seed).run()
    g = gatemod.evaluate(rows, sc, params)
    last = rows[-1]
    return g, last, {k: last.get(k, 0.0) for k in BOOST_KEYS}


def batch(params, sc, seeds, procs):
    with Pool(procs) as pool:
        return pool.map(_job, [(params, sc, s) for s in range(seeds)])


def aggregate(out):
    per = [g for g, _, _ in out]
    agg = {}
    for code, _ in gatemod.GATE:
        vals = [g[code]["value"] for g in per if g[code]["value"] == g[code]["value"]]
        agg[code] = dict(pass_rate=sum(g[code]["passed"] for g in per) / len(per),
                         median=statistics.median(vals) if vals else float("nan"),
                         detail=per[0][code]["detail"])
    finals = {k: statistics.median(lr[k] for _, lr, _ in out)
              for k in ("N", "M", "e", "gini", "faucet_sink", "sybil_share",
                        "alpha_burned", "treasury", "cashout_total")}
    boost = {k: statistics.median(b[k] for _, _, b in out) for k in BOOST_KEYS}
    boost["bonus_share_of_f1"] = statistics.median(
        b["boost_bonus_bound"] / b["f1_base_bound"] if b["f1_base_bound"] else 0.0 for _, _, b in out)
    return agg, finals, boost


def scorecard(name, agg, finals, redteam):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ok = runmod.print_scorecard(name, agg, finals, redteam=redteam)
    return ok, buf.getvalue()


def boost_line(b, phi):
    return (f"  booster: dropped {b['boost_dropped']:,.0f}  used {b['boost_used']:,.0f}  "
            f"held at end {b['boost_held']:,.0f}  traded {b['boost_traded']:,.0f} "
            f"for {b['boost_trade_value']:,.0f}¢ (fee captured {b['boost_trade_value'] * phi:,.0f}¢)  "
            f"extra Bound {b['boost_bonus_bound']:,.0f}¢ = {b['bonus_share_of_f1'] * 100:.2f}% of F1")


def identity(procs, seeds=2):
    src = subprocess.run(["git", "show", f"{BASE}:sim/simulation.py"], capture_output=True,
                         text=True, check=True, cwd=os.path.dirname(os.path.abspath(__file__))).stdout
    tmp = tempfile.NamedTemporaryFile("w", suffix="_base_sim.py", delete=False)
    tmp.write(src); tmp.close()
    names = list(make_scenarios().keys()) + list(make_adversarial_scenarios().keys())
    with Pool(procs) as pool:
        out = pool.map(_identity_job, [(tmp.name, n, s) for n in names for s in range(seeds)])
    os.unlink(tmp.name)
    vals = sum(v for v, _ in out)
    bad = sum(b for _, b in out)
    return len(names), seeds, vals, bad


def _identity_job(job):
    path, name, seed = job
    spec = importlib.util.spec_from_file_location("base_sim", path)
    base = importlib.util.module_from_spec(spec)
    sys.modules["base_sim"] = base           # dataclasses resolve their module by name
    spec.loader.exec_module(base)
    scs = dict(base.make_scenarios()); scs.update(base.make_adversarial_scenarios())
    ro = base.Sim(dict(base.DEFAULT_PARAMS), scs[name], seed=seed).run()
    nscs = dict(make_scenarios()); nscs.update(make_adversarial_scenarios())
    rn = Sim(dict(DEFAULT_PARAMS, booster_pp=0.0), nscs[name], seed=seed).run()   # switched off
    vals = bad = 0
    for a, b in zip(ro, rn):
        for k, v in a.items():
            vals += 1
            w = b[k]
            if not (v == w or (isinstance(v, float) and isinstance(w, float) and math.isnan(v) and math.isnan(w))):
                bad += 1
    return vals, bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=500)
    ap.add_argument("--rt-runs", type=int, default=100)
    ap.add_argument("--grid-runs", type=int, default=50)
    ap.add_argument("--procs", type=int, default=10)
    ap.add_argument("--smoke", action="store_true")
    ap.add_argument("--control", action="store_true",
                    help="only Phase 3b: Booster-off control at --grid-runs seeds, appended to the record")
    args = ap.parse_args()
    if args.control:
        return control(args)
    params = dict(DEFAULT_PARAMS, booster_pp=0.0)   # phases switch the Booster on explicitly
    if args.smoke:
        params.update(horizon=120, n_max=2500)
        args.runs = args.rt_runs = args.grid_runs = 4
    phi = params["phi_market"]
    lines, record = [], {}

    def out(s=""):
        print(s, flush=True); lines.append(s)

    out(f"# Signal Booster probe: owner default +{OWNER['booster_pp'] * 100:.0f} points on one Call, consumed")
    out(f"# engine: simulation.py booster block; base for identity: git {BASE}")
    out(f"# params: trade_frac={params['booster_trade_frac']} price={params['booster_price']}¢ "
        f"call_p={params['booster_call_p']} call_cost={params['booster_call_cost']} "
        f"gig_clean={params['booster_gig_clean']} gig_every={params['booster_gig_every']}  "
        f"horizon={params['horizon']}")

    if not args.smoke:
        n, s, vals, bad = identity(args.procs)
        out(f"\n## Phase 0: identity (booster_pp=0 vs {BASE}): scenarios={n} seeds={s} "
            f"values compared={vals:,} mismatches={bad}")
        record["identity"] = dict(scenarios=n, seeds=s, values=vals, mismatches=bad)

    on = dict(params, **OWNER)
    out(f"\n## Phase 1: standard gate, Booster ON, {args.runs} seeds")
    record["standard"] = {}
    all_ok = True
    for name, sc in make_scenarios().items():
        agg, finals, boost = aggregate(batch(on, sc, args.runs, args.procs))
        ok, card = scorecard(name, agg, finals, redteam=False)
        all_ok &= ok
        out(card.rstrip()); out(boost_line(boost, phi))
        record["standard"][name] = dict(gate=agg, finals=finals, boost=boost)
    out(f"\n>>> standard: {'ALL PASS' if all_ok else 'NOT ALL PASS'}")

    out(f"\n## Phase 2: red-team gate, Booster ON, {args.rt_runs} seeds (G3/G4 diagnostic)")
    record["redteam"] = {}
    rt_ok = True
    for name, sc in make_adversarial_scenarios().items():
        agg, finals, boost = aggregate(batch(on, sc, args.rt_runs, args.procs))
        ok, card = scorecard(name, agg, finals, redteam=True)
        rt_ok &= ok
        out(card.rstrip()); out(boost_line(boost, phi))
        record["redteam"][name] = dict(gate=agg, finals=finals, boost=boost)
    out(f"\n>>> red-team: {'ALL SURVIVE' if rt_ok else 'NOT ALL SURVIVE'}")

    out(f"\n## Phase 3: margin grid, {args.grid_runs} seeds per cell (pass% of the 12 or survival criteria)")
    std = make_scenarios()["baseline"]
    adv = make_adversarial_scenarios()
    sybil_name = "smart_sybil" if "smart_sybil" in adv else sorted(adv)[0]
    cells = [(pp, pr, 5) for pp in (0.05, 0.10, 0.20) for pr in (0.0, 3.0, 15.0)] + [(0.20, 3.0, 1)]
    record["grid"] = []
    out(f"  {'pp':>5} {'price':>6} {'every':>5} | {'baseline: min pass%':>20} {'extra Bound/F1':>15} | "
        f"{sybil_name + ': survival min%':>26} {'G11 med':>8}")
    for pp, pr, every in cells:
        cp = dict(params, booster_pp=pp, booster_price=pr, booster_gig_every=every)
        ab, _, bb = aggregate(batch(cp, std, args.grid_runs, args.procs))
        asy, _, _ = aggregate(batch(cp, adv[sybil_name], args.grid_runs, args.procs))
        bmin = min(v["pass_rate"] for v in ab.values()) * 100
        smin = min(asy[c]["pass_rate"] for c in SURVIVAL) * 100
        out(f"  {pp:5.2f} {pr:6.1f} {every:5d} | {bmin:20.0f} {bb['bonus_share_of_f1'] * 100:14.2f}% | "
            f"{smin:26.0f} {asy['G11']['median']:8.4f}")
        record["grid"].append(dict(pp=pp, price=pr, every=every, baseline_min_pass=bmin,
                                   bonus_share=bb["bonus_share_of_f1"], sybil_survival_min=smin,
                                   sybil_g11=asy["G11"]["median"]))

    if not args.smoke:
        here = os.path.dirname(os.path.abspath(__file__))
        open(os.path.join(here, "v7_booster_probe.txt"), "w").write("\n".join(lines) + "\n")
        with open(os.path.join(here, "v7_booster_probe.json"), "w") as f:
            json.dump(record, f, indent=1, default=float)
        print("wrote v7_booster_probe.txt and v7_booster_probe.json")


def control(args):
    """Phase 3b: the grid's missing control. Booster OFF vs the owner default and the
    stress cell at the same seeds, per criterion, so the pre-existing smart_sybil G11
    failure (v5 record) is separated from any Booster effect."""
    params = dict(DEFAULT_PARAMS, booster_pp=0.0)
    std = make_scenarios()["baseline"]
    sy = make_adversarial_scenarios()["smart_sybil"]
    cells = [("off", dict(booster_pp=0.0)), ("+5pp owner", dict(booster_pp=0.05)),
             ("+20pp every Gig", dict(booster_pp=0.20, booster_gig_every=1))]
    lines = [f"\n## Phase 3b: control at {args.grid_runs} seeds: Booster OFF vs ON, same seeds"]
    rec = []
    for scen_name, sc in (("baseline", std), ("smart_sybil", sy)):
        for label, over in cells:
            agg, finals, boost = aggregate(batch(dict(params, **over), sc, args.grid_runs, args.procs))
            fails = [f"{c} {agg[c]['pass_rate'] * 100:.0f}%" for c, _ in gatemod.GATE
                     if agg[c]["pass_rate"] < 0.95 and not (scen_name == "smart_sybil" and c in ("G3", "G4"))]
            line = (f"  {scen_name:12} {label:16} G11 median {agg['G11']['median']:.4f}  "
                    f"G1 median {agg['G1']['median']:.4f}  Gini {finals['gini']:.3f}  "
                    f"extra Bound {boost['bonus_share_of_f1'] * 100:.2f}% of F1  "
                    f"below 95%: {', '.join(fails) if fails else 'none'}")
            print(line, flush=True); lines.append(line)
            rec.append(dict(scenario=scen_name, cell=label, g11=agg["G11"]["median"],
                            g1=agg["G1"]["median"], gini=finals["gini"],
                            bonus_share=boost["bonus_share_of_f1"], below_95=fails))
    here = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(here, "v7_booster_probe.txt"), "a") as f:
        f.write("\n".join(lines) + "\n")
    jp = os.path.join(here, "v7_booster_probe.json")
    data = json.load(open(jp)) if os.path.exists(jp) else {}
    data["control"] = rec
    json.dump(data, open(jp, "w"), indent=1, default=float)
    print("appended Phase 3b to v7_booster_probe.txt/.json")


if __name__ == "__main__":
    main()
