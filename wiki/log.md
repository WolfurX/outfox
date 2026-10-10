# log — append-only wiki activity record

*(Log entries before 2026-08-25 belong to the pre-Solana development history and are
not carried into this repository.)*

- 2026-08-25 · DECISION+INGEST · **Solana migration, Phase A executed**: full Solana
  migration adopted (`docs/SOLANA-FEASIBILITY.md` — port everything, rewrite only the
  chain edge); name finalized **Outfox**; vocabulary unified (retired dev names survive
  only in immutable sim records; `tail_alpha` disambiguates the Pareto metric from the
  token). Rename purity PROVEN by identical-seed A/B runs (standard 24 seeds +
  red-team 12, full horizon): results identical to the last digit — committed 500-seed
  scorecards remain the valid record, nothing re-simulated. vocab-guard repurposed as
  retired-names guard; supersession banners on the prior-pivot docs; `contracts/`
  frozen as the EVM behavioral reference for the Anchor port. Updated `state.md`,
  `decisions.md`, `index.md`. Next: Anchor programs (migration step 2).
- 2026-08-25 · INGEST · **Public whitepaper built** (`whitepaper/`, GitBook-ready):
  17 pages from WHITEPAPER.md restructured GitBook-style (game/economy/token/evidence/
  status sections), Solana-current, redaction rules applied (no internal strategy, no
  prior-chain naming beyond "an EVM testnet"), gambling-vocab blacklist respected.
  `.gitbook.yaml` roots GitBook at whitepaper/. Assets: mascot + 2 reused app scenes +
  3 new generated scenes (hero street, skulk crew, clearinghouse), all style-guide
  compliant, no text-in-image. Owner hook-up pending: GitBook Git Sync OAuth.
- 2026-08-25 · INGEST · **Whitepaper published**: https://outfox.gitbook.io/whitepaper/
  via a public mirror repo (`outfox-whitepaper`) + GitBook API import (space
  f3b29NcYLjPo3cnhExJ4, site site_rhtAM, org hostname `outfox`). Update pipeline =
  `scripts/publish-whitepaper.sh` (mirror → push → re-import). All 17 pages + images
  verified rendering.
- 2026-08-25 · INGEST · **Migration step 2 done — Settlement program (Anchor 1.1.2)**:
  `programs/settlement` ports the frozen EVM reference exactly (escrow=state-PDA ATA,
  ed25519 introspection voucher with OUTFOX_SETTLEMENT_V1 domain incl. program id +
  chain id (cross-cluster replay closed — EVM had chainid via EIP-712), nonce-PDA
  single-use, leaky bucket u128-safe, 2-step admin, no renounce path, admin cannot
  move funds). Tests: 28 LiteSVM integration (clock-warped window cases incl.
  boundary-burst + drain-at-old-rate) + 6 unit (pure drain fn; fuzz asserts the
  reference's honest bound: total ≤ cap + leaked). $ALPHA = plain SPL mint, mint
  authority revoked at genesis (test setup mimics genesis; real script at deploy).
  Toolchain now on box: node 26, rustup/rust 1.98, solana 3.1.10 (anchor-pinned),
  anchor 1.1.2, litesvm 0.16. Server suite verified on this machine: 105/105
  (vocab-guard exemption for sim/README vocabulary note — test-proven).
  Next: step 3 (server Solana adapter + SIWS at the Privy seam) → M4 rerun.
- 2026-08-25 · INGEST · **Migration step 3 done — server on Solana**: `chain.ts` is now
  the Solana adapter with the same seam (signVoucher = ed25519 over the program's
  116-byte domain message; indexer = getSignaturesForAddress cursor + Anchor event
  parse from logs, blockTime-keyed seasoning clocks preserved (M4 finding); deposit/
  redeem ship as server-built base64 transactions — the approve step is gone, native
  multi-ix txs replace ERC-2612). Ledger unit flip: ALPHA_BASE_UNITS = 1e9 (SPL 9dp)
  centralized in @outfox/shared, every 18dp literal replaced, carry reference
  schedule re-expressed, suite green. SIWS R1 at the Privy seam: purpose-bound
  nonce message, subjects `siws:<base58>` disjoint from emails by construction,
  register/adopt collision semantics reused; 10 new tests. Suite **115/115**.
  Client (step 4) now targets: siws auth.mode + depositTx/redeemTx shapes.
- 2026-08-25 · INGEST · **M4 contract-in-the-loop GREEN on Solana** (`scripts/
  m4-contract-loop.ts`, LiteSVM edition): same compiled settlement.so + real SPL/
  ed25519 programs, chain+game clocks warped together; events fold through the REAL
  indexer logic (foldTransaction extracted; transport is in-process — documented
  departure). All checks pass; the record's numbers reproduce (fast in-out −45.0%,
  farmed channel −45.9%, patient mule now −29.0% because the §13.A carry is live —
  the original run's <10% predates the carry and its scope-limit note is retired).
  Found & fixed en route: alphaMintFor read a fixed offset past a borsh Option
  (state parser added); EVM address lowercasing corrupted base58 (removed); nonces
  were 256-bit vs the program's u64 space (now random u64, tests updated);
  exchangeAudit's treasury identity predated carry capture (now feesAlpha + carry).
  Suite 115/115. Remaining for step 5: devnet deploy + e2e port. Step 4 (client)
  untouched — web still speaks the EVM tx shapes.
- 2026-08-28 · INGEST · **Migration step 4 done — client on Solana**: `wallet.ts`
  rewritten as a direct Wallet Standard relay (zero deps; the §4 Jupiter-kit item
  verified 2026-08-28 and rejected — it ships anchor+emotion+react-query and its own
  modal UI into the bundle). SIWS register/adopt behind the same sheet + collision
  semantics (adopt signs a fresh nonce, pinned to the colliding account); privy mode
  gets an honest refusal; dev sheet unchanged. Clearinghouse: R2 link via wallet-standard
  signMessage; deposit is ONE server-built tx with a linked-wallet fail-closed guard
  (unlinked depositor would strand funds in unclaimed escrow); redeem relays base64
  `redeemTx` with the fee-payer check; leftover 18dp fmt/parse fixed to 9dp, and
  machine fills use a locale-proof formatter (id-ID dot-grouping re-parsed Max fills
  1000× off — found by the adversarial review pass, both gating findings fixed with
  regression probes). Shared types caught up to the server's real responses
  (`auth.mode 'siws'`, `Voucher.program`, `redeemTx`, single-tx deposit shape).
  DESIGN-SYSTEM-WEB §10 carries the migration note (R1 = the one sanctioned wallet
  ceremony). Whitepaper status page updated (wallet sign-in built; harness green
  locally; devnet still the gate) + published. Verification: suite 115/115, build
  62.4 KB gz, live harness `apps/web/scripts/verify-live.cjs` 14/14 (Brave headless,
  stub wallet, world A under id-ID). Remaining: step 5b (devnet deploy + e2e + genesis
  script), then Phase C.
- 2026-08-28 · INGEST · **Step 5b scripts built + local-validator rehearsal GREEN**:
  `scripts/genesis.ts` — cluster genesis as ONE atomic transaction (create mint 9dp,
  mint fixed 2M to treasury, REVOKE mint authority, top up admin rent in-tx,
  initialize settlement state + escrow; a partial genesis cannot exist; a rerun
  refuses on the existing state PDA). `scripts/e2e-devnet.ts` — port of the EVM
  e2e through the REAL server tx builders (prepareDepositTx/prepareRedeemTx, what
  the client relays): deposit → indexer credit (idempotency re-checked) → §9 gates
  (45% all-fresh fee, vesting) → voucher sign → forged signature rejected on-chain →
  redeem pays net → replay rejected (nonce PDA) → admin pause blocks deposits →
  unpause flows → indexer confirms → solvency audit holds. ALL CHECKS PASSED against
  solana-test-validator (agave 3.1.10) with the real deployed .so. No custody code
  changed (scripts only) — no adversarial pass required by the posture. Devnet run
  pending faucet SOL only; keys staged in ~/.config/outfox/devnet (throwaway).
- 2026-08-28 · INGEST · **Migration step 5 DONE — devnet deployed + e2e GREEN. Steps
  1–5 complete; the chain edge is done.** Deployer funded (owner, GitHub faucet),
  program deployed to devnet (`FFNw…n9o1`), atomic genesis executed (mint
  `EGm6…Zpaa`, 2M fixed, authority revoked in the same tx as initialize; window cap
  500), full e2e ALL CHECKS PASSED against live devnet: deposit → indexer credit
  (idempotent) → §9 gates → vest → voucher sign → forged sig rejected → redeem exact
  → replay rejected → pause blocks deposits → unpause → confirm → PoR holds. Record:
  `programs/deployments/devnet.md`. Canon-mandated retirement executed at the gate:
  `contracts/` (frozen EVM reference incl. testnet-46630 record) + `e2e-testnet.ts`
  deleted (git history keeps them), viem dependency dropped; suite 115/115 after.
  Whitepaper status page updated (devnet verified; mainnet stays behind audit +
  counsel) + published. Remaining: Phase C (step 6) only.
- 2026-08-28 · INGEST · **Phase C: §4 verification queue CLOSED + distribution plan
  rewritten for Solana.** Four parallel adversarially-briefed research passes
  (on-ramp, PoP, DEX/POL+grants, distribution channels; provider-page/API-verified,
  confidence-flagged) + fee/CU measured from the live devnet txs. Public outcomes in
  SOLANA-FEASIBILITY §4 (all items struck); full briefs + recommendations in the
  internal docs (PHASE-C-DECISIONS, ONRAMP-COVERAGE Solana edition,
  DISTRIBUTION-PLAN Solana revision — the 2026-07-03 no-grants decision recorded as
  reversed with the OPSEC retirement that motivated it). Load-bearing findings:
  native USDC-SPL everywhere kills the bridge-fallback architecture; World ID is
  unusable in SEA; biometric-dedupe KYC is the PoP class; Raydium CPMM +
  Burn & Earn at ≥$25K is the POL floor; Colosseum Sep 28–Nov 2 is the timed launch
  moment; honest success band 100–500 DAU at day 60. Whitepaper roadmap phase-4
  wording updated + republished. Launch materials remain (event-driven).
- 2026-08-28 · DECISION · **Owner round on the Phase-C briefs**: POL venue = Meteora
  DAMM v2 (full-range, permanent lock at creation, activation-point + fee-scheduler
  anti-snipe; depth open, $25K floor stands). Publish regardless of grant outcome
  (the agentic-grant move is 200 USDG tooling money and gates nothing; nudge ~Sep 2;
  Superteam ID instagrant + Colosseum are the real applications). PoP question
  answered: piggybacking a wallet/platform (e.g. Jupiter) is identity, not
  personhood — never R3; a Solana Attestation Service fast lane (approved KYC
  issuers) filed as backlog beside the Didit recommendation. Detail: internal
  PHASE-C-DECISIONS.md / decisions trail.
- 2026-08-28 · INGEST · **PoP rec revised on owner data + beta-deploy readiness.**
  Sumsub → primary (the owner's own Superteam payout experience: good and easy; SAS
  issuer alignment; $149/mo min lifts the floor to ~$250/mo — acceptable post-launch;
  Didit = cost fallback). Fundamental-KYC question answered for the record: nobody
  verifies to PLAY — R3 exists at the cash-out door only, once, and v6c proved PoP
  quality is the ONLY binding sybil lever. New: `deploy/` (Caddyfile, systemd unit
  w/ hardening, production env template, runbook + pre-beta checklist); known gaps
  filed (rate limiting = review-gated engineering item, healthz, TWA assetlinks).
  Instagrant application drafted (internal APPLICATIONS.md; link + milestones ready
  for owner submission). Domain check: outfox.game unregistered as of today (owner
  purchase, ~$30/yr).
- 2026-08-28 · INGEST · **Whitepaper updated + republished** (owner ask): roadmap
  phase 2 reflects the built wallet sign-in + the chosen verification class
  (document-and-liveness with biometric dedupe; Orb-based ruled out for launch
  geography; provider pinned at legal review) — same story propagated to
  the-simulation, getting-value-out, and what-can-go-wrong (load-bearing-risk
  framing kept); roadmap phase 6 + the-token now carry the public commitment that
  launch liquidity is permanently locked at creation, verifiable on-chain (venue
  itself stays internal). Redaction-safe: no vendor or market names.
- 2026-08-29 · BUILD · **`/healthz` liveness probe** (deploy gap #2 closed): only
  unauthenticated route — DB touch (500 when the ledger is unreachable) + ms since
  the last successful indexer pass (`startIndexer` gained an `onOk` heartbeat
  callback; null when the chain edge is off). Caddyfile proxies `/healthz`;
  deploy/README gap list updated with the monitoring rule (alert on non-200 or
  age > 60s). Verified live both ways: chain off → `{ok,chain:false,null}`, devnet
  chain on → `indexerAgeMs≈6s`. Suite 115/115. Same day: repo went PUBLIC
  (github.com/WolfurX/outfox) after a clean full-history hygiene scan.
- 2026-08-29 · BUILD · **Root README written** (the repo is public now; reviewers
  land on it): what/how-built/chain-edge/status/layout/quickstart, honesty markers
  kept (devnet verified, mainnet behind audit + counsel), redaction rules and the
  TAPE vocabulary blacklist applied (caught "roll" in a draft line). No license
  file on purpose — visibility without an open-source grant; owner's call if that
  changes.
- 2026-08-29 · DECISION · **License: BUSL-1.1** (owner's call after the repo went
  public): source-visible, non-production use free, production/commercial use
  reserved until Change Date 2030-01-01, then converts to MIT. Licensor recorded
  as WolfurX (pseudonymous, matches repo identity posture; swap in a legal entity
  later if one exists). Canonical SPDX terms + Parameters block; README License
  section added. Rationale: clone-with-own-token is the threat model; BUSL blocks
  production use outright where AGPL only forces source publication.
- 2026-08-31 · DECISION · **Two environments** (owner): dev+beta on one small
  VPS (1 vCPU/1 GB, devnet, SQLite) and production on a separate larger box
  (mainnet, behind the audit + counsel gates, Postgres). Never co-hosted, fresh
  keys per env, web bundle built locally and rsynced. Domain purchase deferred
  by the owner; public beta waits for it, dev instance does not. Recorded in
  deploy/README.md §Environments. Open owner call: whether beta takes the
  outfox.game apex first.
- 2026-08-31 · ROUND · **Per-IP rate limiting shipped** (deploy gap #1): route-scoped
  @fastify/rate-limit — bootstrap 30/min, auth + chain-edge routes 10/min per route;
  429s in the client error shape; healthz unlimited. Adversarial review (fresh agent)
  found the headline defect: `trustProxy: true` keys on the client-controlled
  leftmost XFF and Caddy appends rather than strips, so every limit was bypassable
  in the deployed topology — fixed to hop-count 1 and pinned by
  test/rate-limit-proxy.test.ts (fails on boolean true; verified red). Also from
  review: chain-edge routes (withdraw/*, deposit/prepare) limited as RPC-amplifier
  guards, listen guard moved to NODE_ENV, rate-limit error discriminated by marker
  not bare 429, per-route (not per-class) semantics documented, table-driven route
  coverage. Suite 135/135; red-proofs run for both the missing-limits and
  spoofable-trust defects. Client follow-up noted: honor retry-after instead of
  hard HALT on bootstrap failure; bootstrap ceiling vs CGNAT is a beta tuning item.
- 2026-08-31 · ROUND · **Client boot backoff** (rate-limit round follow-up): the
  one-shot bootstrap that hard-halted forever now retries with capped exponential
  backoff, honors a 429's retry-after when longer, and retries immediately on the
  browser online event (canon §1.2 reconnect-refetches). ApiError carries
  retryAfterSec. Web build green (62.61 KB gz), verify-live 14/14. Remaining beta
  tuning item: 30/min bootstrap ceiling vs CGNAT.
- 2026-08-31 · ROUND · **Layered SVG fox derived** (the open art task from 2026-08-15):
  apps/web/public/art/mascot.svg, 4.3 KB (canon cap 8 KB), hand-traced geometric
  derivation of art/mascot.webp. Layered groups (tail/legs/feet/jacket/shirt/tie/
  head); the jacket layers read fill from --ofx-jacket / --ofx-jacket-2 with
  charcoal defaults — the jacket cosmetic line recolors by setting the vars on an
  INLINE instance (CSS vars do not cross an <img> boundary; verified with a
  three-variant render: charcoal / ember / hollow-green). Not yet wired to a UI
  slot — canon's sanctioned mascot slots stand.
- 2026-09-11 · ROUND · **Art batch 2: item set, currency marks, emblems** (Grok
  Imagine, headless `grok -p`, one prompt per set + the shared style block): 8 item
  cards for proposed kinds (terminal_mk2, tape_reel, rumor_pager, thin_book,
  focus_flask, exchange_seat, prop_desk, trader_jacket), 5 currency marks
  (coin-scrip-settled / -unsettled / -stack / -roll, coin-alpha = candidate token
  logo), 16 place/faction emblems (districts, Houses, Sheriff, Skulk, Commons,
  Clearinghouse, Tape, Open Market, Gigs, Index). All 512² webp in
  apps/web/public/art/, STAGED: none of the new kinds exist in ITEM_KINDS and in-app
  icons stay inline SVG (DSW §6), so nothing is wired. Prompts, picks, rejections:
  docs/ART-PROMPTS.md Tier 4; raws art/raw/2026-09-11-* (gitignored). Live check
  the same session: dev server + vite, Playwright walkthrough FTUE → Tape → Market →
  Ledger at 390 and 1280, zero console errors, existing art slots render.
- 2026-09-11 · DECISION · **Repo private** (owner). `WolfurX/outfox` visibility flipped public → private via gh. Whitepaper site and the `outfox-whitepaper` mirror remain public; the license and public-tree redaction rules are unchanged.
- 2026-09-11 · ROUND · **Feedback layer (DSW §9) shipped**: `apps/web/src/feedback.ts` is the one dispatcher (WebAudio cues synthesized per the §9.1 table, cue bus −18 dB FS, ≤150 ms, AudioContext unlocked on first gesture; vibration feature-detected, ≤3 pulses/120 ms, debounced per event kind after a local-server race showed the result buzz being swallowed 60 ms after the press buzz; both channels off under reduced motion; per-device prefs `outfox.fx.sound` / `outfox.fx.haptics`, sound on by default). Wired: press on Call/Gig/refill/list/delist, tier-scaled reveal on a filled Call (amplitude, never length, §8.2), nicked buzz + a fixed-position opacity-only Sheriff flash (`.ofx-flash`, rides --dur-reveal), fill on a Market buy, silent 5 ms select on tab switch. Header one-tap mute (inline SVG glyph, aria-pressed) and the first-session "Sound on" banner. Scrip marks (`ScripMark`, filled SVG, dashed ring for Unsettled) lead the Book and Ledger rows. Build 64.10 KB gz (+1.5 KB), verify-live 14/14, scratch Playwright check: cues + buzz fire on a Call, mute persists across reload and silences audio only, reduced motion silences both and the result still prints. Not done: `ret_mute_toggled` telemetry (no instrumentation pipeline exists yet, §22) and the Settings › Feedback rows (no Settings screen yet; the header mute is the persistent control the spec names). Direction picked by the owner the same day from three token-built sketches (`sketches/`, gitignored): floor-diegetic + street-hub, no three.js.
- 2026-09-11 · ROUND · **The Street tab shipped (DSW §2.4)**: `Street.tsx` + fourth tab. Owner call (same day): all seven districts listed, closed ones locked with no promise; Gigs stay on The Tape; four tabs until Skulk exists. Open = The Floor (entry → The Tape) and The Vault (entry → Clearinghouse). Closed = Options Alley, The Pit, The Dark Pool, After Hours, The Hollow: dimmed emblem, one fiction line, hollow-mark chip, no button. Rung gates checked against §10.1 before copy: Raids are R0, so no district shows a gate; the street-hub sketch's "R2 to enter" / "R3 to cash out" chips were sketch fiction and did not ship. `.ofx-emblem` (44 px round, hairline) added to components.css next to `.ofx-thumb`. Build 64.68 KB gz (+0.6 KB), tsc clean, server suite 135/135, verify-live 19/19 (new world D: seven rows, two pressable, five inert, Vault → Clearinghouse, Floor → Calls, zero console errors), headless shots at 390/1280 dark+light clean.
- 2026-09-12 · INGEST · **Architecture doc set**: `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/INFRASTRUCTURE.md` new; `docs/GDD.md` rewritten in the unified vocabulary (old draft in git); `CLAUDE.md` names the per-domain precedence; `PLAN.md` marked kickoff record; README docs line. Independent review (fresh agent, main-loop model) found 12 issues, all fixed or recorded: Street mapping conflict (shipped tab vs published whitepaper) flagged in GDD §2.1 for an owner ruling; founders-only facts stripped from the PRD; ARCHITECTURE now states that $ALPHA has no single mutation gate yet (A15 proposed); API rules corrected (400 not 503, PlayerView only on gameplay routes); budgets aligned to DSW §21.1 (derived JS gate, font 40 KB over the 30 KB gate); PRD FR-MKT-6 staking rule corrected to ECONOMY §13.C; bridge table trimmed to terms that exist in ECONOMY/sim and the vocabulary-rule conflict flagged in GDD §2.4; program unit test count 5; cue names and attributions fixed. Whitepaper `status/what-exists-today.md` corrected (progressive carry is built) and published. Code untouched. Suite 135/135, verify-live 19/19.
- 2026-09-12 · DECISION · **Two owner rulings** (on my recommendation): (1) the Street mapping follows the published whitepaper; `Street.tsx` corrected (The Floor = Gigs and Options Alley = Calls both enter The Tape, The Vault enters the Clearinghouse; The Pit = Raids, The Dark Pool = quiet market, After Hours = endgame, all closed), `verify-live` world D now 6 checks, 20/20, build 64.66 KB gz, suite 135/135; (2) the frozen economy canon and `sim/` keep the mechanics-layer terms, stated as an explicit exception in repo `CLAUDE.md`, THEME status note, and the DATA-ARCHITECTURE vocabulary note; `GDD.md` §2.1 and §2.4 conflict notes replaced by the resolutions; `decisions.md` rows added.
- 2026-09-12 · DECISION · **A6–A8, A10, A11, A13–A15 adopted** (owner: go on all eight). `ARCHITECTURE.md` §18 rows flipped to adopted; DSW §10.2 carries a supersession note for the session token format (A6). Nothing built; the module-move round with A15 is the next available engineering round.
- 2026-09-12 · ROUND · **Server module move + A15 gate**: `apps/server/src` split into core/ledger/identity/systems/economy/chain per ARCHITECTURE §3 (git renames, routes out of index.ts into per-domain files, `Ctx` from the composition root); `ledger/alpha.ts::postAlpha` is the one writer of alpha_lots + alpha_ledger (credit/consume/rebalance, balance-checked, ownership-checked, rebalance shrink-only) with `alphaDriftAudit` + debug route. Adversarial review found a rebalance mint path and a `minOut: null` parse drift; both fixed with regressions. Dev adapter never demotes (MAX(rung,1)). Suite 149/149 (11 files), tsc clean, M4 green, devnet e2e green, verify-live 20/20. CLAUDE.md security-critical paths, wiki chain-edge/alpha/state, ARCHITECTURE §3/§6/§8/§15/§18 updated.
- 2026-10-02 · DECISION · **Launch through Meteora** (owner): a Dynamic Bonding Curve pool creates the fixed-supply mint and funds a DAMM v2 pool whose launch liquidity is permanently locked; 88% of supply returns to the treasury after graduation; operator-seeded liquidity is superseded. `docs/LAUNCH.md` new; ARCHITECTURE A16; PRD FR-MKT-11 and the §8 rows; SOLANA-FEASIBILITY §4 note; repo `CLAUDE.md` doc list. Domain and box purchase decided the same day (PRD §8).
- 2026-10-02 · ROUND · **Launch script, public view, devnet rehearsal**: `LAUNCH` rules in `@outfox/shared`; `apps/server/scripts/launch.ts`; `chain/launch.ts` + `GET /api/launch` (offset decoding pinned against the program IDLs, the SDK decoder and devnet fixtures; import allowlist guard over everything the server loads; rate limit 60/min). Rehearsed on devnet end to end (`programs/deployments/devnet-launch.md`), including an outside liquidity position. Two adversarial review rounds: round 1 found the route waiting on a hung RPC, the view not tied to the settlement mint, a pool-wide lock check any liquidity provider breaks, mainnet detection by env only, the treasury key required on disk, and overstated docs (settlement join, backstop cost); round 2 found the position discovery could be griefed into a false failure, fee recipients missing from the whitepaper, and the deploy steps contradicting each other. All fixed; the round-2 fixes (launch positions taken from the migration transaction, reads bounded as a whole, import allowlist) are covered by tests and devnet runs but have not had their own independent pass, which the settlement-join round owes them. What stays open is listed in `LAUNCH.md` §6 and §7 and in `state.md`. Suite 180/180, `tsc` clean. Whitepaper pages updated (the-token, operator-revenue, roadmap, what-exists-today). Deploy: `npm ci --omit=dev`, `tsx` moved to dependencies.
- 2026-10-02 · ROUND · **Genesis takes a launched mint**: `GENESIS_MINT` mode in `apps/server/scripts/genesis.ts` verifies the mint (classic SPL, 9 dp, exactly 2,000,000, no mint authority, no freeze authority) and then sends only the settlement `initialize`; the treasury key is not needed. Local validator: mintable, short-supply, freezable, 6-decimal and missing mints all refused with no state created; a good mint initialized; `e2e-devnet.ts` ALL CHECKS PASSED on the launched-mint genesis and on the unchanged original path. `LAUNCH.md` status, PRD FR-MKT-11 and A16 updated. Not yet independently reviewed; no deployment uses it yet.
- 2026-10-02 · ROUND · **Public economy page**: `GET /api/economy` (`economy/overview.ts`: aggregates and audit verdicts only, expected figures in `overview.test.ts` derived by hand, a test that no handle or email appears) and `/economy` (`apps/web/src/Economy.tsx`, existing design-system components only, its own chunk, boots no session). The bounded cached read moved out of the launch route into `core/cached.ts` and now serves both public routes; `GET /api/launch` also names the cluster. PRD FR-OPS-7, ARCHITECTURE route table, DATA-ARCHITECTURE §5 note. Suite 188/188; `verify-live` 26/26 with the new world E; screenshots viewed at 390 and 1280, light and dark. Not yet independently reviewed.
- 2026-10-03 · ROUND · **Third review's findings fixed** (genesis mode and launch): `initialize` takes `init_if_needed` on the escrow ATA so a pre-created escrow cannot block genesis for a launched mint (new LiteSVM tests `initialize_survives_a_precreated_escrow`, `initialize_is_once`; 30 integration + 6 unit tests; M4 harness green; the devnet deployment still runs the old build). `genesis.ts`: empty `GENESIS_MINT` refused, `GENESIS_LAUNCH_POOL` ties the mint to the curve pool, supply at most 2,000,000 (burns), state ownership rather than existence, read-back comparison of admin, signer, mint and chain id, a foreign state named as such. `adapter.ts`: `settlementProblems` and `OUTFOX_ADMIN`; `alphaMintFor` refuses a state whose signer or admin is not this deployment's (`settlement-identity.test.ts`). `launch.ts`: migration found at any call depth and only when it created a position in our pool, full history walk, archival-RPC message; treasury must be System-owned; state and pool checks by owner and layout; split, threshold and fee-waiver checks; treasury balance informational. `chain/launch.ts`: a connection and deadline per read. Import guard: whole-file matching, every source extension, relative paths must stay inside the server's tree, createRequire in one place. Verified on a local validator with the Meteora programs cloned from devnet: launch, a stranger pre-creating the escrow and dusting the state address, genesis refusals (empty, look-alike mint, wrong pool) and success, a burned unit, graduation, both verify paths, a second create refused, `e2e-devnet.ts` ALL CHECKS PASSED, a wrong `OUTFOX_ADMIN` refused, and the real server serving `GET /api/launch` for the launched mint. Suite 201/201.
- 2026-10-03 · ROUND · **Beta deployment, chain side**: fresh program id `574eotmx4QLJ1F3eNjBDXa1tECFs2kXRpbYEEmP8U98y` deployed to devnet from the 2026-10-03 build; beta launch created through Meteora (mint `43n17cHnw41WBCnxF8BSDprq7CW9wrXgrNwZmiR5NqLL`, curve open, metadata at the repo's `apps/web/public/alpha.json`); settlement initialized with the launched mint via `GENESIS_MINT` + `GENESIS_LAUNCH_POOL`; `e2e-devnet.ts` ALL CHECKS PASSED on devnet against it. Record `programs/deployments/devnet-beta.md`. The owner's rule on operator-side curve buying is written into the whitepaper text and `LAUNCH.md`.
- 2026-10-03 · ROUND · **Seated review (3 Sonnet finders, Opus refuters, Sonnet+Opus pair on custody items, one Fable critic; 29 agents) of `b6549ef..7b293ff`, findings fixed.** Blocking, pre-existing: the indexer credited any `Program data:` line in a transaction that merely named the program; a tiny program forging the public Deposited discriminator credited 100,000 ALPHA with nothing in escrow (reproduced twice on a local validator). `parseEventsFromLogs` now attributes each line to the open invoke frame and accepts only our program's (`indexer-attribution.test.ts`, red against the old parser). Also fixed: the state verdict is re-read every minute and the claim route checks it before signing; `OUTFOX_ADMIN` is required with the signer key, means the current admin, and genesis prints it; the launch view applies `settlementProblems`; the public and debug solvency reads use a `finalized` reserve (a redeemed voucher no longer reads as a shortfall for the seconds before the indexer confirms it) and count deposits held for unlinked wallets as liabilities; the economy reserve read is bounded; `launchPositions` takes the two NFT mints and both pools from the MigrationDammV2 instruction's own accounts (top level or inner) and the history walk is bounded at 300 transactions; a resumed `create` keeps the original metadata address; a taken program id is reported with its admin; `ledger(at)` is indexed; the page formats numbers through `Amount` (locale-safe, the id-ID lesson), shows the price with four decimals, and labels the 24 h count honestly; overview tests cover the carry, an exchange sell and a two-day series; the devnet record names the completion-window refusal (6013). Suite 211/211, M4 green, `verify-live` 26/26, `e2e-devnet.ts` green on the devnet beta.
- 2026-10-09 · ROUND · **Beta live at https://outfoxgame.com**: Vultr box provisioned, domain bought (`outfoxgame.com`; `.game` is ~$300/yr), signer generated on the box and rotated on devnet with the new `scripts/set-signer.ts` (tx `5MNz6A4b…`), Caddy pinned to Let's Encrypt, smoke test and rate-limit check passed, backup timer verified. Deploy docs and canon tables now name `outfoxgame.com`.
- 2026-10-09 · ROUND · **Tape and Market UX (owner request)**: pinned one-line Book on The Tape once Your Book scrolls away (flat tint on change, §8.2); The Floor and Options Alley now land on the Gigs and Calls sections; the Market explains buying (other Foxes' listings, Settled Scrip, player prices), Your kit says it is for selling, each item says where it comes from, and a typed price previews the Settled proceeds after the 3.5% fee (server rounding). A failed Gig no longer prints "Settled +90". DESIGN-SYSTEM-WEB §2.4 updated.
- 2026-10-10 · ROUND · **Signal Booster probe (sim v7)**: consumable +5-point Call boost modelled default-off in `simulation.py` (identity with git 586f7c6 proven), `probe_booster.py` run: standard 6/6 at 500 seeds, red-team 6/7 at 100 (smart_sybil G11 pre-existing, unmoved by the Booster in a matched control), extra Bound 1.42% of F1, linear to +20 points, stress cell passes. Record `sim/v7_booster_probe.txt`/`.json`; sim README §v7. Canon docs unchanged pending the owner's call.
- 2026-10-10 · ROUND · **Signal Booster adopted and built** (owner: "adopt it, and do the same to other items in the future"): `runCall(..., boost)` uses up one Booster in play inside the Call's transaction (fail closed, `consumed_at` migration, `boostedP` capped at 95%), route `boost: true`; Call cards get a Boost toggle showing the boosted clean chance before the run; kit and listings state the effect; Gig counter reads Booster N/5. Six engine tests (red first), 221 green. GDD §5.1/§5.2/§5.5, PRD FR-LOOP-9, ARCHITECTURE A17, DESIGN-SYSTEM-WEB §2.4 + glossary, `CLAUDE.md` §Items (the standing sim-gate rule), sim default `booster_pp=0.05`, whitepaper loop/market/status/evidence pages (unpublished until deploy).
