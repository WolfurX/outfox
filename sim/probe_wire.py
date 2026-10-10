"""
Wire probe (2026-10-10): Wire Calls on real Panta markets. A Wire Call costs 20 Risk
(10 of the sim's 100-bar Nerve), is taken YES or NO at the market's quoted chance p, and a
right one pays Unsettled (Bound in the sim) min(cap, 100 / p) cents; the outcome comes from
the world, one per market, shared by every player. Owner default under test: 25% of each
agent's daily Nerve spend routed to the Wire. Engine wiring and units: DEFAULT_PARAMS
"Wire probe" block in simulation.py.

Phase 0 (identity): wire_share=0 must reproduce the pre-Wire engine (git BASE) exactly,
  every value of every daily row, standard and red-team scenarios.
Phase 1 (standard gate): all 6 standard scenarios at --runs seeds (500 for the record),
  Wire ON at the owner default (Booster at its adopted default, as the canonical economy).
Phase 2 (red-team gate): the adversarial suite at --rt-runs seeds (100), Wire ON;
  survival criteria strict, G3/G4 diagnostic (README two-tier rule).
Phase 3 (stress cells): baseline + smart_sybil at --grid-runs seeds (50) with the Wire
  off (control) and four cells: (a) herd, (b) informed cohort, (c) cap off, (d) 50% share.

Run:  python probe_wire.py                 (writes v8_wire_probe.txt/.json)
      python probe_wire.py --smoke         (quick wiring check, nothing written)
      python probe_wire.py --identity      (Phase 0 only, nothing written)
"""
import argparse, contextlib, importlib.util, io, json, os, statistics, subprocess, sys, tempfile, math
from multiprocessing import Pool

from simulation import Sim, DEFAULT_PARAMS, make_scenarios, make_adversarial_scenarios
import gate as gatemod
import run as runmod

BASE = "9422153"          # last commit with the pre-Wire engine
OWNER = dict(wire_share=0.25)
SURVIVAL = ("G1", "G2", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12")
WIRE_KEYS = ("wire_calls", "wire_bound", "wire_right")
CELLS = [("control: Wire off", dict(wire_share=0.0)),
         ("owner 25%", dict(wire_share=0.25)),
         ("(a) herd, share 100%", dict(wire_herd=1.0, wire_share=1.0)),
         ("(b) informed 10%", dict(wire_edge_share=0.1, wire_share=0.25)),
         ("(c) cap off", dict(wire_cap=1e9, wire_share=0.25)),
         ("(d) share 50%", dict(wire_share=0.5))]


def _job(job):
    params, sc, seed = job
    rows = Sim(params, sc, seed=seed).run()
    g = gatemod.evaluate(rows, sc, params)
    last = rows[-1]
    wire = {k: last.get(k, 0.0) for k in WIRE_KEYS}
    wire["f1_total"] = sum(r["mint_bound"] for r in rows)
    return g, last, wire


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
    wire = {k: statistics.median(w[k] for _, _, w in out) for k in WIRE_KEYS}
    wire["share_of_f1"] = statistics.median(
        w["wire_bound"] / w["f1_total"] if w["f1_total"] else 0.0 for _, _, w in out)
    wire["hit_rate"] = statistics.median(
        w["wire_right"] / w["wire_calls"] if w["wire_calls"] else 0.0 for _, _, w in out)
    return agg, finals, wire


def scorecard(name, agg, finals, redteam):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ok = runmod.print_scorecard(name, agg, finals, redteam=redteam)
    return ok, buf.getvalue()


def wire_line(w):
    return (f"  wire: calls {w['wire_calls']:,.0f}  right {w['wire_right']:,.0f} "
            f"({w['hit_rate'] * 100:.1f}%)  Bound minted {w['wire_bound']:,.0f}¢ = "
            f"{w['share_of_f1'] * 100:.2f}% of F1")


def below(agg, scen_name=""):
    return [f"{c} {agg[c]['pass_rate'] * 100:.0f}% (median {agg[c]['median']:.4f})"
            for c, _ in gatemod.GATE if agg[c]["pass_rate"] < 0.95
            and not (scen_name == "smart_sybil" and c in ("G3", "G4"))]


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
    rn = Sim(dict(DEFAULT_PARAMS, wire_share=0.0), nscs[name], seed=seed).run()   # switched off
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
    ap.add_argument("--identity", action="store_true", help="only Phase 0 (2 seeds); writes nothing")
    args = ap.parse_args()
    if args.identity:
        n, s, vals, bad = identity(args.procs)
        print(f"## Phase 0: identity (wire_share=0 vs {BASE}): scenarios={n} seeds={s} "
              f"values compared={vals:,} mismatches={bad}")
        return
    params = dict(DEFAULT_PARAMS, wire_share=0.0)   # phases switch the Wire on explicitly
    if args.smoke:
        params.update(horizon=120, n_max=2500)
        args.runs = args.rt_runs = args.grid_runs = 4
    lines, record = [], {}

    def out(s=""):
        print(s, flush=True); lines.append(s)

    out(f"# Wire probe: owner default {OWNER['wire_share'] * 100:.0f}% of Nerve spend routed to Wire Calls, Unsettled only")
    out(f"# engine: simulation.py Wire probe block; base for identity: git {BASE}")
    out(f"# params: markets={params['wire_markets']} p~U({params['wire_p_lo']},{params['wire_p_hi']}) "
        f"base={params['wire_base']}¢ cap={params['wire_cap']}¢ call_cost={params['wire_call_cost']} Nerve "
        f"edge_acc={params['wire_edge_acc']}  booster_pp={params['booster_pp']}  horizon={params['horizon']}")

    if not args.smoke:
        n, s, vals, bad = identity(args.procs)
        out(f"\n## Phase 0: identity (wire_share=0 vs {BASE}): scenarios={n} seeds={s} "
            f"values compared={vals:,} mismatches={bad}")
        record["identity"] = dict(scenarios=n, seeds=s, values=vals, mismatches=bad)

    on = dict(params, **OWNER)
    out(f"\n## Phase 1: standard gate, Wire ON, {args.runs} seeds")
    record["standard"] = {}
    all_ok = True
    for name, sc in make_scenarios().items():
        agg, finals, wire = aggregate(batch(on, sc, args.runs, args.procs))
        ok, card = scorecard(name, agg, finals, redteam=False)
        all_ok &= ok
        out(card.rstrip()); out(wire_line(wire))
        record["standard"][name] = dict(gate=agg, finals=finals, wire=wire)
    out(f"\n>>> standard: {'ALL PASS' if all_ok else 'NOT ALL PASS'}")

    out(f"\n## Phase 2: red-team gate, Wire ON, {args.rt_runs} seeds (G3/G4 diagnostic)")
    record["redteam"] = {}
    rt_ok = True
    for name, sc in make_adversarial_scenarios().items():
        agg, finals, wire = aggregate(batch(on, sc, args.rt_runs, args.procs))
        ok, card = scorecard(name, agg, finals, redteam=True)
        rt_ok &= ok
        out(card.rstrip()); out(wire_line(wire))
        record["redteam"][name] = dict(gate=agg, finals=finals, wire=wire)
    out(f"\n>>> red-team: {'ALL SURVIVE' if rt_ok else 'NOT ALL SURVIVE'}")

    out(f"\n## Phase 3: stress cells, {args.grid_runs} seeds per cell (baseline and smart_sybil; "
        f"criteria below 95% listed with their G-line)")
    std = make_scenarios()["baseline"]
    adv = make_adversarial_scenarios()
    sybil_name = "smart_sybil" if "smart_sybil" in adv else sorted(adv)[0]
    record["cells"] = []
    for label, over in CELLS:
        cp = dict(params, **over)
        row = dict(cell=label, params=over)
        for scen_name, sc in (("baseline", std), (sybil_name, adv[sybil_name])):
            agg, finals, wire = aggregate(batch(cp, sc, args.grid_runs, args.procs))
            fails = below(agg, scen_name)
            line = (f"  {label:22} {scen_name:12} G1 median {agg['G1']['median']:.4f}  "
                    f"G11 median {agg['G11']['median']:.4f}  Gini {finals['gini']:.3f}  "
                    f"Wire Bound {wire['share_of_f1'] * 100:.2f}% of F1  "
                    f"below 95%: {'; '.join(fails) if fails else 'none'}")
            out(line)
            row[scen_name] = dict(g1=agg["G1"]["median"], g11=agg["G11"]["median"],
                                  gini=finals["gini"], wire=wire, below_95=fails,
                                  survival_min=min(agg[c]["pass_rate"] for c in SURVIVAL) * 100)
        record["cells"].append(row)

    if not args.smoke:
        here = os.path.dirname(os.path.abspath(__file__))
        open(os.path.join(here, "v8_wire_probe.txt"), "w").write("\n".join(lines) + "\n")
        with open(os.path.join(here, "v8_wire_probe.json"), "w") as f:
            json.dump(record, f, indent=1, default=float)
        print("wrote v8_wire_probe.txt and v8_wire_probe.json")


if __name__ == "__main__":
    main()
