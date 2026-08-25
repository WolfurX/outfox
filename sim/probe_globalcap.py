"""
AUDIT-2 SS10 queue item: model the Settlement's GLOBAL rolling withdrawal cap
(leaky-bucket windowCap; daily granularity -> per-tick release budget, wd_global_cap)
and re-judge smart_sybil (G11) with it.

Phase A (sizing): honest mature release volume from the baseline scenario -- the
  contract guidance is "size windowCap near real daily withdrawal volume"
  (contracts/README.md), so the candidate caps are anchored to measured honest flow.
Phase B (re-judge): smart_sybil at escalating mule counts k, cap off vs on.
  The claim under test (M4/AUDIT-2 SS10): split-identity extraction is bounded by
  min(k * w_cap_weekly, windowCap_daily * 7) -- i.e. the linear-in-k residual G11
  documents becomes a CAP once k crosses windowCap*7/w_cap, independent of PoP quality.
  The k=12 cap-off cell must reproduce the committed v5 G11 (~5.4% median): the cap
  default-off engine is the v5 engine, exactly.

Run:  python probe_globalcap.py            (writes v6_globalcap_redteam.txt)
"""
import statistics
from multiprocessing import Pool

from simulation import Sim, Scenario, DEFAULT_PARAMS, make_scenarios
import gate as gatemod

SEEDS_SIZING = 25
SEEDS_JUDGE = 100
PROCS = 8
OUT = "v6_globalcap_redteam.txt"

# survival-strict set for red-team scenarios (README two-tier rule; G3/G4 diagnostic)
SURVIVAL = ("G1", "G2", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12")


def _run(job):
    params, sc, seed = job
    rows = Sim(params, sc, seed=seed).run()
    g = gatemod.evaluate(rows, sc, params)
    mature = rows[-150:]
    return dict(
        g11=g["G11"]["value"], g11_pass=g["G11"]["passed"],
        survival=all(g[c]["passed"] for c in SURVIVAL),
        fails=[c for c in SURVIVAL if not g[c]["passed"]],
        bot=rows[-1]["cashout_by_bot"], total=rows[-1]["cashout_total"],
        escrow=rows[-1]["wd_escrow"],
        rel_med=statistics.median(r["wd_released"] for r in mature),
        rel_p95=sorted(r["wd_released"] for r in mature)[int(0.95 * len(mature))],
    )


def batch(params, sc, seeds):
    jobs = [(params, sc, s) for s in range(seeds)]
    with Pool(PROCS) as pool:
        return pool.map(_run, jobs)


def med(rs, k):
    return statistics.median(r[k] for r in rs)


def main():
    lines = []

    def emit(s=""):
        print(s, flush=True)
        lines.append(s)

    p0 = dict(DEFAULT_PARAMS)

    # ---- Phase A: honest release volume (baseline, cap off) ----
    emit("== Phase A: honest mature release volume (baseline, %d seeds) ==" % SEEDS_SIZING)
    base = batch(p0, dict(make_scenarios())["baseline"], SEEDS_SIZING)
    hon_med, hon_p95 = med(base, "rel_med"), med(base, "rel_p95")
    emit("  mature wd_released per tick: median %.1f  p95 %.1f  ($ALPHA/day)" % (hon_med, hon_p95))
    # candidates: "near real daily volume" (1x p95, the contract guidance) and a
    # generous 2x for sizing sensitivity
    cap1 = round(hon_p95)
    cap2 = 2 * cap1
    emit("  candidate caps: 1x p95 = %d/day (weekly %d)   2x = %d/day" % (cap1, cap1 * 7, cap2))
    for k in (12, 50, 200):
        emit("  ring ceiling min(k*w_cap, cap*7)/wk at k=%-3d: per-id %d  vs cap1x %d  cap2x %d"
             % (k, k * int(p0["w_cap"]), cap1 * 7, cap2 * 7))
    emit()

    # ---- Phase B: smart_sybil re-judge ----
    emit("== Phase B: smart_sybil re-judge (%d seeds/cell; G11 bar < 5%%) ==" % SEEDS_JUDGE)
    emit("  %-6s %-10s | %-6s %-8s | %-12s %-12s | %-10s %s"
         % ("mules", "cap/day", "G11%", "pass%", "bot cashout", "total", "escrow_end", "notes"))
    cells = [(12, 0.0), (12, cap1), (50, 0.0), (50, cap1), (200, 0.0), (200, cap1), (200, cap2)]
    for k, cap in cells:
        sc = Scenario("smart_sybil", bot_share=0.30, funnel=True, n_mules=k,
                      adversary="smart_sybil")
        pp = dict(p0, wd_global_cap=cap)
        rs = batch(pp, sc, SEEDS_JUDGE)
        g11_med = med(rs, "g11") * 100
        g11_pr = 100 * sum(r["g11_pass"] for r in rs) / len(rs)
        surv = 100 * sum(r["survival"] for r in rs) / len(rs)
        fail_counts = {}
        for r in rs:
            for c in r["fails"]:
                fail_counts[c] = fail_counts.get(c, 0) + 1
        notes = " ".join("%s:%d" % (c, n) for c, n in sorted(fail_counts.items())) or "-"
        emit("  %-6d %-10s | %5.2f%% %6.0f%% | %12.0f %12.0f | %10.0f | surv %3.0f%%  fails %s"
             % (k, ("off" if cap == 0 else "%d" % cap), g11_med, g11_pr,
                med(rs, "bot"), med(rs, "total"), med(rs, "escrow"), surv, notes))
    emit()
    emit("regression: the (12, off) cell is the v5 engine exactly -- compare G11 median")
    emit("to v5_redteam_100.txt smart_sybil (~5.4%).")

    with open(OUT, "w") as f:
        f.write("\n".join(lines) + "\n")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
