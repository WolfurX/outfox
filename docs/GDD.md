# Game Design Document — "Outfox" (working title)

> **Status:** Phase 0 draft. This is the top-level design contract. The economy is
> specified in depth in [`ECONOMY.md`](./ECONOMY.md); the UI/visual language in
> [`DESIGN-SYSTEM-WEB.md`](./DESIGN-SYSTEM-WEB.md) (the standalone-client v2;
> [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) is the archived Telegram-track v1). Where this
> doc and `ECONOMY.md` disagree on an economic rule, **`ECONOMY.md` wins** (it is the
> priority-#1 contract).
>
> **PIVOT (2026-07-02, recorded in `PLAN.md`):** the delivery platform is now a
> **standalone web PWA on Robinhood Chain**, and the adopted player-facing theme is
> **Outfox** ($ALPHA) per [`THEME-OUTFOX.md`](./THEME-OUTFOX.md). **Mechanics, systems,
> and economy in this document are unchanged and remain canonical.** The Outfox
> vocabulary below stays the internal mechanics-layer naming; `THEME-OUTFOX.md` §2 is the
> authoritative translation to player-facing copy. Telegram-specific platform passages
> below (§5, §6, §7, §10.4) are superseded as marked.

---

## 1. Vision & Pillars

**One-line hook:** *A persistent, player-run economy — where every dollar you earn was
lost by another player, not minted by a faucet.* *(Post-pivot fiction: outlaw traders vs
the Houses — `THEME-OUTFOX.md` §1.)*

We are building a **mobile-first, text/menu/stat-based MMO** in the lineage of **Torn** —
the 20-year-old crime MMO whose entire identity is a deep, player-driven economy —
delivered as a **standalone web PWA on Robinhood Chain** *(pivot 2026-07-02; originally a
Telegram Mini App on TON)*. We keep Torn's structure; the fiction layer is **Outfox**
(`THEME-OUTFOX.md`), with the crypto-underworld reskin below retained as internal
mechanics vocabulary.

The two driving requirements, in priority order:
1. **A robust, sustainable economy** that survives an earning-first ("P2E") player motivation.
2. **UI quality** — the single most important deliverable after the economy holds.

**Design pillars:**
1. **The economy is the game.** Markets, scarcity, trade, and player-vs-player value
   transfer are the content. Combat and "missions" exist to feed the economy, not vice-versa.
2. **Transfer-funded, never emission-funded.** You earn from *other players* and from
   real-money convenience spend — not from a token printer. This is the de-risk that lets an
   earning-first game last (see `ECONOMY.md`). No "log in, mint free tokens" faucet.
3. **Deep systems, light to render.** Torn-style menus and stats: tiny bundle, instant load,
   60 fps on a $80 Android — but years of progression depth underneath.
4. **Server-authoritative truth.** The client renders; the server owns every value decision,
   faucet, and sink. The player can never compute their own reward.
5. **Convenience, never power.** Real money (Telegram Stars / the premium token) buys time,
   slots, and cosmetics — never stats, never an in-fiction win. Pay-to-win breaks both the
   economy and the regulatory posture.

**Why play / why stay:** *Play* — fast, satisfying "one more hack" loop with real stakes.
*Stay* — a persistent reputation, a syndicate that needs you, owned assets that appreciate,
and a market you can outsmart. Mastery is economic, not reflexive.

---

## 2. Theme & setting — **crypto-native reskin** (the locked theme)

We retain Torn's mechanical skeleton and reskin the fiction to the **crypto underworld**: a
sprawling digital black market of exchanges, protocols, and rival syndicates. This vocabulary
is **canonical** and used identically across all docs and the codebase.

### 2.1 Reskin mapping (Torn term → our term)

| Torn concept | Outfox reskin | Notes |
|---|---|---|
| Crimes | **Exploits / Jobs** (hacks, rug-pulls, phishing ops, exchange heists) | Variable-ratio reward source; the core engagement action |
| City / map | **The Network** — districts are protocols/exchanges (e.g. *The DEX*, *The Bridge*, *The Mixer*, *Cold Storage*) | Navigation surface; gates actions by reputation/level |
| Factions | **Syndicates** | Player-run guilds; territory, war, shared treasury |
| Item market / bazaar | **The Market** — a Torn-style order-book **"Points Market"** | Player-to-player price discovery; never fixed prices |
| Companies / jobs | **Operations** (front companies: mixers, OTC desks, mining pools, validator farms) | Player-owned businesses; employ other players; raise real GDP (Q) |
| Properties | **Safehouses / Servers** | Status + utility assets; demurrage-shelter and slot bonuses (bounded) |
| Stock market | **The Exchange** — in-game speculative instruments | An *internal* market in fictional "stocks"; distinct from the real TON token |
| Hospital / jail | **Quarantine / Traced** (downtime states after losing PvP or a failed job) | Loss-aversion + a time sink |
| Energy / Nerve | **Compute (E) / Heat-tolerance (Nerve)** | The two throttles that gate actions (see Core Loop) |

> **Two soft "stats-bar" resources, renamed but mechanically Torn's:** **Compute** (≈ Energy,
> spent on training/work) and **Nerve** (≈ Nerve, spent on Exploits). Both regenerate over
> real time and are the primary pacing throttle and a natural sink for convenience refills.

### 2.2 Currencies (names are canonical — see `ECONOMY.md` for full mechanics)
- **Credits (¢)** — the **soft cash** working medium. Demurrage-bearing (a holding cost),
  earned and spent in-game, **not** directly cashable. Two provenances: **Clean Credits** (from
  P2P trade, Operations, the Market) are transferable and swappable to $ALPHA; **Bound Credits**
  (from chance outcomes — Exploit loot, PvP RNG) are **non-transferable, non-exchangeable,
  sink-only**, so chance-won value can never reach cash-out (see `ECONOMY.md` §6/§9). The
  everyday currency.
- **$ALPHA (Jetton)** — the **premium TON token**: scarce store-of-value + premium-convenience
  access. Floating exchange vs Credits (**never pegged**). The only cashable asset, behind the
  cash-out gate. Sells convenience, never power.

> Naming note (updated at the pivot): the adopted public names are **Outfox** (game) and
> **$ALPHA** (token) per `THEME-OUTFOX.md` — **Outfox** and **$ALPHA** remain the internal
> mechanics-layer vocabulary used across this doc, `ECONOMY.md`, and the sim. Availability
> checks (trademark / domain / handles on Outfox and the $ALPHA ticker) are **still
> pending** — do not bake any literal name strings into contracts or on-chain token
> metadata until they clear. The *roles* (the game; a premium cashable token — now an
> ERC-20 on Robinhood Chain rather than a TON Jetton) are locked.

---

## 3. Core loop

**Minute-to-minute (the "one more" loop):**
`Spend Compute/Nerve → take an action (Exploit / train / work an Operation) → variable reward
(Credits, items, rep, XP) → bank/spend/trade → resources regenerate → repeat.`

- **Exploits** consume **Nerve**, pay out on a **variable ratio** (the engagement engine —
  guard-railed, see Risks & `ECONOMY.md`): Credits, loot items, reputation, and risk of being
  **Traced** (downtime) on failure.
- **Training** consumes **Compute** at the **Gym → "Rig"** to raise the four core stats.
- **Operations work** consumes Compute for steadier, lower-variance Credit income (the "job"
  counterweight to gambling-flavored Exploits).

**Session loop (5–15 min):** burn banked Compute/Nerve, check Market orders, manage syndicate
duties, react to who attacked you.

**Daily loop:** regen windows + daily objectives + syndicate war ticks + Market arbitrage;
designed so a lapsed player loses *relative position*, never absolute assets (loss aversion,
bounded).

**Long-term (weeks→months):** stat progression, rep tiers unlocking deeper Network districts,
building/scaling an Operation, climbing syndicate ranks, accumulating appreciating assets, and
mastering the Market/Exchange. **Progression depth is the retention engine** — there is always
a next tier, and economic mastery has no ceiling.

---

## 4. Systems (the Torn pillars, reskinned)

1. **Character & stats.** Four core stats (working names): **Strength→Cracking,
   Speed→Latency, Defense→Hardening, Dexterity→Stealth**. Trained at the **Rig** by spending
   **Compute** (the resource). *(Note: "Cracking" — brute-force/key-cracking power — replaces the
   earlier "Compute-power" so the stat name doesn't collide with the Compute resource.)* Stats
   gate PvP and high-tier Exploits. *Server computes all stat gains.*
2. **Exploits / Jobs (crime actions).** Tiered action list per Network district; success
   probability scales with stats + tools; variable-ratio rewards; failure → **Traced** downtime.
3. **Syndicates (factions).** Player guilds with ranks, a **shared treasury** (Credits +
   $ALPHA), territory control over Network districts, organized **wars** (loss-aversion: losable
   territory), and chains/assists. The primary social-retention and end-game driver.
4. **PvP.** Attack other players for Credits/items/rep; outcome from stats + tools + chance
   (bounded). Loser enters **Quarantine** downtime, never loses everything (loss-aversion within
   guardrails). PvP is a **P2P value-transfer faucet**, not a mint.
5. **The Market (item market).** Order-book P2P exchange for items/tools/loot — true price
   discovery, never fixed prices. Charges a **transaction fee** (a core sink). The thick,
   interdependent trade layer that raises real in-game GDP (**Q**).
6. **Operations (companies).** Player-owned businesses that **employ other players**, convert
   inputs→outputs, and create specialization & gains from trade (Ricardo). The main engine of
   *productive* (non-extractive) earning and a major Q contributor.
7. **Safehouses / Servers (properties).** Status + utility assets (slot bonuses, bounded
   demurrage shelter, regen perks). Sink for accumulated Credits; some are **Veblen-good**
   status items.
8. **The Exchange (stock market).** Internal speculative instruments (fictional "protocol
   stocks") — an advanced-player money game and Credit sink/cycler. **Strictly separated** from
   the real $ALPHA token to bound securities-law exposure (see Risks).

---

## 5. UX/UI & art direction

Full spec in [`DESIGN-SYSTEM-WEB.md`](./DESIGN-SYSTEM-WEB.md) *(supersedes the
Telegram-track summary that stood here)*. Summary constraints:
- **Standalone installable PWA, owned end to end** — own theme (terminal-noir dark
  canonical + light), own auth (guest → embedded wallet → SIWE), own install/notification
  surfaces. One codebase across mobile browser, installed PWA, desktop, and wallet
  in-app browsers.
- **Performance budget (non-negotiable, unchanged):** low-end Android in a plain mobile
  browser is the floor; CI gates on Core Web Vitals (LCP ≤ 2.5 s, INP ≤ 200 ms, ≤ 170 KB
  critical path); **60 fps with an animation-disable toggle**.
- **Desktop is now a first-class surface** (three breakpoints; trading-floor Wide layout)
  — additive, never the baseline.
- **Core screens:** Home/status, district list, Exploit/action list, training, Market
  (order book), Syndicate, Operations, value/Ledger screen, Exchange — per-breakpoint
  specs and player-facing names in `DESIGN-SYSTEM-WEB.md` §2/§7.
- **Navigation:** bottom tab bar at phone widths, nav rail wider; menu/stat-driven, not
  scene-rendered (keeps the bundle tiny — pillar #3).

---

## 6. Social / multiplayer

- **Syndicates** (above) are the backbone: shared treasury, wars, chat, ranks.
- **Trading** via the Market + direct P2P transfers (fee'd).
- **Leaderboards:** rep, net worth, syndicate power — framed to reward *economic* mastery.
- **Chat & notifications (post-pivot):** no freeform in-app chat in Phase 1 — Discord is
  the canonical social layer with structured in-app comms (pinned board, preset tactical
  pings); retention notifications via Web Push + email + Discord mirror
  (`DESIGN-SYSTEM-WEB.md` §14/§16 — supersedes the Telegram bot/chat lines that stood
  here).
- **Viral / referral loops (post-pivot):** guest-play-first referral links with
  server-side first-touch attribution (`DESIGN-SYSTEM-WEB.md` §15); referral rewards paid
  in **convenience** (Compute refills, account-bound cosmetics), **never** in cashable
  value or Commons standing (sybil-resistance — see §10 and `ECONOMY.md`).

---

## 7. Monetization

- **Two rails (post-pivot):** **USD-priced convenience checkout** settling in stablecoin
  (USDG/USDC) from the embedded wallet — the F3 rail replacing Telegram Stars — and the
  **premium $ALPHA/$ALPHA token** (ERC-20 on Robinhood Chain) for the premium tier and the
  cash-out boundary (F4). Flows specced in `DESIGN-SYSTEM-WEB.md` §11/§12. Measured F3
  conversion is a feasibility NO-GO trigger (`ROBINHOOD-FEASIBILITY.md` §6 condition 3).
- **What money buys:** Compute/Nerve refills, extra Operation/Market slots, cosmetic skins,
  faster regen, name reservations — **time and self-expression**.
- **What money NEVER buys:** stats, guaranteed Exploit/PvP outcomes, exclusive *power* items.
  **Sells convenience, never power** — pillar #5. This is both an economy invariant and the
  spine of the regulatory posture (§10).
- Convenience spend is also a **real-money-funded faucet** input (it injects external value
  that other players ultimately earn) — the transfer-funded model, see `ECONOMY.md`.

---

## 8. Progression & live-ops

- **Leveling:** XP from actions → levels → rep tiers → deeper Network districts + new Exploits.
- **Seasons:** time-boxed competitive cycles (syndicate-war seasons, leaderboard resets of
  *ranking*, not assets) with cosmetic/title rewards.
- **Content cadence:** new districts, Operation types, items, and events on a regular schedule;
  live-ops events double as **fiscal-policy tools** (prize pools = stimulus; entry fees = sinks)
  per `ECONOMY.md`.

---

## 9. KPIs & economy-health metrics — **acceptance criteria, not vanity**

These are pass/fail gates, instrumented from day one (dashboards specified in `ECONOMY.md`):
- **Retention:** D1 / D7 / D30.
- **Monetization:** ARPU, ARPPU, conversion %.
- **Engagement:** DAU / MAU, session length.
- **Economy health (the ones that actually matter):**
  - **In-game GDP (Q)** — real value of goods/services traded.
  - **Inflation / CPI & price level (P)** — must stay bounded.
  - **Money supply (M)** and **velocity (V)** — V must sit inside a target band (no hoard,
    no dump).
  - **Sink/faucet ratio** per source and per sink (and **sink efficacy** — does it *capture*
    value or just burn time?).
  - **Token velocity** of $ALPHA specifically.
  - **Wealth concentration (Gini)** — must stay within bounds.
  - **Sybil / bot rate** — multi-account extraction must stay capped.

> If these fail, the game fails, regardless of DAU. They gate every phase.

---

## 10. Risks & mitigations

1. **Economy collapse** (the GameFi killer): hyperinflation, Gresham hoard/dump split,
   velocity death. **Mitigation:** the entire `ECONOMY.md` design (MV=PQ management,
   demurrage, floating exchange, value-accruing sinks) + a **Machinations Monte-Carlo gate**
   that must pass before any economy code ships.
2. **Bots / sybils** draining shared faucets (tragedy of the commons). **Mitigation:**
   Telegram-native heuristics during play + **one-time proof-of-personhood gate ONLY at
   cash-out**; rate-limits/quotas on Compute/Nerve; referral rewards in convenience only.
3. **Regulatory / legal — the sharpest risk.** A **cashable token + earning-as-draw +
   variable-ratio / loss-aversion mechanics** can simultaneously trigger **gambling**,
   **securities**, and **money-transmission** law. **Mitigations (design-level):**
   - **Separate chance from real-money value:** variable-ratio Exploit/PvP outcomes pay *Bound
     Credits* — a non-transferable, non-exchangeable, sink-only balance — never $ALPHA and never
     transferable Credits, so **no chance-origin value can reach cash-out** (invariant enforced
     by server-side provenance/taint tracking; `ECONOMY.md` §6/§9/§11). The cashable boundary is
     additionally gated, fee'd, vested, and PoP-verified.
   - **Bound the behavioral mechanics** (caps on loss, no real-money loot boxes).
   - **Separate the internal Exchange (fictional stocks) from the $ALPHA token** to limit
     securities exposure.
   - **Get counsel before launch** (legal review is an explicit Phase-4 gate in `PLAN.md`).
4. **Platform dependency (rewritten at the pivot):** chain-level deplatforming risk is
   near zero (Robinhood Chain is permissionless for third-party contracts), but
   **distribution is now self-funded** — no host-app funnel exists, and curated surfaces
   (wallet browsers, quest platforms) are soft gates. The Telegram-era mitigation
   survives as architecture: the economy is server-authoritative, the client is a thin
   renderer, and all platform capabilities sit behind the PlatformAdapter seam
   (`DESIGN-SYSTEM-WEB.md` §3) — including a parked Telegram adapter. Discord (the
   Phase-1 social layer) is a new platform dependency of the old kind; its exit-hatch
   review is scheduled (`DESIGN-SYSTEM-WEB.md` §16). Residual: sequencer trust and the
   young chain's operational maturity (`ROBINHOOD-FEASIBILITY.md` §3).

---

## 11. Open questions (resolve as design proceeds)

- Final stat names & count (4 core stats assumed, Torn-style; player-facing names now
  Conviction / Execution / Discipline / Edge per `THEME-OUTFOX.md` §2).
- Trademark / domain / handle availability checks on **Outfox** and the **$ALPHA** ticker
  (see `THEME-OUTFOX.md` §7) before any on-chain lock-in.
- Exact district roster and unlock order (player-facing district names now fixed by
  `THEME-OUTFOX.md` §2 — The Street's seven districts).
- Whether the internal Exchange ships in Phase 1 (likely deferred — advanced-player system).
