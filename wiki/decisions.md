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
| 2026-09-12 | **Architecture doc set adopted**: `PRD.md`, `ARCHITECTURE.md`, `INFRASTRUCTURE.md` new, `GDD.md` rewritten; `PLAN.md` = kickoff record; decisions A6–A8, A10, A11, A13–A15 proposed, awaiting the owner | repo `CLAUDE.md`, `docs/ARCHITECTURE.md` §18 |
| 2026-09-12 | **Street mapping follows the published whitepaper** (owner): The Floor = Gigs, Options Alley = Calls, The Pit = Raids, The Dark Pool = quiet market, After Hours = endgame; the shipped tab corrected, three districts open | `docs/GDD.md` §2.1, `apps/web/src/Street.tsx` |
| 2026-09-12 | **Architecture decisions A6–A8, A10, A11, A13–A15 adopted** (owner, go on all eight): opaque sessions not JWT; no live feed until needed, then poll, then SSE; in-process jobs at beta; PoP as server-side vendor verification recorded as an identity event; F3 purchases deposit-shaped in USDC; CI as a pre-beta item; policy registry before live tuning; single $ALPHA gate + drift audit with the module move | `docs/ARCHITECTURE.md` §18, DSW §10.2 note |
| 2026-09-12 | **Mechanics-layer vocabulary exception** (owner): the frozen economy canon and `sim/` keep Credits/Clean/Bound/Exploits/Compute/Nerve/Operations/Safehouses/Quarantine; everything else canonical; `GDD.md` §2.4 is the bridge | repo `CLAUDE.md`, `docs/THEME-OUTFOX.md` status note |
| 2026-10-02 | **$ALPHA launches through Meteora** (owner): bonding curve creates the mint and funds a permanently locked DAMM v2 pool; reverses the earlier no-bonding-curve line because the adopted shape (USDC, one gentle segment, opening fee against sniping, 12% of supply through Meteora) is not the pump-style launch that line ruled out; mainnet band and depth stay open | `docs/LAUNCH.md`, `docs/ARCHITECTURE.md` A16, `programs/deployments/devnet-launch.md` |
| 2026-10-02 | **Beta purchases unparked** (owner): domain and a small VPS; Colosseum scope = beta live on devnet, a public economy page, the launch on devnet | `docs/PRD.md` §8 |

as-of: solana-migration commit (2026-08-25)
