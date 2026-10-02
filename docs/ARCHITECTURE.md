# Outfox architecture

> **Status:** adopted 2026-09-12 as the engineering contract. It describes the system as
> built at commit `6839309` and the target shape every new module lands in. Where this
> doc and `ECONOMY.md` disagree on an economic rule, `ECONOMY.md` wins. Where it and the
> code disagree on a fact, the code is the fact and this doc gets fixed.
> `DATA-ARCHITECTURE.md` is the data chapter of this contract; `INFRASTRUCTURE.md` is
> the environments and operations chapter; `PRD.md` owns scope and acceptance.

## 0. The shape in one page

```
 player devices                      one box (beta)                          Solana
 ┌──────────────────┐   HTTPS   ┌────────────────────────────────────┐   RPC   ┌──────────────────┐
 │ PWA (React+Vite) │──────────▶│ Caddy: TLS, static dist, /api      │         │ $ALPHA SPL mint  │
 │  Tape · Street   │           │   │ loopback                       │         │  fixed 2,000,000 │
 │  Market · Ledger │           │   ▼                                │         │  mint auth none  │
 │  Clearinghouse   │           │ game server (Fastify, one process) │────────▶│                  │
 │                  │           │  http routes ─▶ engine (rules)     │ build   │ Settlement prog. │
 │ wallet.ts relay  │  signed   │   ledger gate: postTx / postAlpha  │ txs,    │  PDA escrow      │
 │  (Wallet Std.)   │──tx/msg──▶│  exchange · carry · valve          │ sign    │  ed25519 voucher │
 └──────────────────┘   via     │  identity: session · SIWS · rungs  │ vouchers│  nonce PDAs      │
        │  wallet app │         │  chain adapter + indexer (5 s poll)│◀────────│  rolling cap     │
        ▼             │         │  SQLite (WAL) ─▶ Postgres (prod)   │ events  │  pause           │
 ┌──────────────┐     │         │  /healthz · rate limits · logs     │         └──────────────────┘
 │ Solana wallet│─────┘         └────────────────────────────────────┘                 ▲
 │ (Phantom…)   │──── deposit / redeem transactions ───────────────────────────────────┘
 └──────────────┘
```

The hot loop is off-chain and server-authoritative. The chain holds two things: an inert
token, and a settlement program that takes deposits and releases escrow only against
server-signed vouchers. The client is a renderer that relays server-built transactions
to the player's wallet.

## 1. Principles

Each principle traces to canon; none is new here.

1. **Server-authoritative.** Every outcome, price, and balance decision happens in the
   server. The client never computes a reward and carries no economic constant it could
   act on (`GDD.md` pillar 4; `@outfox/shared` exports wire types and published rules only).
2. **The chain is an edge, not a runtime.** Deposits in, vouchers out. The program enforces
   only what a chain must: single-use nonce, expiry, signature, pause, rolling cap
   (`SOLANA-FEASIBILITY.md` §3, `wiki/chain-edge.md`).
3. **Every economic mutation is an append-only event.** State is a fold over events; raw
   events are never aggregated away (`DATA-ARCHITECTURE.md` §1).
4. **One mutation gate per currency.** Scrip moves only through `postTx`, $ALPHA only
   through `postAlpha`, each inside `withTx`. `postAlpha` writes the ledger row and the
   matching lot operation together and refuses anything that does not balance (A15).
5. **The firewall is structural.** Unsettled Scrip has an allow-list of destinations
   (sinks). No code path moves it to another player, the Open Market, or the exchange
   (`ECONOMY.md` §7, sim criterion G10).
6. **Fail closed on the money path.** Ambiguity in a value-moving path is a refusal, never
   a guess. Neither the server nor the program weakens because the other might catch it
   (repo `CLAUDE.md`, security posture).
7. **The sim is the gate.** No economy code ships until the model passes at full seeds;
   live metrics use the sim's estimators so the G1–G12 criteria are production SLOs.
8. **Published rules, not discretion.** Every parameter the player can be affected by is a
   constant in `@outfox/shared`, shown on the Clearinghouse Rules sheet, and changed only
   by a logged policy event within a sim-proven interval (`ECONOMY.md` §3).
9. **Thin client, hard budget.** Text and numbers as the aesthetic; low-end Android in a
   plain browser is the floor (`DESIGN-SYSTEM-WEB.md` §21).

## 2. Runtime components

| Component | Runs | Owns | Talks to |
|---|---|---|---|
| PWA client (`apps/web`) | player's browser, installed PWA, wallet in-app browser | rendering, input, the wallet relay, local conveniences (theme, mute, FTUE flag) | server over `/api`, the wallet over Wallet Standard events |
| Reverse proxy (Caddy) | the box | TLS, static `dist/`, `/api` and `/healthz` proxying, access log | server on loopback `127.0.0.1:8787` |
| Game server (`apps/server`) | the box, one Node process | sessions, rules, ledgers, exchange, valve, chain adapter, indexer, rate limits | SQLite file, Solana RPC |
| Ledger (SQLite WAL now, Postgres at production) | the box | every table in §7 | server only |
| Indexer (in-process job) | inside the server | signature cursor over the program, event fold, deposit credit, withdrawal confirmation, heartbeat | RPC, ledger |
| $ALPHA mint | Solana | supply (fixed, authority revoked) | nothing; inert |
| Settlement program (`programs/settlement`) | Solana | escrow ATA, voucher verification, nonce PDAs, rolling cap, pause, admin | wallets (deposit, redeem), server (reads state and reserve) |
| Player wallet (Phantom, Solflare, Backpack, ...) | player device | keys, signing | the PWA via Wallet Standard, the chain |
| Economy sim (`sim/`) | developer machine | the gate: G1–G12 at 500 seeds, red-team | nothing at runtime; its estimators are ported into the metric jobs |

Beta runs without a message queue, a cache tier, or a separate worker; §17 says what
would trigger each of those.

## 3. Module map

The layout below is the server as of the module-move round (2026-09-12, review-gated;
the five original modules and two auth adapters were split along the seams they already
had). New code lands here from now on.

```
apps/server/src/
  index.ts            composition root: env, plugins, Ctx, route registration, error handler, listen
  core/               db (schema), tx (withTx), errors (EngineError), time, ctx (Ctx + requireChain)
  ledger/             scrip (getPlayer, postTx, treasuryAdd, ledgerView, conservationAudit),
                      alpha (postAlpha gate, balances, lotsOf, treasuryAlphaAdd, alphaDriftAudit), routes (ledger + debug audits)
  identity/           sessions, players (createPlayer, requireRung, playerView), rungs (R1 adapters' shared
                      semantics), wallets (R2 nonce + link + held-deposit claim), siws, privy (dormant), routes
  systems/pacing.ts   the two bars and cooldowns (shared by calls, gigs, refills)
  systems/<name>/     calls, gigs, refills, market: rules.ts + routes.ts
  economy/            carry (Scrip + $ALPHA), valve (the §9 gates), exchange, routes
  chain/              adapter (config, PDAs, state reads, vouchers, tx builders, link message), indexer
  jobs/               (later) scheduler + jobs: metrics, treasury ops, digests
  telemetry/          (later) event writers per stream, the ported sim estimators
```

Tests live in `apps/server/test/`, one file per module or invariant (`alpha-gate.test.ts`
covers the A15 gate). Route groups take a `Ctx` (db, origin, adapters, chain config,
rate-limit configs) from the composition root and register their own paths. Migrations
become numbered files under `core/` at the Postgres move (§17).

Shared package (`packages/shared`): the API contract and content catalog. It exports wire
types, published constants, and content definitions. It never exports a function that
decides an outcome.

Client (`apps/web/src`): `App.tsx` (shell, tabs, FTUE, Tape), `Street.tsx`,
`Clearinghouse.tsx`, `RegisterSheet.tsx`, `WalletPicker.tsx`, `ds.tsx` (the component
kit from `DESIGN-SYSTEM-WEB.md` §7), `api.ts` (fetch wrapper, error classes, backoff),
`wallet.ts` (Wallet Standard relay), `feedback.ts` (cue dispatcher), `sw-register.ts`.
Target: one file per tab and per sheet, `ds.tsx` stays the only place a primitive is
defined, route-level code splitting when the first-load budget demands it.

## 4. The system contract: how a game system plugs in

A game system is Calls, Gigs, the Open Market, and everything on the designed list
(Raids, Skulks, Desks, Seats, the Index, the Commons, staking). Each one ships as the
same five parts:

1. Content in `@outfox/shared`: catalog entries and wire types. Player-facing names
   come from `THEME-OUTFOX.md`; internal economic terms never cross the wire.
2. Rules in `systems/<name>/rules.ts`: pure functions over ledger rows that throw
   `EngineError` on refusal. They spend bars, check cooldowns and rungs, and call the
   mutation gate. They never touch HTTP.
3. Routes in `systems/<name>/routes.ts`: parse input, call one rule, return the full
   `PlayerView` after (§8, the state-after convention).
4. Events: every value movement is a ledger row with a `Provenance` kind; anything the
   dashboards need beyond the ledger is an explicit telemetry event
   (`DATA-ARCHITECTURE.md` §2).
5. Tests: rules under vitest with expected values from an independent source (the
   sim's reference schedule, a hand computation), a route test over HTTP, and a
   `verify-live` world once the system has a surface.

Two standing gates apply before a system is called done. If it adds or changes a faucet,
sink, or transfer, the sim scenario that covers it passes at full seeds first. If it
touches the money path (anything under `economy/`, `chain/`, `ledger/postAlpha`, the auth
adapters), it gets an adversarial review by an agent that did not write it and a
regression test that goes red on the defect found.

## 5. Time and state model

There is no game tick. Every time-dependent quantity is evaluated lazily from stored
timestamps when the player is touched:

| Quantity | Stored | Evaluated |
|---|---|---|
| Focus, Risk Appetite | value + `focus_at` / `risk_at` | `computeBar` on read; regen per second from `REGEN` |
| cooldowns | `ready_at` per (player, action) | compared to `now` on the next attempt |
| Scrip carry (demurrage) | `carry_at` | `applyCarry` before every Scrip mutation and view |
| $ALPHA carry | `alpha_carry_at` | `applyAlphaCarry` before every lot mutation and withdrawal pricing; catch-up posts on next touch, dormancy is not a shelter |
| seasoning | `acquired_at` per lot | age at withdrawal pricing; deposits use chain `blockTime`, not server receipt time |
| vesting | `vests_at` per withdrawal | `refreshVesting` on read |
| exchange circuit breaker | `exchange_ema` (fast, slow, day) | `rollEma` once per elapsed day from the close; a trade never moves its own fee |

Rules: the server clock is authoritative and every timestamp is epoch milliseconds;
`serverTime` rides in every `PlayerView` so the client renders countdowns without trusting
its own clock. Anything that must happen without a player touch (metric windows, treasury
TWAP legs, digests) is a job (§12), never a lazy fold.

## 6. Money and ledger model

Two currencies, two representations, one gate each.

| | Scrip | $ALPHA |
|---|---|---|
| unit | integer cents (¢) in `INTEGER` columns | base units at 9 dp, `BigInt` in code, `TEXT` decimal in columns (kept from the 18-dp era; exact and bit-for-bit with the chain) |
| balances | `players.scrip_settled`, `players.scrip_unsettled` | sum of `alpha_lots.remaining_wei` per player |
| event table | `ledger` (signed `d_settled`, `d_unsettled`, `kind`, `ref`, `at`) | `alpha_ledger` (signed `delta_wei`, `kind`, `ref`, `at`) |
| gate | `postTx` | `postAlpha` (A15): the only writer of `alpha_lots` and `alpha_ledger`; takes a credit, consume, or rebalance lot operation that must balance the ledger delta; refuses over-takes, foreign lots, and negative lots |
| treasury | `treasury.scrip` (CAPTURE bucket) | `treasury_alpha.wei` (policy ammunition, never operator revenue) |
| audit | `conservationAudit` (per-player ledger versus balance drift) | `alphaDriftAudit` (per-player ledger fold versus lots fold, BigInt in JS), `solvencyAudit` (against the live escrow reserve, counting unconfirmed vouchers), `exchangeAudit` |

Settled and Unsettled are columns, not tags on rows, because the firewall is a rule about
destinations: Unsettled may be spent on refills, fees, upkeep, house goods, and the
Commons, and nowhere else. `postTx` callers choose the column; the allow-list lives in the
rules that call it, and `vocab-guard` plus the engine tests pin it.

The treasury capture (`treasuryAlphaAdd`) sits beside the gate, not inside it: a carry or
sell-leg fee is a gate call paired by hand with a capture, and only `exchangeAudit`
would notice a dropped or doubled capture (the drift and solvency audits stay green). A
capture-aware gate is the natural next tightening if that pairing ever multiplies.

Lots exist because seasoning is per acquisition: every deposit, exchange buy, and (later)
primary purchase is a lot with its own clock, withdrawals consume seasoned lots first, and
carry decays proportionally across lots so the mix is preserved.

Wire rule: `BigInt` never crosses JSON. $ALPHA amounts travel as decimal strings; the
client formats and parses at 9 dp with a locale-proof machine formatter (the `id-ID`
thousands separator bug is the regression that pinned this).

## 7. Storage

Tables as of `6839309`, grouped by owner:

| Group | Tables |
|---|---|
| players and identity | `players`, `sessions`, `auth_codes` (dev adapter), `wallets`, `wallet_nonces` |
| Scrip economy | `ledger`, `items`, `listings`, `cooldowns`, `treasury` |
| $ALPHA economy | `alpha_lots`, `alpha_ledger`, `treasury_alpha` |
| exchange | `exchange_pool` (the fold), `exchange_events` (the truth), `exchange_ema` |
| chain edge | `withdrawals` (state machine), `chain_events` (raw, immutable, idempotent PK), `chain_cursor_sig`, `unclaimed_deposits`, `chain_cursor` (EVM-era shape, still created, unused) |

Conventions: plain SQL, integer money, no driver-specific features beyond the import, so
the schema ports to Postgres unchanged. Schema changes are additive; the one migration so
far (`alpha_carry_at`) backfilled to upgrade time because carry is never retroactive.
Target at the Postgres move: numbered migration files, a `schema_version` row, and
`withdrawal_events` so the withdrawal state machine is an event stream rather than a
status column (`DATA-ARCHITECTURE.md` §2 `econ.*`).

## 8. API conventions

The surface today, grouped (all under `/api`, JSON, cookie session):

| Group | Routes |
|---|---|
| session | `POST session/bootstrap` |
| identity | `POST register/start`, `register/verify`, `register/adopt` (dev adapter); `register/siws/nonce`, `register/siws`; `register/privy`; `verify/dev`; `wallet/nonce`, `wallet/link` |
| play | `POST actions/call`, `actions/gig`, `sinks/refill` |
| market | `GET market`; `POST market/list`, `market/buy`, `market/cancel` |
| ledger | `GET ledger` |
| exchange | `GET exchange`, `exchange/history`; `POST exchange/quote`, `exchange/swap` |
| clearinghouse | `GET alpha`; `POST deposit/prepare`, `withdraw/request`, `withdraw/claim` |
| economy (public) | `GET economy` (unauthenticated: aggregates and audit verdicts only, never a player row; one computation per 30 s; the escrow reserve is the only upstream read and its absence leaves the ledger side published) |
| launch | `GET launch` (unauthenticated, public chain data only: the $ALPHA curve and pool on Meteora, `LAUNCH.md` §8; cached 30 s, withdrawn after 10 minutes without a good read) |
| ops | `GET healthz` (unauthenticated, liveness only); `GET debug/conservation`, `debug/alpha-drift`, `debug/exchange`, `debug/solvency` (only with `OUTFOX_DEBUG`) |

Rules that hold across the surface:

- Mutations are `POST`. Reads that are cheap and idempotent are `GET`.
- Gameplay mutations (actions, refills, market, exchange) return the full `PlayerView`
  after the change plus the domain view they touched. Identity and chain-edge routes
  return their own view (a nonce and message, a withdrawal, a voucher and transaction).
  The client replaces state wholesale and never patches a balance itself.
- Errors are `{ error, code }`. Every `EngineError` is a 400 except `no_session` (401);
  rate limits are 429 with `retry-after`; anything else is a logged 500. Codes include
  `insufficient`, `low_bar`, `cooldown`, `rung_required`, `chain_off`, `rate_limited`.
  The client keys on `code`, never on message text.
- Rate limits are per route per IP: bootstrap 30/min; the row-minting and RPC-firing
  routes 10/min each; the two public views (`launch`, `economy`) 60/min each, served through
  `core/cached` (at most one upstream read or computation per 30 s whatever the request
  rate). Gameplay routes are priced in Focus and Risk Appetite instead.
  `X-Forwarded-For` is trusted for exactly one hop and only with `OUTFOX_TRUST_PROXY=1`.
- The session is an opaque random token in an `httpOnly`, `SameSite=Lax` cookie
  (`Secure` in production), hashed at rest, one year, minted at first bootstrap.
- Chain-edge routes throw `chain_off` when no chain is configured; the slice runs
  standalone.

Target additions before public beta: `GET /min-version` for the forced-update path
(`DESIGN-SYSTEM-WEB.md` §1.1), an idempotency key on `exchange/swap` and
`withdraw/request` (double-submit from a flaky network must not double-spend), and a
step-up re-auth requirement on `withdraw/request` and `wallet/link` (§9).

## 9. Identity and sessions

The ladder is `DESIGN-SYSTEM-WEB.md` §10.1 read through the Solana migration note; the
Solana-era truth is:

| Rung | How | Unlocks |
|---|---|---|
| R0 guest | server mints an account on first bootstrap; device-bound cookie | the full core loop, Unsettled and Settled Scrip, sinks, read-only Market |
| R1 registered | wallet sign-in (SIWS: server nonce, purpose-bound message, ed25519 verify, subject `siws:<base58>`); dev email+code adapter in chainless worlds | Market writes, the exchange, holding $ALPHA, later Skulk roles and purchases |
| R2 linked | a second, purpose-bound link message proves control of the deposit and withdrawal wallet; a sign-in signature can never link and vice versa | deposits, withdrawal destination |
| R3 verified | proof of personhood at cash-out only; provider is a pending owner decision | cash-out |

Rules: the demanding surface triggers the upgrade with the action queued and resumed;
rungs never downgrade; credential collision opens a choose sheet (continue as the existing
Fox, or keep the guest under another credential), never a silent merge or overwrite.
`registerVerified` and `adoptVerified` are the only two entry points and both adapters use
them.

Target: step-up re-auth (fresh signature within 10 minutes) on withdrawal initiation and
wallet link or unlink; session listing and per-device revoke; device handoff by QR
(`DESIGN-SYSTEM-WEB.md` §10.2, §10.3). Decision A6 in §18 keeps sessions opaque and
server-side rather than moving to JWTs.

## 10. The chain edge

Documented in full in `wiki/chain-edge.md`, `programs/settlement/src/lib.rs`, and
`programs/deployments/devnet.md`. The parts the rest of the architecture depends on:

- Program state (`SettlementState` PDA, seed `settlement`): admin, pending admin,
  voucher signer, mint, window cap, bucket and last drain (leaky bucket), chain id,
  paused flag. Instructions: `initialize`, `deposit`, `withdraw`, `set_signer`,
  `set_window_cap`, `pause`, `unpause`, `transfer_admin`, `accept_admin`. Events:
  `Deposited`, `Withdrawn`, `SignerChanged`, `WindowCapChanged`. A `UsedNonce` PDA per
  redeemed voucher makes replay impossible.
- Voucher: ed25519 over `OUTFOX_SETTLEMENT_V1 ++ program id ++ chain id ++ to ++
  amount ++ nonce ++ deadline`, verified by the native ed25519 precompile and checked
  against the instructions sysvar. Chain id 0, 1, 2 is localnet, devnet, mainnet; the
  client refuses an unknown one.
- Server adapter (`chain.ts`): reads state and the escrow reserve, builds the deposit
  transaction (one instruction, no approve step) and the redeem transaction (compute
  budget, ed25519 verify, withdraw) as unsigned base64 for the player's wallet to sign,
  signs vouchers with the hot key, and never holds the admin key.
- Indexer: polls the program's signatures from a stored cursor every 5 s, parses
  events from logs, folds them into `chain_events` (idempotent on `(signature, index)`),
  credits deposits to the linked player or parks them in `unclaimed_deposits`, confirms
  withdrawals by nonce, and reports its last success to `/healthz`.
- Trust model: custodial by construction. A stolen hot key drains at most the window
  cap per rolling 24 h before the operator pauses. Admin can pause, rotate, and recap but
  cannot move funds. Mainnet prerequisites: multisig admin, fresh keys, third-party
  audit, counsel.

## 11. Data and telemetry

`DATA-ARCHITECTURE.md` is the contract. How the current build maps onto it:

| Stream | Exists today as | Gap to close |
|---|---|---|
| `econ.*` | `ledger`, `alpha_ledger`, `exchange_events` (all append-only with provenance) | withdrawal lifecycle as events; carry assessments as their own kind (today they post as `carry` rows, which is enough for M and V) |
| `chain.*` | `chain_events` (program events only) | holder census from mint transfers, first-funder edges, DEX pool events on $ALPHA pairs |
| `policy.*` | nothing (parameters are constants in code) | a parameter registry with change events (`economy/policy`) before any live tuning |
| `identity.*` | rung transitions implicit in `players.rung` | explicit transition events, PoP attempts and outcomes, link and unlink events |

The metric layer (M, V, P, Q, CPI, Gini, Pareto tail, sink efficacy, exit-Gini, sybil
share by funding-graph proxy) is a port of `sim/gate.py` estimators into `telemetry/`,
tested against sim fixtures so live and sim numbers are definitionally comparable. It
runs as a job (§12) and writes a `metrics` table the dashboard reads. Alert thresholds
are the G1–G12 bands (`ECONOMY-SIM-SPEC.md` §13).

Event naming for client instrumentation follows `DESIGN-SYSTEM-WEB.md` §22
(`iam_`, `pay_`, `cashout_`, `ret_`); the client posts batches to one endpoint and the
server writes them to an `events` table keyed by account id, never by anything personal.

## 12. Jobs

| Job | Trigger | Today | Target |
|---|---|---|---|
| indexer | every 5 s | in-process `startIndexer` | same until production; then a worker process (§17) |
| vesting, carry, EMA day update | lazy on touch | folds in §5 | unchanged |
| metrics | hourly and daily windows | none | `jobs/metrics` writing `metrics`; alerts from bands |
| treasury ops (§13.B TWAP legs) | daily, rule-driven | none | `jobs/treasury` over `economy/exchange` primitives, every leg a `policy.*` event |
| withdrawal sweep | hourly | none (`prepareClaim` re-signs a `signed` row on re-claim, which covers expiry today) | flags vouchers signed but unconfirmed past TTL and reconciles ledger status; nothing to do on-chain, expiry is enforced by the program |
| digests, quiet hours, push rate limit | scheduled | none | with the notification stack (`PRD.md` FR-NOTIFY) |
| backups | every 6 h and pre-deploy | none (no box yet) | a systemd timer per `INFRASTRUCTURE.md` §6 |

Jobs are idempotent and single-instance. When the server moves to two processes, jobs
take a lease row in the database rather than relying on there being one process.

## 13. Client architecture

React 18 + Vite 5, one bundle today (64.7 KB gzipped), JetBrains Mono variable, Lucide
icons. There is no state library: `App.tsx` holds the `PlayerView` from the last
response and every action replaces it. There is no background poll today; countdowns
tick locally once a second from `serverTime`, and state refreshes on the next action or
bootstrap.

- The shell has four tabs (The Tape, The Street, Market, Ledger; Skulk arrives with
  Skulks) as a bottom bar at compact widths and a rail at wide widths. The Clearinghouse
  opens from the Ledger. FTUE is a guided first Call for a fresh Fox, ended by the first
  resolved Call. Bootstrap retries with capped exponential backoff (`App.tsx`), a 429's
  `retry-after` winning when longer.
- Design kit: `ds.tsx` is the only place a primitive (row, chip, sheet, bar, amount
  field, empty state) is defined; screens compose primitives and never restyle them.
  Tokens live in `tokens.css`; `apps/web/scripts/aa-check.mjs` verifies the contrast matrix
  after any color change.
- API layer: `api.ts` wraps `fetch` with same-origin credentials, classifies non-JSON
  and network failures as halts (TAPE HALTED), and surfaces `code` and `retry-after`.
- Wallet relay: `wallet.ts` implements the Wallet Standard window events directly
  (`standard:connect`, `solana:signMessage`, `solana:signAndSendTransaction`) with no
  wallet library, chain code, or ABI. The Clearinghouse checks that the connected account
  matches the voucher recipient before asking the wallet to sign a redeem.
- Feedback: `feedback.ts` dispatches semantic cues (press, clean, nicked, warn, select,
  fill, destroy) to synthesized audio and haptics with reduced-motion and per-device
  mutes.
- Service worker: precaches the shell only, API is network-only, navigations are
  network-first with shell fallback, updates are polite by default; the forced path
  (skipWaiting on message) exists and waits on the `/min-version` endpoint (§8).
- Offline: read-only shell with staleness stamps, every economy action disabled. An
  offline action queue is ruled out (`DESIGN-SYSTEM-WEB.md` §1.2).
- Budgets (CI gates once CI exists, `INFRASTRUCTURE.md` §4) are the
  `DESIGN-SYSTEM-WEB.md` §21.1 table: LCP ≤ 2.5 s, FCP ≤ 1.8 s, Speed Index ≤ 3.4 s,
  INP ≤ 200 ms, CLS ≤ 0.1, TBT ≤ 200 ms, Lighthouse mobile ≥ 90, critical path ≤ 170 KB
  as the binding byte gate with first-load JS derived from it (working ceiling about
  140 KB; 64.6 KB today), display font ≤ 30 KB (about 40 KB today, a known overage), and
  zero console errors in `verify-live`.

## 14. Security posture and threat model

The standing posture is in repo `CLAUDE.md`. The threats the architecture is shaped
around:

| Threat | Control | Where |
|---|---|---|
| stolen hot signer key | window cap per rolling 24 h; pause; `set_signer` rotation; key on the box only, 0640 root:outfox | program, `INFRASTRUCTURE.md` §5 |
| forged or replayed voucher | ed25519 domain message; `UsedNonce` PDA; deadline; chain id and program id in the message | program, `chain.ts` |
| server signs more than escrow holds | V6 solvency gate counts unconfirmed vouchers against the live reserve; `solvencyAudit` | `settlement.ts` |
| chance value reaching cash-out | Unsettled destination allow-list; only Settled Scrip enters the exchange; G10 in the sim, engine tests live | `engine.ts`, `exchange.ts` |
| sybil extraction | R3 PoP at cash-out (the binding lever per AUDIT-2), seasoning, vesting, weekly cap, funding-graph clustering (target) | valve, `DATA-ARCHITECTURE.md` |
| pump and dump on the exchange | flow cap per side per 24 h; volatility fee multiplier from day-rolled EMAs | `exchange.ts` |
| rate-limit bypass by forged XFF | trust exactly one proxy hop; regression `rate-limit-proxy.test.ts` | `index.ts` |
| session theft | opaque token, hashed at rest, `httpOnly`, `Secure`, `SameSite=Lax`; step-up re-auth on money actions (target) | `index.ts` |
| stranded deposit | client refuses to build a deposit from a non-linked account; unlinked deposits are parked, never lost | `Clearinghouse.tsx`, `chain.ts` |
| wrong cluster | chain id pinned per transaction; client fails closed on unknown | `wallet.ts` |
| debug surfaces in production | `OUTFOX_DEBUG`, `OUTFOX_DEV_AUTH`, `OUTFOX_DEV_SEED_EXCHANGE` off by default; hardening checklist verifies | `deploy/README.md` |
| secrets in git | pre-push secret scan and publish guard; `.gitignore` for env, keys, `private/` | machine hooks |

Custody-touching changes get an adversarial review by an agent that did not write them,
on the main-loop model or higher, plus a regression test on the exact defect. A
third-party audit of the program and the economy is a hard pre-mainnet gate.

## 15. Verification pyramid

| Layer | Tool | What it proves | Count / record |
|---|---|---|---|
| rules and money | vitest (`apps/server/test`) | engine, the A15 gate, valve, carry, exchange, auth adapters, rate limits, route parsing, vocab guard | 149 cases across 11 files |
| program | LiteSVM (`programs/settlement/tests`) | per-case port of the EVM reference suite, window math | 28 integration + 5 unit |
| contract in the loop | `apps/server/scripts/m4-contract-loop.ts` | priced scenarios match the model against the real program | GREEN 2026-08-25 |
| chain end to end | `apps/server/scripts/e2e-devnet.ts` | deposit, index, gates, vest, sign, forgery rejected, redeem, replay rejected, pause, PoR | ALL CHECKS PASSED 2026-08-28 |
| client live | `apps/web/scripts/verify-live.cjs` (Playwright, headless Brave, stub wallet) | worlds A–D: SIWS register and resume, collision, dev sheet, The Street; zero console errors | 19/19 |
| visual | `apps/web/scripts/aa-check.mjs`; the sketch harness | contrast matrix; screenshots at 390 and 1280 | on demand |
| economy | `sim/run.py`, `sim/gate.py` | G1–G12 at 500 seeds, red-team at 100 | 6/6 standard, 6/7 red-team |
| type | `tsc --noEmit` in the web build | the client compiles clean | green |

`tsc --noEmit -p apps/server` is clean since the module-move round (the old `LotRow[]`
cast went with it); both packages' tsc are gates.

## 16. Environments and deployment

`INFRASTRUCTURE.md`. In one line each: local is chainless SQLite on `:8787` and `:5173`;
dev+beta is one small VPS on devnet with SQLite behind Caddy; production is a separate
larger box on mainnet with Postgres, and it exists only after the audit and counsel gates.

## 17. Scaling path

Each step has a trigger, so nothing is built ahead of need.

| Step | Trigger | Change |
|---|---|---|
| SQLite to Postgres | production environment exists, or beta write contention shows in p95 | same schema, numbered migrations, cutover by export and import during a paused edge |
| one process to API + worker | indexer or metric jobs delay request p95, or two API instances are needed | `jobs/` runs in a second unit; jobs take a database lease |
| per-action refresh to live feed | fills or Skulk events must appear without a player action | first a visibility-gated poll of a batched feed endpoint; then one SSE channel per session multiplexing tickers, presence, fills, with the poll as fallback |
| public RPC to a provider | devnet or mainnet public RPC rate limits the indexer | `OUTFOX_RPC_URL` swap, no code change |
| single box to two | availability target above one box | Postgres managed or replicated, API stateless behind Caddy, jobs single-instance by lease |
| single bundle to split chunks | first-load JS approaches the derived ceiling (about 140 KB) | route-level `import()` for the Clearinghouse, Skulk, and Index screens |

## 18. Architecture decisions

| # | Decision | Status |
|---|---|---|
| A1 | Server-authoritative; the client is a renderer | adopted (kickoff) |
| A2 | Chain as an edge: inert mint + settlement program, hot loop off-chain | adopted 2026-08-25 |
| A3 | Append-only events are the source of truth | adopted 2026-07-11 |
| A4 | SQLite for the slice and beta, Postgres for production; portable SQL throughout | adopted 2026-08-31 |
| A5 | No wallet library; Wallet Standard relay implemented directly | adopted 2026-08-28 |
| A6 | Sessions stay opaque server-side tokens, not JWTs; rolling expiry and per-device revoke are added on the same table | adopted 2026-09-12 (owner; replaces the DSW §10.2 JWT wording: fewer moving parts, instant revoke) |
| A7 | No live feed until a feature needs it; then a visibility-gated batched poll, then SSE when Skulks or the Index need fan-out | adopted 2026-09-12 (owner) |
| A8 | Jobs run in-process at beta; a separate worker unit at production | adopted 2026-09-12 (owner) |
| A9 | Content catalog lives in `@outfox/shared` as code, not in the database, until live-ops needs to change content without a deploy | adopted for the slice; revisit with seasons |
| A10 | PoP integrates as a server-side verification of the vendor's result, recorded as an `identity.*` event; the vendor's identifier is stored in the identity tables only, never in the ledger | adopted 2026-09-12 (owner); provider still the owner's call |
| A11 | Convenience purchases (F3) are deposit-shaped: USDC arrives on-chain to a purchase address, the indexer credits the SKU; no card processor in the server | adopted 2026-09-12 (owner); rail choice couples to geofence and counsel |
| A12 | npm workspaces monorepo: `packages/shared`, `apps/server`, `apps/web`, `programs/`, `sim/` | adopted (kickoff) |
| A13 | No CI exists yet; the pipeline is defined in `INFRASTRUCTURE.md` §4 and is a pre-beta item | adopted 2026-09-12 (owner) |
| A14 | Parameter changes go through a policy registry with change events before any live tuning; constants in code remain the published defaults | adopted 2026-09-12 (owner) |
| A15 | $ALPHA gets a single mutation gate (`postAlpha` becomes the only writer of `alpha_lots` and `alpha_ledger`, together, inside `withTx`) and a per-player ledger-versus-lots drift audit beside `conservationAudit` | adopted 2026-09-12 (owner); built the same day with the module move, adversarially reviewed |
| A16 | $ALPHA and its first liquidity are created through Meteora: a Dynamic Bonding Curve pool creates the fixed-supply mint and graduates into a DAMM v2 pool whose launch liquidity is permanently locked (`LAUNCH.md`). The server shows the launch through a read-only public route that decodes the pools by byte offset; the Meteora SDK stays a scripts-only dev dependency and off the production box | adopted 2026-10-02 (owner); launch and view built and rehearsed on devnet, two adversarial review rounds; the join to settlement is a genesis mode (`GENESIS_MINT`), verified on a local validator, not yet used by a deployment |

## 19. Open questions

- Should R1 gain a walletless credential (email or passkey) on Solana? The DSW principle
  was "no wallet ceremony at R1"; the migration made SIWS the R1 ceremony. Owner call,
  informed by beta funnel data on `iam_rung_upgrade_abandoned`.
- Where does the operator revenue split (`op_take_f3`, `op_take_wdfee`) get applied in
  code once rates are decided: at the valve (fee row split into two treasury buckets) is
  the proposal.
- Purchase SKUs and the F3 credit path (A11) need the on-ramp rail decision first.
- Does the metric job compute CPI from a fixed basket of Open Market items from day one,
  or from the reduced-form M/Q until the Market has enough kinds? Both are specified;
  the basket needs the item roster.
