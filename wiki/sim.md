# sim — the economy's proof machine

**Canon:** `sim/README.md` (status + the two-tier gate), `sim/AUDIT-2.md` (the audit
trail — the honest record of every round), `docs/ECONOMY-SIM-SPEC.md` (original spec).

## The gate

G1–G12 (`sim/gate.py`) across 6 standard scenarios at ≥500 seeds = the Phase-0→Phase-1
shipping gate ("no economy code ships until it passes"). Red-team suite (7 attack
scenarios) enforces the survival criteria strictly; G3/G4 are under-attack diagnostics
(the two-tier rule). **Current: standard 6/6; red-team 6/7** (open: smart_sybil G11 —
product-level PoP quality).

## Round history (details: AUDIT-2 §§1–11)

| Round | What happened |
|---|---|
| v1→v2 | Independent audit found unfailable gates → rebuild: exact conservation ledgers, failable gates, mechanisms implemented for real |
| audit-2 | 17-agent verification; 14 new findings; fixes + open queue |
| v3 | Seasoning, real unbonding, protocol-funded AMM, procyclical demand, Commons sink; honest AMM depth broke pump_dump/bank_run |
| v4 | §13.B market defenses (flow cap, vol-fee, TWAP jitter) → closed the market-manipulation class (5/7) |
| v5 | §13.D whale-tail levers + honest-metric fix (unbonding visible) → closed whale_market (6/7); 21-lever sweep, zero knife-edges |
| v6/6b | Operator revenue: F3 take [0,0.9] and cash-out-fee take [0,1.0] proven zero-dynamic-effect |
| v6c | The Settlement's **global withdrawal cap modeled** (`wd_global_cap`, release-side FIFO leaky bucket; 0 = v5 engine, regression exact-to-the-cent); smart_sybil re-judged at k=12/50/200: the cap never binds the ring (acquisition-bound at ~2% of its exit ceiling) and cannot move the G11 *share* — **no throughput cap is a sybil defense; PoP quality is the binding lever, now unconditionally** (AUDIT-2 §11, `v6_globalcap_redteam.txt`) |
| queued | Round-7 external open-market scenario (§9); split-hoard variant; burst-exit mule variant; basket CPI; cadCAD port |

## How to run (this machine)

Python 3.12 at `%LOCALAPPDATA%\Programs\Python\Python312\python.exe`, numpy installed;
set `PYTHONUTF8=1` (cp1252 crashes the scorecard). ~15 s/sim under load; full standard
500-seed suite ≈ 1.5 h at `--procs 8`.
`run.py --scenario all|redteam|<name> --runs N --procs 8` · `sweep.py --procs 8`.

## Discipline (learned the hard way, worth keeping)

Every claim ties to a committed artifact; negative results are recorded; zero-points
must reproduce the prior engine bit-for-bit; adversarial review before canonizing —
reviews of rounds 5/6 each overturned a first-draft justification with a stronger one.

as-of: 98ffc78
