# Outfox product requirements

> **Status:** adopted 2026-09-12. This document owns scope, releases, and acceptance.
> Game rules live in `GDD.md`, economic rules in `ECONOMY.md` (which wins every
> conflict), engineering in `ARCHITECTURE.md`, UI in `DESIGN-SYSTEM-WEB.md`, and the
> environments in `INFRASTRUCTURE.md`. `PLAN.md` is the kickoff record; the live roadmap
> is §5 here. Status labels: **Built** (shipped and verified), **Designed** (validated in
> the economic model, not coded), **Specified** (written in a canon doc, not modeled),
> **Owner** (waits on a decision by the owner).

## 1. Summary

Outfox is an economy-first multiplayer trading game on Solana, shipped as a web PWA.
Players take chance-based Calls, do deterministic Gigs, trade on a player-run market,
and later run crews and businesses. Earning is funded by other players and by real-money
convenience spend, never by a token printer. The one cashable asset, $ALPHA, sits behind
a valve that fees, seasons, vests, caps, and identity-gates every exit, and value won by
chance can never reach that valve at all.

The thesis is that an earning-first game survives only if it is transfer-funded, and
the whole product is built to prove that in public, with the simulation record, the
parameters, and the built-versus-designed status published.

## 2. Users

The four player archetypes are the sim's population mix (`ECONOMY-SIM-SPEC.md` §4); the
fifth is the adversary the design assumes is present.

| Who | Share | What they want | What the product must do for them |
|---|---|---|---|
| Casual | 55% | short sessions, a satisfying Call or two, no setup | 10 seconds from URL to first Call without a wallet or a signup; the loop reads on a cheap phone |
| Grinder | 20% | maximize actions, train, sell what they earn | honest pacing (the bars), a Market that clears, a visible path to Skulks and Desks |
| Trader | 12% | arbitrage the Market and the exchange, hold $ALPHA | live rates, published fees and caps, a Clearinghouse that states every cost before commit |
| Whale | 5% | spend for convenience and status, hold size | Seats and the Commons to compete on, carry and caps stated up front, never an unpleasant surprise at exit |
| Bot / sybil | 8% (assumed) | multi-account extraction, funnel to one cash-out | nothing; the valve, seasoning, and PoP make the ROI negative, and the dashboards measure the leak |

Secondary users: the operator (dashboards, pause, parameter changes by rule), auditors
and counsel (the published parameters and the event record), and grant or hackathon
reviewers (the whitepaper and the evidence pages).

## 3. Goals and non-goals

Goals, in priority order (the order is the tie-breaker):

1. An economy that holds the G1–G12 gate live, and not just in the sim.
2. A first session that is fast, legible, and honest on a low-end Android browser.
3. A cash-out path that is safe to open: audited program, counsel-cleared posture, PoP
   at the gate, custody bounded by the window cap.
4. Retention from the game itself, measured with rewards removed.

Non-goals (stated so nobody builds them by accident):

- Token price appreciation as a success metric. Playability is proven decoupled from
  price (`sim/v6_extdump_probe.txt`); marketing never promises appreciation.
- A rendered world. The Street is a list of districts. "Map" is a banned description.
- Offline play or queued actions. The market halts offline.
- Freeform in-app chat in Phase 1. Discord is the social layer; in-app comms are
  structured (`DESIGN-SYSTEM-WEB.md` §16).
- Pay-to-win of any kind. Money buys time, slots, and cosmetics.
- A native app. The PWA is the product; the dApp Store listing is a TWA wrapper.
- Any real-money surface before the audit and counsel gates.

## 4. Success metrics and kill criteria

These are acceptance criteria. If the economy row fails, the game fails regardless of the
retention row (`GDD.md` §10).

| Area | Metric | Bar | Source |
|---|---|---|---|
| economy | G1–G12 live | every criterion inside its band on the production windows; G11 by funding-graph proxy | `ECONOMY-SIM-SPEC.md` §13, `DATA-ARCHITECTURE.md` |
| economy | chance-origin leakage (G10) | zero, always | engine tests, live taint dashboard |
| economy | sybil share of cash-out value (G11) | < 5%, stretch < 1% | `VALIDATION-BENCHMARKS.md` §2.3 |
| economy | proof of reserves (G12) | escrow ≥ ledger liabilities after every state change | `solvencyAudit` |
| first session | URL to first resolved Call | p50 ≤ 10 s on the floor device | `ftue_first_call_completed` |
| retention | D1, D7 | ≥ 20%, ≥ 10% | `VALIDATION-BENCHMARKS.md` §2.4 |
| retention | cohort D30 | stable or rising across cohorts | same |
| retention | tokens-off playtest | the core loop retains with rewards removed | same, gap #10 |
| growth | DAU at day 60 after public launch | inside the distribution plan's success band | distribution plan (internal document) |
| monetization | conversion, ARPPU | plan against ~7% and ~$33 as ceilings, not targets | Catizen reference, `VALIDATION-BENCHMARKS.md` §2.4 |
| performance | LCP, FCP, Speed Index, INP, CLS, TBT at p75 on the throttled floor profile | ≤ 2.5 s, ≤ 1.8 s, ≤ 3.4 s, ≤ 200 ms, ≤ 0.1, ≤ 200 ms; Lighthouse mobile ≥ 90 | `DESIGN-SYSTEM-WEB.md` §21.1 |
| performance | critical path (binding); first-load JS derived from it; display font | ≤ 170 KB; about 140 KB ceiling (64.6 KB today); ≤ 30 KB (about 40 KB today, a known overage) | same |
| integrity | console errors in `verify-live` | zero | harness |
| custody | signer blast radius | ≤ window cap per rolling 24 h | program |

Kill criteria (post-launch, formal): token below 10% of its high **and** DAU below 100;
churn above 50% at any cash-out milestone; sustained month-over-month new-user decline
above 20–30%. The distribution plan's kill machinery is unchanged by the Solana move.

## 5. Releases

Releases are gated, not dated; each names its exit condition.

| Release | Scope | Exit gate | Status |
|---|---|---|---|
| **R0 slice** | Calls, Gigs, bars, refills, the Open Market, Scrip carry, guest to R2 ladder with SIWS, the exchange, the Clearinghouse, the chain edge on devnet, the feedback layer, The Street tab | devnet e2e green; suite green; `verify-live` green | **shipped** (2026-08-28 edge, 2026-09-11 Street) |
| **R1 closed beta** | R0 on a real domain and box, devnet economics, real players, the dashboards live for the first time, CI gates, `/min-version`, idempotency keys, step-up auth, metric jobs, backups verified | hardening checklist clear; G1–G12 computed live for two weeks; D1/D7 measured | **blocked on purchases** (domain, VPS wait on the grant decision) |
| **R2 economy systems** | one at a time behind the sim gate: Raids, staking and unbonding, progressive carry (built) and wealth-indexed issuance, Skulks, Desks, Seats, the Index, the Commons and Share-Out | each system: sim scenarios pass at full seeds, adversarial review if it touches money, a `verify-live` world | designed |
| **R3 payments and retention** | F3 convenience checkout (USDC-first), PoP at cash-out, notifications (push, email, Discord mirror), referral loop, device handoff, settings IA | conversion and funnel events live; PoP false-reject budget met | owner decisions pending (rail, PoP provider) |
| **R4 launch** | mainnet deploy under the custody model (multisig admin, fresh keys), published parameters, launch liquidity graduated from the curve and permanently locked (`LAUNCH.md`), the valve opening last | third-party audit passed; counsel cleared; beta gates held | gated |

## 6. Functional requirements

Each requirement has an id, an acceptance statement, and a status. Canon references
point at the rule; this table does not restate rules.

### 6.1 Onboarding and identity

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-ID-1 | A new visitor gets a guest account and reaches a playable Call without any signup | guest boot to first resolved Call p50 ≤ 10 s; the two events that measure it are a pre-beta instrumentation item | Built (FTUE); measurement Specified |
| FR-ID-2 | Registration (R1) is triggered by the first demanding surface, with the action queued and resumed | `verify-live` world A | Built (SIWS) |
| FR-ID-3 | A credential that already belongs to another Fox opens a choose sheet; never a silent merge or overwrite | world B; engine tests | Built |
| FR-ID-4 | Linking a wallet (R2) uses a purpose-bound message distinct from sign-in | `auth-siws` and `settlement` tests | Built |
| FR-ID-5 | Rungs never downgrade; verification travels across devices | never-demote cases in `auth-privy.test.ts` and `alpha-gate.test.ts` (the dev adapter's re-registration keeps R2 since 2026-09-12) | Built (R0–R2) |
| FR-ID-6 | Cash-out demands R3 verification, once, and nowhere else | valve gate V1; PoP provider integration | Owner (provider), then build |
| FR-ID-7 | Money actions require fresh authentication within 10 minutes | withdrawal request and wallet link refuse without step-up | Specified, pre-beta |
| FR-ID-8 | Sessions are listable and revocable per device; handoff by QR | `DESIGN-SYSTEM-WEB.md` §10.3 | Specified |
| FR-ID-9 | A guest's loss condition is stated in the upgrade banner, not in fine print | banner copy present; `iam_*` events | Specified |

### 6.2 Core loop

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-LOOP-1 | Calls show their probability before the player commits; the server resolves the outcome; a failure is Nicked with a longer cooldown | catalog in `@outfox/shared`; `engine.test.ts` | Built |
| FR-LOOP-2 | Call payouts land as Unsettled Scrip and can never be transferred, listed, or exchanged | engine tests; G10 | Built |
| FR-LOOP-3 | Gigs pay deterministic Settled Scrip and a tool every Nth completion (pity, not chance) | engine tests | Built |
| FR-LOOP-4 | Focus and Risk Appetite regenerate over real time and gate work and Calls respectively | `computeBar` tests | Built |
| FR-LOOP-5 | Refills are purchasable from Unsettled Scrip (a sink) | engine tests | Built |
| FR-LOOP-6 | Resolution is flat and immediate: reveal capped at 320 ms, no near-miss theatre | feedback layer; motion rules | Built |
| FR-LOOP-7 | Raids are a parallel tier against the Houses with Heat raising Sheriff attention | `GDD.md` §5; sim F1 | Designed |
| FR-LOOP-8 | The Sim trains the four stats and hosts the FTUE Call | `GDD.md` §3, §5 | Specified (FTUE Built; stats Designed) |

### 6.3 Markets and money

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-MKT-1 | The Open Market lists player items at player prices with a published fee; Settled Scrip only | engine tests; `MARKET_FEE_BPS` on the Rules sheet | Built |
| FR-MKT-2 | Scrip carries demurrage at the published rate above the floor, lazily assessed | engine tests pinned to a reference schedule | Built |
| FR-MKT-3 | The exchange is a protocol-owned constant-product pool with a published fee, a volatility multiplier, and a per-side daily flow cap; over-cap entry is impossible | `exchange.test.ts`; capacity clamps in the UI | Built |
| FR-MKT-4 | $ALPHA bought on the exchange is an unseasoned lot | settlement tests | Built |
| FR-MKT-5 | Idle $ALPHA pays the idle carry; the position above the shelter pays the progressive carry; both published | `carry-alpha.test.ts` | Built |
| FR-MKT-6 | Staking and unbonding: the staked bucket is exempt from the idle carry, never the progressive carry, and unstaked $ALPHA returns unseasoned | `ECONOMY.md` §13.C | Designed |
| FR-MKT-7 | Primary $ALPHA sales (F4) with wealth-indexed allocation | `ECONOMY.md` §13.D | Designed |
| FR-MKT-8 | Treasury market operations (TWAP legs) run by rule and logged as policy events | `ECONOMY.md` §13.B | Designed |
| FR-MKT-9 | Desks, Seats, and the Index | `GDD.md` §5 | Designed |
| FR-MKT-10 | The Commons accepts Scrip (either class) and $ALPHA for non-transferable standing; Share-Outs are published-rule events | `THEME-OUTFOX.md` §4; sim follow-up | Designed |
| FR-MKT-11 | $ALPHA launches through a Meteora bonding curve that creates the fixed-supply mint and graduates into a permanently locked DAMM v2 pool; the launch rules are published; `GET /api/launch` shows the market's state once the launched mint is the one settlement was initialized with (no deployment yet: the join exists as `GENESIS_MINT` in `genesis.ts`, verified on a local validator; the beta deployment will be the first to use it, `LAUNCH.md` Status) | `LAUNCH.md`; `launch.ts verify` on devnet (`programs/deployments/devnet-launch.md`); `launch.test.ts` | Built (rehearsed on devnet); mainnet behind the R4 gates |

### 6.4 The Clearinghouse (deposit and cash-out)

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-CH-1 | Deposits are one wallet transaction built server-side; unlinked deposits are parked, never lost; the client refuses to build one from a non-linked account | devnet e2e; world A | Built |
| FR-CH-2 | Every withdrawal passes the six valve gates before a voucher is signed (rung, seasoning, fee, vesting, weekly cap, solvency) | `settlement.test.ts`; e2e | Built |
| FR-CH-3 | The quote itemizes gross, fee, surcharge, net, and the vesting date before commit; dates, not durations | Clearinghouse UI | Built |
| FR-CH-4 | The Rules sheet shows the live constants from `@outfox/shared` | UI reads constants, no literals | Built |
| FR-CH-5 | Redeem is relayed as one base64 transaction with fee payer = recipient, and the client verifies the connected account first | world A; `wallet.ts` | Built |
| FR-CH-6 | Withdrawal and swap requests are idempotent under retry | idempotency key; test | Specified, pre-beta |
| FR-CH-7 | Operator revenue split on boundary fees at the published rate | `ECONOMY.md` §3 | Owner (rate) |

### 6.5 The Street and world

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-ST-1 | Seven district rows; open districts have entry points, closed ones a line of fiction and no date | world D | Built |
| FR-ST-2 | No district carries a rung gate; Raids unlock at R0 | `DESIGN-SYSTEM-WEB.md` §10.1 | Built (as a rule) |
| FR-ST-3 | Skulks: crews with ranks, AUM, turf, the Big Score, a Skulk tab | `GDD.md` §5, DSW §16 | Designed |

### 6.6 Client platform

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-PWA-1 | Installable PWA; shell precached; API never cached | `sw.js`; manifest | Built |
| FR-PWA-2 | Offline renders TAPE HALTED with every economy action disabled | manual check today; an offline world in `verify-live` is a target | Built |
| FR-PWA-3 | Forced update on `/min-version` violation without a reload loop | endpoint + SW message path | Specified, pre-beta (SW half Built) |
| FR-PWA-4 | Feedback cues with reduced-motion and mute; header mute | `feedback.ts` | Built |
| FR-PWA-5 | Compact and Wide layouts; bottom bar and rail | shell | Built |
| FR-PWA-6 | Money inputs are locale-proof at 9 dp | regression pinned | Built |
| FR-PWA-7 | Solana dApp Store listing via TWA; assetlinks served | `deploy/README.md` gap #4 | Not started (needs domain) |

### 6.7 Payments, retention, growth

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-PAY-1 | Convenience checkout priced in USD, settled in USDC; day-0 funding through wallet built-in ramps | `SOLANA-FEASIBILITY.md` §4; A11 | Owner (rail), then build |
| FR-PAY-2 | Money never buys stats or outcomes | catalog review; `GDD.md` §8 | Rule, enforced by review |
| FR-NOTIFY-1 | Push, email, Discord mirror with quiet hours and a daily rate limit; the permission ask is a designed moment | DSW §14 | Specified |
| FR-REF-1 | Guest-play-first referral links with server-side first-touch attribution; rewards in convenience only | DSW §15 | Specified |
| FR-SET-1 | Settings IA per DSW §2.5, including per-device toggles already shipped in the header | partial | Partial |

### 6.8 Operator

| Id | Requirement | Acceptance | Status |
|---|---|---|---|
| FR-OPS-1 | Liveness probe with DB touch and indexer age | `/healthz` | Built |
| FR-OPS-2 | Pause, signer rotation, cap change from the cold admin key; multisig at mainnet | program; runbooks in `INFRASTRUCTURE.md` §8 | Built (program), runbooks Specified |
| FR-OPS-3 | Live dashboards for M, V, P, Q, CPI, Gini, tail, sink efficacy, exit-Gini, sybil proxy, PoR | metric jobs writing `metrics`; self-hosted dashboard | Specified, pre-beta |
| FR-OPS-7 | A public economy page (`/economy`, `GET /api/economy`): aggregates only (Foxes, Scrip by provenance, treasury, the day's faucets and sinks, $ALPHA owed against the escrow reserve, the exchange rate, the launch) and the verdicts of the four ledger audits; no session, no player named. A summary, not the FR-OPS-3 dashboards | `overview.test.ts` (figures derived by hand); `verify-live` world E; `rate-limit.test.ts` | Built |
| FR-OPS-4 | Alerts on any G band breach, indexer age, solvency audit failure, disk, and backup age | `INFRASTRUCTURE.md` §7 | Specified, pre-beta |
| FR-OPS-5 | Every parameter change is a logged policy event within a proven interval | policy registry (A14) | Specified |
| FR-OPS-6 | Restorable backups every 6 h and before every deploy, one restore drill done | `INFRASTRUCTURE.md` §6 | Specified, pre-beta |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| performance | budgets in §4; the floor device is a plain mobile browser on low-end Android; animation-disable is the guaranteed path |
| availability | beta: one box, restart on failure, healthz monitored; production: the §17 scaling path in `ARCHITECTURE.md`, target set at launch |
| data | pseudonymous by construction; no PII in the event stream; identity tables separable; self-hosted analytics only |
| security | the standing posture in `CLAUDE.md`; threat model in `ARCHITECTURE.md` §14; fresh keys per environment; hot/cold split; multisig admin before mainnet |
| legal | counsel review is a hard launch gate; PoP at cash-out only; gambling vocabulary banned in product copy; chance value walled from cash-out structurally; geofence decision coupled to the on-ramp rail |
| accessibility | live regions for tickers, focus management, keyboard map at Wide, text scaling (DSW §20) |
| i18n | number and date formatting locale-proof; copy in English at launch; `id-ID` is the regression locale |
| cost | beta runs on one small VPS and a domain; production sizing at launch (`INFRASTRUCTURE.md` §10) |
| honesty | the whitepaper's built-versus-designed table tracks this document; a status change here updates it in the same round |

## 8. Dependencies and owner decisions

| Item | Blocks | State |
|---|---|---|
| domain (`outfoxgame.com`) and a VPS | R1 beta deploy | bought 2026-10-09; beta live at https://outfoxgame.com |
| R3 PoP provider | FR-ID-6, launch | owner decision pending; the provider brief is internal; couple with counsel and geofence |
| on-ramp rail | FR-PAY-1 | couple with geofence |
| `op_take_f3`, `op_take_wdfee` rates | FR-CH-7 | inside proven intervals [0, 0.9] and [0, 1.0] |
| launch price band and depth | R4 | mechanism decided 2026-10-02 (`LAUNCH.md`): Meteora bonding curve into a locked DAMM v2 pool; the mainnet band and depth stay open, rehearsal values are in `LAUNCH` |
| counsel engagement | R4, and architecture of FR-PAY-1 and FR-ID-6 | the hard gate |
| third-party audit of the program and economy | R4 | not engaged |
| beta on the apex domain or a subdomain | R1 | recommendation: apex |

## 9. Risks

| Risk | Mitigation in scope |
|---|---|
| economy fails live in a way the sim did not predict | live G1–G12 with alerting; parameter moves only inside swept intervals; new sim round before anything outside |
| regulatory exposure of chance plus cashable value | the firewall, PoP at cash-out, banned vocabulary, counsel gate; no launch before it |
| custody: hot key theft, insolvency | window cap, pause, PoR after every change, multisig admin |
| distribution: no host-app funnel | the distribution plan's channel stack (internal), the dApp Store TWA, Colosseum; kill criteria if the band is missed |
| sybil funnel past a weak PoP | provider chosen for dedupe quality; seasoning, vesting, weekly cap as the backstop; measured leak as the KPI |
| one-person project | canon docs and the wiki make any session resumable; the sim and tests make the economy re-verifiable without memory |

## 10. Open questions

- Walletless R1 (email or passkey) alongside SIWS: decide from beta funnel data.
- Which systems enter R2 first: the recommendation is Raids (extends the built loop),
  then Skulks (the Skulk tab and the social layer), then the Commons (the Gini lever);
  Desks, Seats, and the Index after, since each needs a modeled scenario.
- The Index's separation from $ALPHA is a design rule; counsel may ask for more.
- Beta cohort size and invite mechanism (private link, or the Superteam community first).
