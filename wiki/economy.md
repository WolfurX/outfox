# economy — the system in one page

**Canon:** `docs/ECONOMY.md` (priority #1 — wins every conflict; read its pivot banner).
**Proof:** `sim/` — gate G1–G12, standard 6/6 at 500 seeds, red-team 6/7 (`sim/README.md`).

## The thesis

Transfer-funded, never emission-funded: players earn from other players + real-money
convenience spend; there is no token printer. Managed as MV=PQ macro (stable P), run as
central-bank-plus-treasury with **pre-committed published rules, never discretion** (§3).

## Two currencies, one firewall

- **Scrip** (mechanics: Credits, ¢) — the working medium; demurrage-bearing (progressive
  above a threshold); **not cashable**. Chance winnings are **Unsettled** (mechanics:
  Bound): sink-only, never exchangeable — the provenance firewall (§6/§7) that keeps
  chance away from real-money value (the load-bearing legal/economic invariant, G10).
- **$ALPHA** (mechanics: $ALPHA) — see `alpha.md`.

## The levers (all swept; production values must sit in proven intervals)

| Lever family | Canon | Proven record |
|---|---|---|
| Demurrage (base + progressive) + §13.A idle decay | §2.1, §13.A | sweep: load-bearing (`alpha_idle_decay_mult=0` fails) |
| §13.B market defenses (TWAP ops, flow cap, vol-fee, jitter) | §13.B | closed pump_dump + bank_run (v4) |
| §13.C seasoning + unbonding | §13.C | wash-proof exit surcharge; residual = PoP quality |
| §13.D whale-tail (progressive carry + wealth-indexed F4) | §13.D | closed whale_market (v5, α 2.80); split-identity residual named |
| Operator revenue splits | §3 | `op_take_f3` [0,0.9], `op_take_wdfee` [0,1.0] (AUDIT-2 §8/§8b) |
| Commons sink (charity-for-status) | §2.3, THEME §4 | the Gini lever (not gate-load-bearing) |

## Known residuals (honest bounds — AUDIT-2)

smart_sybil G11 (PoP quality — product-level, the only red-team failure) · §13.D
split-identity evasion (per-identity measurement; product defense = purchase-identity
binding) · external market unmodeled (round-7 queued, §9; playability proven decoupled
from price) · basket CPI still reduced-form · payer-mix assumption guards the Gini
result (instrument at launch — `DATA-ARCHITECTURE.md`).

as-of: 8e5560e
