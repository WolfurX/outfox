# decisions — owner-decision chronology

Why things are the way they are, dated, with where each is recorded. (Locked/confirmed
decisions pre-pivot are in `PLAN.md` §Locked/§Confirmed.)

| Date | Decision | Recorded |
|---|---|---|
| 2026-06-26 | Project kickoff: Torn-style economy-first GameFi; transfer-funded, never emission-funded; economy sim-proven before code; server-authoritative; theory-grounded (L&C canon) | `PLAN.md` |
| ~2026-06-30 | v1 sim audit → honest rebuild (v2: failable gates, exact conservation) | `sim/README.md`, `ROBINHOOD-FEASIBILITY.md` §1 |
| 2026-07-02 | **Platform pivot**: TON/Telegram → standalone web PWA on Robinhood Chain; token renamed to $ALPHA (theme layer); ECONOMY.md frozen through it | `PLAN.md` pivot notice, `ROBINHOOD-FEASIBILITY.md` §6 |
| 2026-07-02 | Theme: TAPE → **Outfox** (Foxes, Skulks, Scrip, the Book, the Commons) | `THEME-OUTFOX.md` |
| 2026-07-11 | Round-5: §13.D whale-tail levers (progressive carry + wealth-indexed primary issuance); honest-metric fix | `ECONOMY.md` §13.D, `sim/AUDIT-2.md` §7 |
| 2026-07-11 | Two-layer vocabulary rule made explicit + mechanically guarded; **conversation uses $ALPHA** | repo `CLAUDE.md`, `apps/server/test/vocab-guard.test.ts` |
| 2026-07-11 | Confirmed: Robinhood Chain, KISS (owner alignment for Phase-2 chain work) | this file; contracts `README.md` |
| 2026-07-11 | **Operator revenue** (ECONOMY §3): F4 fiat = 100% operator; F3 split (`op_take_f3`, proven [0, 0.9]); **boundary fees = revenue** (`op_take_wdfee`, proven [0, 1.0]); in-loop value never. Rule: a fee is revenue only where real value was leaving anyway | `ECONOMY.md` §3, `sim/AUDIT-2.md` §8/§8b |
| 2026-07-11 | **Data-oriented design** (standing): append-only events, full holder/DEX indexing, live metrics = sim estimators | `docs/DATA-ARCHITECTURE.md` |
| 2026-07-11 | External open market: accepted as inevitable (permissionless ERC-20); playability decoupled from price by role separation (probes: token −97% ⇒ game-side gates all green); round-7 scenario queued, POL seeding recommended | `sim/AUDIT-2.md` §9, `sim/v6_extdump_probe.txt` |
| 2026-07-11 | **llm-wiki adopted** for internal navigation — non-normative, canon always wins | `wiki/CLAUDE.md` |

| 2026-08-25 | **Solana migration** (owner decision): port everything, rewrite only the chain edge as Anchor programs; conditions framework inherited from the prior pivot | `docs/SOLANA-FEASIBILITY.md` |
| 2026-08-25 | Fresh-history public-facing repo; predecessor development history stays private (provenance: founders' notes) | this file |
| 2026-08-25 | **Name finalized: Outfox**; vocabulary unified — two-layer rule retired, dev names (MEMPOOL/$VIG) survive only in immutable records; sim rename proven pure by identical-seed A/B diff | `docs/THEME-OUTFOX.md`, `sim/README.md` note, vocab-guard test |

as-of: solana-migration commit (2026-08-25)
