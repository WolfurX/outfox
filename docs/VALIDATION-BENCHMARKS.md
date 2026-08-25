# Outfox Phase-0 — Validation & Benchmark Report

*Lead reviewer final report. Inputs: (1) adversarial re-check of the Phase-0 docs (`PLAN.md`, `docs/ECONOMY.md`, `docs/GDD.md`, `docs/DESIGN-SYSTEM.md`), every finding re-verified against the actual text; (2) external benchmark research on GameFi survival, virtual-economy metrics, tokenomics tooling, Telegram Mini App performance, and proof-of-personhood.*

---

## 1. Re-check verdict

**Bottom line: the Phase-0 economic-design docs are fundamentally solid.** They are unusually disciplined for a Phase-0 set — MV=PQ is the explicit master frame, sink/faucet discipline is retained and instrumented (ECONOMY §1, §2.3, §10), and almost every quantitative knob is deliberately deferred to a Machinations Monte-Carlo gate (§11/§12) that must pass before any code ships. Adversarial verification **knocked most flagged issues down a severity tier**: of 26 findings, the large majority were "real but overstated" and reduced to **low**. The substance the audit surfaced is real, but it is overwhelmingly *documentation polish and process-ordering*, not design contradiction.

**The exceptions matter, and they cluster in legal/regulatory risk — the docs' own self-declared "sharpest risk."** Exactly one finding survived as **critical**, and it is the load-bearing one: the legal posture's single most important rule is defeated by another feature in the same docs. Several money-transmission / sybil / jurisdiction findings survived as **medium** and are correlated — they are all facets of "the cash-out boundary and the regulated surfaces are under-specified and reviewed too late."

### Critical (verified, must address before Phase 1 locks architecture)

- **`legal-credits-torn-convertibility-breaks-guardrail` — the "chance pays Credits, never $ALPHA" guardrail is one deterministic hop from defeated.** *Where:* ECONOMY §6 (guardrail #1), §7 (currency table), §9; GDD §2.2, §10.3. The #1 legal mitigation — "Chance outcomes pay Credits (non-cashable), never $ALPHA directly… structurally separated from real-money value" — is undone by three other rules in the same docs: Credits are P2P-transferable (§0, §7), Credits convert to $ALPHA via the floating exchange (§7), and $ALPHA is cashable behind the §9 gate. Compose them: variable-ratio Exploit → Credits → floating exchange → $ALPHA → cash-out. The word "directly" is load-bearing and indefensible under the "thing of value / convertible through any path" test (UIGEA 31 USC §5362; FTC CSGO Lotto; Dutch/Belgian skin-gambling rulings). *Fix:* pick one leg to cut — make chance-won Credits a **bound, non-transferable, non-exchangeable** balance spendable only on sinks; OR remove the Credit↔$ALPHA exchange; OR make $ALPHA non-cashable. Restate the §6/§9 invariant as **"no chance-originated unit may reach the cash-out gate,"** and add a flow-tracing / taint requirement to the §10 instrumentation and §11 Machinations gate proving chance-origin funds cannot reach withdrawal.

### High → verified as Medium (real, material, fix before the regulated surfaces are built)

- **`legal-money-transmission-gap-deposit-and-jetton` (confirmed) — MT/AML mitigation is named but under-scoped.** *Where:* ECONOMY §8, §9; GDD §7; PLAN §4. The doc claims the cash-out gate "addresses money-transmission/AML," but: money transmission is two-sided and the **deposit** side (Stars/TON in) is ungated; the operator-run Credit↔$ALPHA **exchange is itself potentially regulated swap activity**; $ALPHA is a freely transferable Jetton so post-withdrawal flows are uncontrolled; and **"KYC-capable" is not a KYC program** (no CIP, OFAC/sanctions screening, SAR, or travel-rule mention anywhere in the repo). *Fix:* replace "KYC-capable" with a concrete program scope (FinCEN MSB registration assessment + state MTL analysis or a deliberate licensed-partner/geofence decision; CIP at first deposit *or* first transfer-in; OFAC screening; SAR/travel-rule stance). Pull this from the Phase-4 legal gate forward to **Phase-0/Phase-3 scoping** because it shapes architecture (Jetton design, deposit flow), not just paperwork.

- **`tech-stars-vs-ton-overlap` — Stars cannot fund a TON Jetton or cash-out.** *Where:* GDD §7; PLAN §3; and the actual defect at **ECONOMY §7 line 188** ($ALPHA "Source: Bought (Stars/TON)"). Telegram Stars are IAP digital-goods currency (Apple/Google policy) and cannot buy crypto or anything that reaches the cashable boundary — doing so is both an IAP violation (app-removal risk) and breaks the chance/convenience-vs-cashable separation. GDD §7 actually segregates the rails correctly ("Stars for small convenience buys; $ALPHA for the premium tier and cash-out"); the one bad cell is ECONOMY §7. *Fix:* correct ECONOMY §7 to "$ALPHA bought via TON Connect"; state explicitly that **Stars buy only non-cashable consumable convenience and never credit value that can reach cash-out**.

- **`tech-offchain-hotloop-custody` — off-chain hot loop makes the server a $ALPHA custodian.** *Where:* ECONOMY §9.4; PLAN §4. Settling on-chain only at the edges is the correct scaling choice, but the unstated consequence is that between deposit and withdrawal, player $ALPHA balances are server-ledger IOUs — a **centralized-custody / money-transmitter posture** with a solvency obligation the docs never state. *Fix:* acknowledge the custodial nature; specify a **proof-of-reserves invariant** (on-chain treasury Jetton ≥ Σ off-chain liquid-$ALPHA credits), double-entry Postgres ledger, and deposit/withdraw reconciliation; loop legal in on custody/MTL, not just AML at cash-out.

- **`legal-securities-torn-itself-not-just-exchange` — securities tension on $ALPHA itself.** *Where:* GDD §10.3; ECONOMY §8, §2.1 (buyback-burn, "$ALPHA scarcity ↑"), §3 (central-bank-plus-treasury). The framing "only the Exchange is addressed" is overstated (floating/unpegged + convenience-only staking yield *are* $ALPHA-level mitigations), but a **real residual Howey concern survives**: a cashable token designed to appreciate via team-managed buyback-burn and managed scarcity, marketed as a store of value. *Fix:* reframe the analysis around $ALPHA; avoid appreciation marketing; qualify buyback-burn language; add **SEC v. Telegram (GRAM/TON, 2020)** as the nearest-neighbor precedent (this is literally a TON token via Telegram).

### Medium (verified — real gaps, fold into Phase-0/Phase-1 scope)

- **`sybil-p2p-transfer-bypasses-cashout-gate`** — PoP only at cash-out is bypassable by the **mule/funnel pattern**: bots farm → funnel to one verified account → single PoP, unbounded extraction. Bounded by the no-emission invariant + compounding fee/demurrage/vesting/KYC stack, but the docs never name the pattern. *Fix:* add per-identity / per-window withdrawal caps + provenance discounting of received-transfer value; add "pre-cashout funnel via P2P transfer" as a named §11 stress scenario and PLAN red-team item.
- **`risk-gini-and-fees-incentivize-extraction-not-just-collapse` (confirmed)** — withdrawal fees + vesting are flat frictions that select *for* well-capitalized extractors; there is **no per-identity withdrawal cap** anywhere, and Gini is measured on in-game wealth, not real-value exit. *Fix:* add a progressive/per-identity withdrawal cap and a real-value-exit concentration metric in §10.
- **`legal-jurisdiction-and-platform-gambling-policy-missing` (confirmed)** — **zero** jurisdiction/geofencing strategy (legality flips by geography), and Telegram-only is a Locked decision while Telegram/App-Store gambling & money-handling policy takedown is treated only as generic "platform risk." *Fix:* add a jurisdiction/geofencing subsection tied to the strictest market served; treat platform-policy takedown of a chance-to-cash loop as an existential risk needing a fallback.
- **`ui-fullscreen-vs-safearea` (confirmed)** — `expand()` vs `requestFullscreen()` conflated; `contentSafeAreaInset` not tied to fullscreen; the **top-right close/more control cluster** (the single most common TMA 2.0 layout bug) is never called out. *Fix:* pick one mode (recommend `requestFullscreen`), tie `contentSafeAreaInset` to fullscreen, add an explicit "reserve top-right" rule.

### Low (verified, downgraded — documentation polish; not blockers)

A large set of economy findings reduced to **low** because the docs already reconcile them via the Machinations gate or already say the precise thing the reviewer asked for:
`econ-demurrage-raises-P-contradiction` (demurrage's net P-effect is correctly deferred to the §11 model; add a §3 footnote that the sink channel must dominate the velocity channel), `econ-M-unit-inconsistency` (V is a residual so the identity can't break; P is directly instrumented — add a numéraire note), `econ-staking-convenience-yield-is-hidden-faucet` (**stays medium** — genuine unreconciled contradiction: GDD §7 calls convenience a faucet input while ECONOMY §2.1 calls convenience-yield non-emission; restrict staking yield to pure status or fund/cap it as a modeled injection), `econ-convenience-spend-mint-not-transfer`, `econ-demurrage-funds-torn-holders`, `econ-mgrowth-qgrowth-rule-underspecified`, `econ-veblen-gini-claim-overstated`.

Doc-hygiene lows: `xref-economy-plan-s10-missing` (stray PLAN §10 cite), `xref-designsys-stat-glossary` (stat names live in GDD §4.1 not §2 — broaden the consistency-rule pointer), `placeholder-torn-currency-name` ($ALPHA is a managed placeholder; contracts deferral is the real constraint), `naming-stat-compute-collision` (**confirmed** — rename the "Compute-power" stat so it doesn't collide with the "Compute" resource), `ui-section-header-color-missing`, `ui-landscape-claim` (drop "+ landscape" from PLAN §3), `tech-sdk-init-data-validation` (the real survivor: **pin an `auth_date` freshness/replay TTL**), `tech-jetton-settlement-finality` (defer to Phase-2 integration spec), `ui-60fps-webview-claim` (the real survivor: **add `disableVerticalSwipes` on scroll surfaces**), `tech-redis-server-auth-consistency` (declare Postgres the money ledger).

**Theme:** the economy model is sound and self-validating by design; the risk surface is **legal/regulatory and the cash-out boundary**, and the recurring failure is *under-specification + reviewing it too late*, not a broken economic engine.

---

## 2. Benchmark suite — "is there a benchmark to test our plan?"

Yes. Concrete, sourced thresholds exist for all four gates. Organized by our plan's gates.

### 2.1 Economy / Machinations gate

| Benchmark | Metric | Target / Threshold | Source | What it tests |
|---|---|---|---|---|
| Faucet:sink ratio (the core tripwire) | Daily token minted ÷ burned | **≤ 1.0** (net-neutral-to-deflationary). Axie declared "risk of total and permanent economic collapse" at mint:burn ~2.5–4× | ChainPlay 2024; CoinDesk 2022-02-08; The Lunacian "SLP Monetary Policy" | The single most testable emission tripwire; our transfer-funded model *is* a faucet and needs matching sinks |
| Net emission at zero user growth | Net emission at plateaued population | **≤ 0** with new-user inflow set to 0 (sinks absorb faucets without new buy-in) | BNB Chain "Sustainable GameFi"; Naavik StepN; Coinmonks "GameFi 1.0" | The make-or-break test most dead GameFi projects failed; proves ROI isn't funded by the next cohort |
| Net money-supply growth (M) | Monthly net Δ money supply ÷ supply | **≤ ~3%/month**; any month **>5%** triggers sink intervention (EVE hit 5.5%/mo, 7.5% YoY and flagged elevated) | EVE MER Nov 2025 via nosygamer.blogspot.com | The "M" control in MV=PQ |
| Price-index inflation band (P / CPI) | YoY Δ of fixed-basket CPI | **−5% to +10% YoY**; >+10% = inflation fail, <−5% = demand-collapse fail | EVE MER Sept/Oct 2024 (SPI −4.5%) | Headline P signal; gate both tails — deflation is as dangerous as inflation in a cash-out economy |
| Money velocity (V) trend | Spend ÷ supply per epoch | EVE ~0.43/mo (~5×/yr). Alert on a **sustained >2–3 month decline** (hoarding/demand collapse) | EVE MER Nov 2025; Lehdonvirta & Castronova, *Virtual Economies* (MIT 2014) | Instruments the "V" we claim to manage |
| Token velocity reference band | V = annual volume ÷ circulating (non-held) supply | Burniske reference **V ≈ 20**; if simulated V ≫ 20, the price/treasury model is unsound | Burniske via Newtown Partners; HackerNoon "Token Velocity… MV=PQ" | Ties the "MV=PQ managed" claim to a concrete number to verify in sim |
| Wealth Gini bound | Gini of player wealth | Target **≤ 0.70**; **>0.80 = whale/sybil-capture red flag** (Pardus healthy 0.653; EVE outlier 0.885) | Fuchs et al., PLOS ONE 2014 (arXiv:1403.6342); Hooper, DiGRA (EVE 88.5) | Inequality + sybil-capture; gate cash-out scaling if Gini drifts >0.80 |
| Pareto tail exponent | Power-law α of upper wealth tail | Healthy **α ≈ 2.46**; **α < 2 = oligarchic/sybil-ring capture** | Fuchs et al., PLOS ONE 2014 | Complements Gini; thinning tail flags a few accounts hoarding cash-outable wealth |
| Sink calibration starting point | Monthly supply consumed by sinks | **~0.33%/month** of circulating supply (Catizen's ~3.2M tokens/mo, ~4%/yr) | coinmarketcap.com/cmc-ai/catizen; tokenomist.ai/catizen | A real-world starting sink rate for the Machinations model |
| RuneScape Bond (cautionary) | Long-run price of money-pegged item | Anti-pattern: weak sinks drove the Bond **<20M → ~150M GP**. If any fixed-utility item's price multiplies YoY, sinks are failing | GamingHQ "Grand Exchange Inflation" (Jan 2025); RuneScape Wiki "Sink" | Concrete failure mode for a transfer/token economy like ours |

**Tooling layering (don't rely on Machinations alone):** Machinations (nominal-diagram convergence + sink ≥ faucet, run per archetype/population) → **cadCAD** Monte-Carlo ensembles + parameter sweeps (find where the transfer-funded MV=PQ economy breaks) → **TokenSPICE** EVM-in-the-loop (run the actual TON/cash-out/PoP contract so farming exploits surface). Adopt the **Token Engineering Commons** discipline: every parameter shipped to prod must first pass model→validate→test→iterate. *(Machinations.io; Token Flows cadCAD; github.com/tokenspice; tokenengineeringcommunity.github.io.)*

### 2.2 UI / performance gate

| Benchmark | Metric | Target / Threshold | Source | What it tests |
|---|---|---|---|---|
| LCP (mobile, p75) | Largest Contentful Paint | **≤ 2.5s** good; >4.0s poor | web.dev Core Web Vitals | Cold-open load of the TMA shell on mid/low-end Android |
| INP (mobile, p75) | Interaction to Next Paint | **≤ 200ms** good; >500ms poor | web.dev Core Web Vitals | Tap responsiveness of buy/transfer/cash-out buttons |
| CLS (p75) | Cumulative Layout Shift | **≤ 0.1** good | web.dev Core Web Vitals | Visual stability of balances/widgets/safe-area reflow |
| Lighthouse mobile score | Composite perf | **≥ 90**; CI fails builds <90 | Chrome Lighthouse scoring; DebugBear | Single CI pass/fail number |
| Total Blocking Time | Main-thread blocking | **≤ 200ms** (heaviest Lighthouse weight, 30%) | DebugBear / Lighthouse | Lab proxy for client-side JS cost — forces economy math off the client |
| FCP (mobile) | First Contentful Paint | **≤ 1.8s** | DebugBear / Lighthouse | Perceived startup from chat |
| Speed Index | Visual completeness | **≤ 3.4s** | Unlighthouse | Whole-screen population under throttling |
| Critical-path budget | Compressed critical bytes | **≤ 170 KB** (slow-3G / cheap device) | web.dev perf budgets / Addy Osmani | Initial payload ceiling; cash-out/PoP screens lazy-load beyond shell |
| First-load JS budget | Gzipped first-load JS | **≤ 200 KB** (size-limit in CI) | size-limit; Calibre; codewithseb | Limits economy/sybil logic shipped to the WebView |
| JS parse cost | Parse ms per KB | **~1ms/KB** on low-end Android | Calibre | Architectural argument for the thin client |
| Animation frame rate | fps in WebView | **60fps target**; read device perf class from UA, strip animations on low-end; **animation-disable fallback is the guaranteed path** | Telegram Mini Apps docs (core.telegram.org/bots/webapps) | Smoothness on the cheap-Android Telegram market |
| Safe-area compliance | Overlap w/ Telegram chrome | **0 overlap** (incl. top-right close/more cluster in fullscreen) | Telegram Mini Apps docs | Prevents cash-out CTAs hiding under native chrome |
| Latency under concurrency | p95 vs concurrent users | **p95 < ~300ms** light load; test a concurrency ceiling (reference: ~1.4s at 30–40 concurrent) | cyberpanel.net TMA load test; docs.ton.org | Server-side responsiveness under load |
| Catizen architecture comp | DAU / loading approach | ~7M peak DAU, 36M+ users, low-spec-Android support, ms-level multi-thread async + global CDN | AiCoin; Cointelegraph; CoinGecko (vendor-reported — directional) | What a successful TON GameFi competitor actually ships |

### 2.3 Sybil / integrity gate

| Benchmark | Metric | Target / Threshold | Source | What it tests |
|---|---|---|---|---|
| Per-human uniqueness | Duplicate / false-match rate | **< 1e-6** practical design target (World ID Orb: 1e-6 design, 2.25e-14 measured in test) | world.org/blog/engineering; whitepaper.world.org | One human cannot register a second cash-out identity |
| False-reject of real users | FNMR | **< 0.5–1%** (World ID target <5e-3, measured ~0.1%) | world.org/blog/engineering | Gate must not block genuine cashers (retention risk) |
| Sybil-captured share of cash-out value | Leakage past the gate | **< 5%** (stretch **< 1%**) vs Arbitrum's **~21.8%** with heuristic-only filters | u.today / X-explore Arbitrum analysis | THE extraction-cap benchmark for the transfer-funded outflow |
| Adversarial baseline (assume the worst) | Sybil share of applicants | **~40–59%** of an open value-bearing claim are sybil (Aptos ~40%; LayerZero removed ~59%) | TrustaLabs; LayerZero ZRO 2024 | Design the gate for a majority-sybil pool, not an exception |
| TON-native PoP candidate | Camera-only palm biometric | HumanCode (TON Society): ~10× FaceID, random-gesture liveness, no special hardware; pilot targets FAR <1e-3, spoof-accept <1%, scan <30s on mid Android | biometricupdate.com 2024-04; whitepaper.humancodeai.com | The most plan-aligned (frictionless, Telegram-native) PoP |
| Behavioral pre-filter | Per-account humanity score | Gitcoin model-based 0–100 (0=sybil); Passport threshold analog **≥ 20/100**; frictionless, drops obvious sybils cheaply | support.gitcoin.co; human.tech | Cheap back-end pre-gate before the hard biometric gate |
| Integrity cost ceiling | Cost per account check | **~cents, not dollars** — manual review (~$1.42/eval, Gitcoin GR13) does not scale | hackmd.io/@jmcook; gov.gitcoin.co | Forces automated + biometric over human review at Telegram scale |
| PoP gate marginal cost | Cost per gated cash-out | **< 1–2% of payout**; model inside MV=PQ outflow (World ID per-verify fee; HumanCode 1M-TON one-time enrollment sink) | world.org fees blog; biometricupdate.com | Gate must not itself become an extraction vector / supply inflator |
| Economic cap (complement) | Clawback/redistribute + per-human limit | LayerZero 85% redistributed / 15% kept; per-human cash-out cap | LayerZero ZRO 2024 | Bounds extraction even when some sybils slip through |

**Note:** TokenSPICE and cadCAD ship **no prescriptive numeric thresholds** and **no authoritative industry PoP false-positive-rate exists** — for the integrity gate you must instrument and measure **your own sybil-cash-out rate** as the KPI. Pure social-graph PoP (BrightID, ~1 DAI/user) is too weak/low-reach to be the sole gate; use it as the floor.

### 2.4 GameFi survival sanity-check

| Benchmark | Metric | Target / Threshold | Source | What it tests |
|---|---|---|---|---|
| Death definition (kill-criteria) | "Dead" = token <10% of ATH **AND** DAU <100 | Adopt both as formal shutdown tripwires; **~75–93%** of GameFi is dead (ChainPlay 93% of 3,200+; CoinGecko 75%) | ChainPlay & Storible "State of GameFi 2024"; CoinGecko Research | The prior we're fighting; concrete survival gate |
| Median lifespan | Launch → dead | **4 months** average (vs ~1yr memecoins). Alive at 12 months = top-decile | ChainPlay 2024 | Sets the 6- and 12-month survival checkpoint clock |
| Token drawdown | % from ATH | **−50% = warning, −90% = death-equivalent** (avg dead −95%; SLP −93%; GST −91–98%) | ChainPlay; CoinDesk; CryptoSlate | Headline survival signal — but token-price stability is **not** a passable gate (see below) |
| New-user-inflow dependency | MoM net-new-user trend | **>20–30% sustained MoM decline = death-spiral trigger** (StepN MAU 700k→~30k, −95%) | Naavik STEPN; Dune; CryptoMode | Prove ROI does NOT need accelerating inflow |
| Telegram D1 retention | Day-1 | **≥ 20%** healthy; <10% failing (Helika range 5–20%; trad mobile 25–33%) | monetag.com; Helika Q4 2024 via theblock.co | First kill-criterion in playtests |
| Telegram D7 retention | Day-7 | **≥ 10%**; <5% = retention cliff (Telegram typical 8–10%) | monetag.com | Where tap-to-earn collapses post-novelty |
| Cohort-over-cohort D30 | D30 retention trend across cohorts | **Stable-or-rising**, NOT decaying as new cohorts join (the inflation tell) | DappRadar; GameAnalytics 2025 | Early-warning for emission-driven collapse |
| Monetization ceiling | ARPPU / paying conversion | **ARPPU ~$33, ~7% web3 conversion** (Catizen, ~55M users, ~1.2M paying). Higher pro-forma = unrealistic | coinmarketcap.com/cmc-ai/catizen; altcoinbuzz.io | Calibrates the revenue model to reality (IAP/ownership, not speculation) |
| Airdrop = exit event | Post-distribution churn | **Keep churn <50%** at any cash-out/airdrop milestone vs Hamster Kombat's **85%** (300M→41M) and >75% token dump | Helika Q4 2024; ccn.com | Tests whether rewards are terminal goal (bad) or ongoing utility (good) |
| "Tokens-off" core loop | Retention with rewards removed | Core loop must retain (Notcoin team: tap-to-earn "probably dead") | coinmarketcap.com/cmc-ai/notcoin; 99bitcoins.com | Proves real demand, not extrinsic-reward dependence |
| Funding context | Follow-on capital assumption | Plan for **~zero** follow-on (GameFi VC −85% 2022→2024, →−93% by 2025) | ChainPlay 2024; crypto.news | Validates the self-funding transfer model |

---

## 3. Gaps — risks with NO benchmark or NO test in the current plan

1. **No flow-tracing / taint test that chance-origin value can't reach cash-out.** The §11 Machinations gate validates inflation/Gresham/Gini but has **no provenance check** that chance-won Credits cannot traverse the exchange to $ALPHA to withdrawal. *Add:* a taint-tracking invariant to §10 instrumentation and a §11 exit criterion. **(Closes the one critical finding.)**

2. **No real-value-exit concentration metric.** Gini is measured on in-game wealth only; nothing measures *who actually cashes out* and how concentrated real-value egress is. *Add:* an exit-Gini / per-identity cash-out concentration metric in §10, plus a per-identity and per-rolling-window **withdrawal cap** (none exists today — fees+vesting are friction, not a cap).

3. **No measured sybil-cash-out rate and no PoP false-reject budget.** The plan gates "cash-out behind PoP" but sets no target. *Add:* sybil-captured-share-of-cash-out-value **<5% (stretch <1%)** and FNMR **<0.5–1%** as instrumented KPIs; pick a provider (HumanCode palm for Telegram-native fit) and run a TokenSPICE sybil-agent funnel simulation.

4. **No mule/funnel scenario in the red-team.** PoP-at-cash-out is bypassable by aggregation; the §11 scenarios and PLAN Verification don't model pre-cashout funneling. *Add:* "pre-cashout funnel via P2P transfer" as a named stress scenario.

5. **No proof-of-reserves / solvency invariant for the off-chain custodial ledger.** *Add:* on-chain treasury Jetton ≥ Σ off-chain liquid-$ALPHA credits, double-entry Postgres ledger, deposit/withdraw reconciliation.

6. **No jurisdiction/geofencing strategy and no platform-policy fallback.** Legality flips by geography; Telegram-only + a chance-to-cash loop is an unmitigated single point of failure. *Add:* jurisdiction subsection tied to the strictest market served; treat App-Store/Telegram takedown as existential.

7. **No money-transmission program scope (deposit side, exchange-as-swap, on-chain transferability).** *Add:* MSB/MTL assessment, CIP at first deposit/transfer-in, OFAC/SAR/travel-rule stance — as a Phase-0/3 scoping item, not Phase-4.

8. **No layered economic-sim robustness (cadCAD/TokenSPICE).** Machinations alone validates one nominal diagram. *Add:* cadCAD Monte-Carlo + parameter sweeps and a TokenSPICE EVM-in-the-loop run as part of the gate, with the TEC "simulate-every-shipped-parameter" discipline.

9. **No CI-enforced UI perf gate or load test.** CWV/Lighthouse/bundle budgets aren't wired into CI, and there's no concurrency load test or `auth_date` replay TTL. *Add:* CWV + Lighthouse(≥90)/TBT(≤200ms) CI gate, size-limit (≤200 KB), a concurrency load test, and a pinned initData freshness/replay window.

10. **No "tokens-off" retention test or cohort-over-cohort D30 tripwire.** *Add:* a tokens-off playtest as a hard gate and cohort-D30 monitoring next to the faucet:sink ratio.

---

## 4. Prioritized recommendation — top 7 actions before Phase 1

1. **Fix the chance→cash convertibility break (critical).** Choose and document which leg to cut (recommend: chance-won Credits become a **bound, non-transferable, non-exchangeable** balance). Restate the ECONOMY §6/§9 invariant as "no chance-origin unit reaches cash-out," and add a **flow-tracing/taint** requirement to §10 and a §11 exit criterion. *Single most important action; it un-breaks the docs' own #1 legal rule.*

2. **Insert a Phase-0/Phase-1 LEGAL SCOPING gate** (alongside the Machinations gate) that produces binding architectural constraints **before** the Jetton, the Credit↔$ALPHA exchange, and the cash-out rail are built: convertibility decision (action 1), $ALPHA securities posture (drop appreciation marketing, qualify buyback-burn, cite *SEC v. Telegram*), MSB/MTL/geofence decision, and Jetton transfer-restriction decision. Keep the Phase-4 full review but make this the architecture gate.

3. **Specify the cash-out boundary fully:** per-identity + per-window **withdrawal caps** and provenance discounting; the **proof-of-reserves** solvency invariant for the off-chain custodial ledger; an MT/AML program scope (CIP, OFAC, SAR, travel-rule) replacing "KYC-capable"; and correct ECONOMY §7 so **Stars never fund $ALPHA/cash-out**.

4. **Set and instrument the integrity gate to numbers:** sybil-cash-out leakage **<5% (stretch <1%)**, FNMR **<0.5–1%**; select HumanCode palm PoP (Telegram-native) with a Gitcoin-style behavioral pre-filter; run a TokenSPICE sybil **funnel/mule** simulation and add that scenario to the §11 model and the red-team.

5. **Layer the economic simulation:** keep Machinations (convergence + sink ≥ faucet per archetype/population) and add **cadCAD** Monte-Carlo sweeps and a **TokenSPICE** EVM-in-the-loop run, gating on the concrete bands — faucet:sink **≤1.0**, net emission **≤0 at zero growth**, M-growth **≤3%/mo**, CPI **−5%…+10% YoY**, simulated V near the assumed band (~20), Gini **≤0.70**. Adopt the TEC "simulate every shipped parameter" discipline.

6. **Wire the UI/perf gate into CI and add a jurisdiction/platform plan:** CWV (LCP≤2.5s, INP≤200ms, CLS≤0.1) on real low-end Android + Lighthouse ≥90 / TBT ≤200ms / first-load JS ≤200 KB; resolve `requestFullscreen` + safe-area (reserve top-right) + `disableVerticalSwipes`; pin the initData `auth_date` replay TTL. Add the jurisdiction/geofencing subsection and a platform-takedown fallback.

7. **Adopt survival kill-criteria and run a "tokens-off" playtest:** formal death definition (token <10% ATH AND DAU <100), D1 ≥20% / D7 ≥10% / cohort-D30 stable-or-rising, churn <50% at any milestone, and a core-loop-retains-without-rewards test. Calibrate the revenue pro-forma to **ARPPU ~$33 / ~7% conversion** (Catizen), assume **~zero** follow-on capital, and explicitly remove "token appreciation" from success criteria (even Catizen saw CATI −88% YoY).

---

*Sources are cited inline. Headline external figures were gathered via WebSearch; several primary domains (CoinGecko, ChainPlay, EVE MER, arXiv, The Block, Medium) returned 403 on direct fetch (Cloudflare/policy, not a proxy fault), so re-verify the load-bearing numbers against original PDFs/CSVs before any board-grade use. All in-doc line/section references were re-verified against the actual `docs/` and `PLAN.md` files during the adversarial re-check.*
