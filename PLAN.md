# Plan: "Outfox" — a Telegram-native, economy-first GameFi on TON

> **PIVOT NOTICE 2 (2026-08-25).** Superseding the 2026-07-02 pivot below: the project
> migrates to **Solana** (Anchor programs; $ALPHA as an SPL mint with revoked mint
> authority). Migration contract and inherited conditions:
> `docs/SOLANA-FEASIBILITY.md`. Vocabulary is unified (the dev-era mechanics names are
> retired; single Outfox/$ALPHA vocabulary everywhere — `docs/THEME-OUTFOX.md`).
> Everything the 2026-07-02 notice says about what does NOT change (economy frozen, sim
> gate discipline, server-authoritative architecture, performance floor) still holds.

> **PIVOT NOTICE (2026-07-02).** The platform decision below has been **formally
> unlocked and superseded**: the project pivots to a **standalone web client (PWA) on
> Robinhood Chain** (EVM Arbitrum Orbit L2, chain ID 4663) under the adopted **Outfox**
> theme (token renamed to **$ALPHA**). This is the governance event required by
> `docs/ROBINHOOD-FEASIBILITY.md` §6 condition 6. What changes: chain, client delivery,
> auth (SIWE + embedded wallets), payments (stablecoin checkout replaces Stars),
> notifications/virality/chat (open-web stack), legal posture (US geofencing = Phase-0
> work), and distribution (self-funded — feasibility conditions 2–5 remain open, two with
> NO-GO triggers). What does not change: everything in `docs/ECONOMY.md` (frozen), the
> Torn-pillar game skeleton, the sim gate discipline, server-authoritative architecture,
> and the low-end-Android performance floor. Active UI spec: `docs/DESIGN-SYSTEM-WEB.md`.
> Theme/vocabulary: `docs/THEME-OUTFOX.md`. The body below is preserved as the original
> kickoff plan; read it through the pivot where it says TON/Telegram.

## Context

We are building a **mobile-first GameFi game inspired by Torn** (the long-running text/stat-based crime MMO whose entire identity is its deep, player-driven economy), delivered **exclusively as a Telegram Mini App on TON**. The driving requirements, in priority order: (1) a **robust, sustainable economy** that survives an earning-first ("P2E") player motivation, and (2) **UI quality as the most important deliverable**.

Why these constraints matter: ~93% of GameFi projects are dead by 2026, almost always from **emission-funded** P2E economies (faucet > sink → hyperinflation → collapse: Axie/StepN). Torn is the rare earning-first game that has lasted 20 years because it is **transfer-funded** (players earn from other players + real-money convenience spending, not from a token printer). Our entire design copies that structure and resists the crypto reflex to bolt on an emission faucet. The intended outcome of THIS plan is a clear kickoff: the documents to write first, how to validate the economy before coding, the tech architecture, and how to run the build (agent topology) on an 8GB machine.

## Locked decisions

- **Chain / channel:** ~~TON, delivered as a **Telegram Mini App only** (no standalone web/app client)~~ —
  **UNLOCKED 2026-07-02** (the governance event per `docs/ROBINHOOD-FEASIBILITY.md` §6
  condition 6) → Robinhood Chain, standalone web PWA → **UNLOCKED again 2026-08-25**
  (`docs/SOLANA-FEASIBILITY.md`) → **Solana, standalone web PWA**; Telegram survives
  only as a parked adapter seam (`docs/DESIGN-SYSTEM-WEB.md` §3.4).
- **Genre:** Torn-style deep, player-driven economy MMO (text/menu/stat-based → light to render, deep in systems).
- **Economy model:** earning-first, but **transfer-funded, not emission-funded** (the de-risk).
- **Economy is provable:** validated in **Machinations** (Monte-Carlo) before implementation.
- **Server-authoritative:** all economy logic and value decisions live server-side; client is a renderer.
- **Economy is theory-grounded:** designed on real economic theory (QTM/velocity, Gesell demurrage, Gresham, Veblen, marginal utility, Ricardo, Hardin, behavioral econ) with **Lehdonvirta & Castronova, *Virtual Economies: Design and Analysis* (MIT Press, 2014)** as the canonical reference — not GameFi folklore.

## Confirmed decisions
1. **Build workflow** — **single agent, sequential** (one module at a time). Lightest on the 8GB machine; no worktrees/parallel agents. Architecture stays modular so it can parallelize later if hardware allows.
2. **UI direction** — custom-branded UI, hard low-end-Android perf budget. *(Post-pivot:
   the platform layer is owned, not Telegram-inherited — see `docs/DESIGN-SYSTEM-WEB.md`;
   the identity-and-perf intent of this decision is unchanged.)*
3. **Sybil defense** — heuristics during play + **one-time proof-of-personhood gate ONLY
   at cash-out** (unchanged in principle). *(Post-pivot: Telegram-native signals are
   replaced by wallet-age/funding-graph clustering, and the PoP provider swaps
   HumanCode → World ID — `docs/ROBINHOOD-FEASIBILITY.md` §2, migration step 8.)*

---

## 1. Documentation-first sequence (Phase 0 — single agent)

Write these three docs in `/docs` before any game code. They become the shared contract every later agent reads.

### a. Game Design Document (`/docs/GDD.md`) — outline
1. **Vision & Pillars** — the one-line hook; 3–5 design pillars; "why play / why stay."
2. **Theme & setting** — crime/city (Torn-like) or a reskin (TBD as first GDD task).
3. **Core loop** — minute-to-minute (energy/nerve → action → reward), session loop, daily loop, long-term progression.
4. **Systems** — character/stats & training; crime/work actions; **factions**; **PvP**; **item market**; **companies**; **properties**; **stock market** (the Torn pillars).
5. **UX/UI & art direction** — Telegram Mini App constraints, design system, core screens, navigation, haptics, performance budget. (Expanded in §3.)
6. **Social / multiplayer** — factions, trading, leaderboards, Telegram-native chat, viral/referral loops.
7. **Monetization** — Telegram Stars + premium TON token; **sells convenience, never power**.
8. **Progression & live-ops** — leveling, seasons, content cadence.
9. **KPIs & economy-health metrics** — D1/D7/D30 retention, ARPU, DAU, in-game GDP, sink/faucet ratio, token velocity, wealth-concentration (Gini), sybil rate. **These are acceptance criteria, not vanity metrics.**
10. **Risks & mitigations** — economy collapse (inflation / Gresham split / velocity death), bots/sybils, **regulatory/legal**: a cashable token + earning-as-draw + **variable-ratio / loss-aversion mechanics** can trigger **gambling, securities, and money-transmission** law — bound those mechanics, separate chance from real-money value, get counsel before launch; Telegram-platform dependency.

### b. Economy Design Doc (`/docs/ECONOMY.md`) — the crux, grounded in real economic theory
**Canonical reference:** Lehdonvirta & Castronova, *Virtual Economies: Design and Analysis* (MIT Press, 2014). The doc is structured on it: a designed economy analyzed with real micro/macro/monetary/behavioral theory.

**Master model — Quantity Theory of Money (MV = PQ).** Manage inflation as a macro system: M = circulating money (soft cash + token), V = velocity, P = price level, Q = real output traded (= real in-game GDP). Target **stable P** by keeping M-growth ≈ Q-growth. Replaces the crude "sink/faucet ≥ 1" with a real macro target; all four are instrumented.

**The three existential levers (because the token is tradable):**
1. **Velocity control (V).** Prevent hoarding (V↓ → economy starves, token = pure speculation) *and* hot-potato dumping (V↑ → price collapse). Levers: **demurrage on soft cash** (Gesell — holding cost forces circulation), **staking/time-locks on the token** (cut sell pressure), spend-required sinks, transaction fees.
2. **Gresham dynamics.** "Bad money drives out good" is the two-currency failure mode: if soft cash inflates while the token appreciates under any peg, players spend cash and hoard the token → token velocity dies. Defenses: **floating (never pegged) exchange**, **token-denominated sinks** that force token spending, demurrage so cash isn't a superior hoard, strict role separation (token = store/premium access; cash = working medium).
3. **Value-accruing sinks.** A sink must *capture* value, not merely burn time. **Veblen-good** status cosmetics (demand rises with price → drain whales without unbalancing power), **auction**-based primary sales of rares (extract willingness-to-pay → treasury), **fee-burn / buyback** routing captured value to holders/treasury. Sinks ≥ faucets, but *valuable* sinks.

**Monetary + fiscal policy framing** — run the team as central-bank-plus-treasury with *pre-committed rules*, not discretion:
- *Monetary:* emission schedule, demurrage rate, staking yield → manage M & V.
- *Fiscal:* fees/taxes (sinks) + spending (events, prize pools, buyback-burn) + redistribution → manage demand & inequality. Inflation high → tighten; activity low → stimulate.

**Microfoundations (value & price):**
- **Subjective theory of value** — players earn by creating what others *subjectively value*, not by labor-grind (kills the "I grinded ∴ I'm owed a payout" ponzi logic).
- **Marginal utility** — diminishing reward returns; progressive luxury pricing.
- **Supply & demand / price discovery** — floating player markets (order books / a Torn-style Points Market), never fixed prices.
- **Comparative advantage (Ricardo)** — profession/company specialization → gains from trade → a thick interdependent economy (raises Q).
- **Auction theory** — rare primary sales + true demand reveal; sealed-bid/Vickrey to resist bot sniping.

**Commons & integrity — Tragedy of the commons (Hardin):** shared faucets/resources get over-extracted (especially by bots). Enclosure (private property/companies), quotas/rate-limits (energy/nerve caps), congestion pricing.

**Behavioral layer (engagement + conversion) — WITH guardrails:**
- **Variable-ratio reinforcement (Skinner)** for crime/loot (the engagement engine); **loss aversion** (streaks, losable territory); **endowment effect** (true ownership → attachment, lowers sell pressure); **anchoring + sunk cost** (reference pricing + sticky progression).
- **Guardrail:** variable-ratio + loss aversion + a *cashable* token = gambling-law and predatory-design exposure. Bound these mechanics, separate chance from real-money value, get counsel (see Risks).

**Two-currency mechanics (now theory-justified):** soft cash = demurrage-bearing working medium; token = scarce store-of-value / premium **convenience, not power**; earning is **player-to-player and real-money-funded, not emission-funded**; energy/nerve as throttle + sink; cash-out behind identity gate + fees + vesting.

**Instrumentation (per L&C "measuring virtual economies"):** live dashboards for M, V, P, Q (real GDP), CPI/inflation, **Gini** (inequality), token velocity, per-source faucet and per-sink efficacy.

### c. Design System (`/docs/DESIGN-SYSTEM.md`)
- Telegram theme-param mapping (`bg_color`, `secondary_bg_color`, `section_bg_color`), safe-area/viewport rules, typography/spacing scale, component inventory, motion spec (60fps target, animation-disable toggle for low-end Android), haptics map.

## 2. Economy validation (Phase 0 → gate to Phase 1)

- Model the full MV=PQ system + token flow in **[Machinations](https://machinations.io/tokenomics-design)** (Monte-Carlo) against stress scenarios: whale-inflow shock, player-count **plateau** (the Axie/StepN killer), **farmer/bot attack**, and a **Gresham split** (cash inflates while token appreciates).
- **Gate to Phase 1 — the model must hold:** bounded inflation (stable **P**), velocity **V** inside its target band (no hoard, no dump), **no Gresham hoard/dump split**, sinks that demonstrably **accrue value** (not just burn), and **Gini** within bounds.

## 3. UI/UX track (highest-priority build track)

- **Telegram-only implications:** auth via `initData` (mandatory server-side cryptographic validation); Stars + TON Connect for payments; bot for notifications/retention; TMA 2.0 full-screen + landscape for an immersive game surface.
- **Performance budget (non-negotiable):** Telegram WebView on cheap Android is the constraint — light bundle, lazy-load, millisecond-tier asset loading (Catizen's bar), animation-disable toggle. Many target users are low-end devices.
- **Benchmark:** Telegram official TMA Design Guidelines + Telegram UI kit (Figma, 25+ components / 250+ styles); deconstruct **Catizen** UX/perf.

## 4. Technical architecture / stack (grounded in current TON tooling)

- **Frontend:** React + **`@telegram-apps/sdk-react`** + Vite (official `Telegram-Mini-Apps/reactjs-template`), or Next.js 15. UI per decision #2.
- **Backend / economy engine:** Node.js + **PostgreSQL** + **Redis** (server-authoritative game state, anti-cheat, `initData` validation, rate limits). This is the heart — it owns all faucets/sinks.
- **Web3:** **TON Connect** for wallet; premium token as a **Jetton**; on-chain settlement only at deposit/withdraw boundaries (keep hot-loop economy off-chain for cost/speed, settle on-chain at the edges).
- **Repo setup (step 0):** create a dedicated project directory — **not `C:\`** — and `git init` there. Required before scaffolding *or* launching cloud agents (Ultraplan checks for a repo). Move this plan in as `PLAN.md`, then run Claude Code / Ultraplan from that folder.
- **Repo shape (monorepo):** `/apps/miniapp` (UI), `/apps/server` (backend+economy), `/contracts` (TON/Jetton), `/docs` (source of truth). Clean seams = the module build boundaries.

## 5. Build workflow (answers Q1 — single sequential agent)

- **One agent, one module at a time**, in dependency order: docs → scaffold + shared types/API contract → backend economy engine → UI → contracts → integration. No worktrees, no parallel agents.
- **Why sequential fits:** the 8GB machine is the constraint, and the economy engine is the spine everything else depends on — serializing avoids both RAM thrash and the integration drift parallel agents create.
- **Keep the architecture modular anyway** (clean seams per §4), so the build can fan out to parallel agents later on a bigger machine — but that is explicitly out of scope now.
- **8GB rule:** run only 1–2 heavy processes at a time (dev server OR build, not both + a browser); mock external services; one task in flight.

## 6. Phased roadmap

- **Phase 0 — Design & proof:** GDD + ECONOMY + DESIGN-SYSTEM docs; Machinations sim passes gate.
- **Phase 1 — Vertical slice:** scaffold + 1 core-loop action (e.g., crime → soft cash → market) playable in Telegram, server-authoritative, no token yet.
- **Phase 2 — Sequential build:** build systems per GDD in dependency order (economy engine → UI screens → Jetton + TON Connect), one module at a time.
- **Phase 3 — Economy hardening:** GDP/sink-faucet dashboards live; testnet economy dry-run; sybil heuristics tuned; cash-out PoP gate wired (pick provider — World ID / KYC vendor / TON HumanCode — used only at withdrawal).
- **Phase 4 — Launch prep:** legal review of cash-out/token; closed beta in a Telegram group; perf pass on low-end Android.

## Verification

- **Economy:** Machinations Monte-Carlo holds the §2 gate (stable P, V in band, no Gresham split, value-accruing sinks, bounded Gini) under plateau + farmer + whale-shock scenarios; live M/V/P/Q + Gini dashboards confirm the same on testnet.
- **Gameplay:** vertical slice is playable end-to-end inside the Telegram client (not a browser) with server-authoritative state.
- **UI:** core screens hit the 60fps / fast-load budget on a low-end Android device in Telegram WebView; respects theme params and safe areas.
- **Identity/economy integrity:** Telegram-native heuristics + the cash-out PoP gate demonstrably cap multi-account extraction in a red-team test before any real-money withdrawal is enabled.
