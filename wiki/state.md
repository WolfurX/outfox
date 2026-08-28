# state — where the project is right now

**Read this first in any new session.** Then `index.md` for the map, `decisions.md` for
why things are the way they are.

## One paragraph

**Outfox** (final name, single unified vocabulary since 2026-08-25) is a Torn-style,
economy-first GameFi web PWA, **migrating to Solana** (decision 2026-08-25,
`docs/SOLANA-FEASIBILITY.md`) from Robinhood Chain. The economy is sim-validated (standard gate **6/6 at 500 seeds**, red-team
**6/7** — only the product-level PoP-quality item remains) and carries over unchanged;
the Phase-1 slice is playable (Calls/Gigs/sinks/Open Market, R0→R1 identity ladder,
PWA); the Solana chain edge is **live on devnet and verified end-to-end**
(`programs/deployments/devnet.md`; migration steps 1–5 ALL DONE 2026-08-28 — the
EVM reference `contracts/` was deleted at that gate, git history keeps it).
Operator revenue is formalized and sim-proven. Remaining: Phase C (step 6).

## Whitepaper (public site)

`whitepaper/` is a GitBook-ready public whitepaper (17 pages, SUMMARY.md TOC,
`.gitbook.yaml` at repo root points GitBook at it). Content derives from WHITEPAPER.md
(root), updated to Solana and redaction-safe; images in `whitepaper/.gitbook/assets/`
(reused app art + three generated scenes). WHITEPAPER.md remains the single-file
original; when the two drift, the `whitepaper/` pages are the published canon.
**PUBLISHED: https://outfox.gitbook.io/whitepaper/** (GitBook site `site_rhtAM`, space
`f3b29NcYLjPo3cnhExJ4`, org hostname set to `outfox`). Pipeline: content is mirrored
to the public repo `outfox-whitepaper` and GitBook re-imports it —
`scripts/publish-whitepaper.sh` does the whole thing; run it after editing
`whitepaper/`. Everything under `whitepaper/` is public the moment it runs.

## Solana migration status (2026-08-25 — `docs/SOLANA-FEASIBILITY.md` §6)

| # | Step | Status |
|---|---|---|
| 1 | Fresh repo, vocabulary unification, rename purity proof, retired-vocab guard | ✅ this commit |
| 2 | Anchor programs ($ALPHA mint + Settlement) to `contracts/` reference semantics | ✅ built + tested (`programs/`): 28 LiteSVM integration tests (per-case port of `Settlement.t.sol`, N/A cases documented) + 6 unit tests on the window math; ed25519 voucher w/ program-id+chain-id domain; nonce PDAs; leaky bucket exact incl. drain-at-old-rate on cap change |
| 3 | Server: Solana adapter + SIWS auth at the Privy seam | ✅ `chain.ts` rewritten (ed25519 vouchers, signature-cursor indexer w/ blockTime seasoning clocks, server-built base64 wallet txs replacing calldata, escrow-ATA reserve); ledger units flipped 18dp→9dp via shared `ALPHA_BASE_UNITS`; `auth-siws.ts` + `/api/register/siws` at the §10.1 seam (subjects namespaced `siws:`); suite 115/115 |
| 4 | Client: wallet layer + SIWS login sheet | ✅ 2026-08-28 — Wallet Standard relay implemented DIRECTLY (`wallet.ts` rewrite, zero deps; Jupiter kit verified and REJECTED — ships anchor/emotion/react-query + own modal UI, see SOLANA-FEASIBILITY §4); SIWS register/adopt sheet at the same collision semantics; Clearinghouse ported to single-tx deposit + base64 `redeemTx` (fee-payer + linked-wallet fail-closed guards); 18dp→9dp input/format fix; adversarial review (fresh agent) found 2 gating defects (deposit-strand path, id-ID locale 1000× round-trip) — fixed + regression-probed. Live harness `apps/web/scripts/verify-live.cjs` **14/14** (Brave headless, stub wallet-standard wallet, world A under id-ID); suite 115/115; build 62.4 KB gz |
| 5 | M4 rerun → devnet end-to-end | ✅ 2026-08-28 — **M4 harness GREEN** (LiteSVM, all checks, 2026-08-25 log) → genesis + e2e scripts green on a local validator → **DEVNET DEPLOYED + E2E GREEN**: `scripts/genesis.ts` (ONE atomic tx: mint 2M, revoke authority, initialize) and `scripts/e2e-devnet.ts` (through the same server-built txs the client relays: deposit → index (idempotent) → §9 gates → vest → sign → **forgery rejected** → redeem → **replay rejected** → **pause honored** → confirm → PoR holds; ALL CHECKS PASSED on devnet). Record: `programs/deployments/devnet.md`. `contracts/` + `e2e-testnet.ts` + viem dep deleted at the gate per canon. Keys: `~/.config/outfox/devnet/` (throwaway) |
| 6 | Phase C: whitepaper/distribution updates, §4 verifications, launch materials | 🟡 2026-08-28 — **§4 verification queue fully CLOSED** (4 parallel research passes + measured devnet fee/CU data; outcomes in SOLANA-FEASIBILITY §4, full briefs internal): Jupiter kit rejected · on-ramp study redone for Solana (USDC-first; day-0 = wallet built-in ramps) · PoP verified (World ID dead for SEA; biometric-dedupe KYC class is the target — internal brief w/ recommendation) · DEX/POL verified (Raydium CPMM + Burn & Earn lock, ≥$25K floor) · grants verified (Superteam Indonesia instagrant → Colosseum Sep 28–Nov 2 → Foundation convertible) · fees measured (redeem = 2-sig cost incl. ed25519 precompile). **DISTRIBUTION-PLAN rewritten for Solana** (internal): honest base rates (day-60 success band 100–500 DAU ≈ top-3 actual Solana game), channel stack = founder-account CT receipts + Solana dApp Store TWA + Colosseum + ecosystem media + Superteam ID; kill machinery unchanged; grants-reversal recorded. Whitepaper roadmap updated + published. Remaining: launch materials themselves (hackathon entry, announcement copy — event-driven) |

Toolchain note: the dev box needs nodejs/npm, rustup, solana CLI, anchor installed
before steps 2–5 (owner password required for the pacman half).

## Historical — Robinhood-era Phase-2 checklist (superseded 2026-08-25)

| # | Step | Status |
|---|---|---|
| 1 | Sim remediation + full-seed validation | ✅ rounds 2–6b (AUDIT-2) |
| 2 | Governance unlock, PLAN/GDD rewrite | ✅ 2026-07-02 |
| 3 | Theme freeze ($ALPHA vocabulary) | ✅ + vocab-guard test |
| 4 | Contracts (ERC-20 + Settlement, Foundry) | ✅ **LIVE on testnet 46630**, end-to-end verified (`contracts/deployments/testnet-46630.md`) |
| 5 | Contract-in-the-loop sim (M4) | ✅ **COMPLETE 2026-08-09** (`sim/M4-CONTRACT-LOOP.md`): both halves green. Exchange built (`apps/server/src/exchange.ts`); farmed channel −45.9% fast / −6.5% patient (patience now also pays the §13.A carry — gap closed `7c54bc3`); flow cap + vol-fee live; PoR covers the pool |
| 6 | Client wallet layer (Privy R1, SIWE R2) | 🟡 **server + client UI DONE; Privy server half DONE (`ed0657c`)** — the Clearinghouse ships the full money loop; remaining: the production Privy app (owner) → client login sheet; R3 provider = pending owner decision |
| 7 | Payments/on-ramp (F3, USDG-first) | ⬜ blocked on rail verification (`ONRAMP-COVERAGE.md`) |
| 8 | PoP: World ID at cash-out (R3) | ⬜ |
| 9 | Retention stack | ⬜ |
| 10 | Legal Phase-0 (geofence, MSB, counsel) | ⬜ hard launch gate |
| 11 | Distribution execution | plan adopted (`DISTRIBUTION-PLAN.md`), not started |

## Owner decisions — status (internal briefs, 2026-08-28)

**Decided 2026-08-28:** POL venue = Meteora DAMM v2 (full-range, permanent lock at
creation, anti-snipe suite; depth still open, $25K floor recommended) · publish
regardless of grant outcome (the 200-USDG tooling-grant move gates nothing; nudge
Superteam ~Sep 2 if silent; instagrant + Colosseum proceed) · PoP delegation
question answered (wallet/platform sign-in is never PoP; SAS-attestation fast lane
= backlog beside the Didit recommendation).
**Still open:** R3 PoP provider final call (waits on counsel; Didit recommended),
POL depth at launch, op_take rates, grant-money boundary confirmation, counsel
engagement (the hard gate; sharpest question: does cash-out make us a VASP → KYC
mandatory anyway?).

## Open queues

- **Sim (AUDIT-2):** split-hoard whale_market variant (§13.D residual 1) · round-7
  external open-market scenario (§9 — probes recorded, `v6_extdump_probe.txt`) ·
  smart_sybil G11 (product-level: PoP quality — **now unconditional**: v6c measured the
  full cap stack at zero G11 effect, AUDIT-2 §11) · burst-exit mule variant (quantifies
  the cap's insurance margin) · basket CPI · demurrage-precedent sweep · cadCAD port (M3).
- **Engineering:** the §13.B treasury-op job (TWAP legs; the exchange primitives are
  shaped for it) · staking + unbonding (the §13.A staked exemption is moot until then —
  the whole build position is liquid) · PostgreSQL migration · Privy/SIWE.
- **Owner decisions pending:** production `op_take_f3` / `op_take_wdfee` rates (proven
  intervals in AUDIT-2 §8/§8b) · POL depth at launch · on-ramp rail (couple with
  geofence decision — `ONRAMP-COVERAGE.md` §"Strategic tension") · **R3 PoP provider**
  (World ID vs KYC vendor vs passport-zk — couple with geofence + counsel; v6c made
  the choice load-bearing, and if counsel forces KYC at cash-out the KYC vendor IS
  the PoP).

## Where we left off (2026-08-15, session 5 — PRE-MIGRATION; read through the Solana pivot)

*(The Privy client sheet and the anvil wallet-in-the-loop pass described below are
superseded by migration steps 3–5: SIWS replaces Privy at the same seam, and the wallet
pass reruns against the Solana programs. The sim and art items stand.)*

**The Privy R1 adapter's server half is BUILT** (`ed0657c`) — the security boundary is
real and proven; only the production Privy app is missing:

- `auth-privy.ts`: offline ES256 identity-token verification (dashboard verification
  key; alg pinned against downgrade, iss/aud/exp/nbf enforced — 13 attack tests) ·
  `registerVerified`/`adoptVerified` reuse the §10.1 collision semantics (never merge,
  never demote a rung) · one `/api/register/privy` route for register + adopt ·
  bootstrap advertises `auth.mode` (`privy` when configured, `dev` otherwise).
- Proven over live HTTP with a locally-minted keypair: register → R1, collision →
  choose-sheet → adopt rebind, forged token refused. Suite **105/105**.
- **Owner unlock for go-live:** create the production Privy app, set
  `OUTFOX_PRIVY_APP_ID` + `OUTFOX_PRIVY_VERIFICATION_KEY`; then the claim-shape
  verification pass against the live app + the client login sheet (lazy chunk; the
  dev sheet stays the fallback).

Earlier in session 5 — **Sim round v6c is DONE** (`98ffc78`) — the AUDIT-2 §10 queue item executed:

- `wd_global_cap` models the deployed Settlement's global rolling withdrawal cap
  (release-side FIFO leaky bucket; deferred vouchers stay in escrow, never voided;
  default 0 = the v5 engine — **regression exact to the cent** against
  `v5_redteam_100.txt`).
- smart_sybil re-judged at k = 12/50/200 mules, cap off vs 1×/2× honest-p95 sizing
  (100 seeds/cell, `v6_globalcap_redteam.txt`): **the cap never binds the ring**
  (acquisition-bound at ~2% of its own exit ceiling) **and cannot move the G11
  share** (sybil and honest exits defer in the same queue). Conclusion recorded in
  AUDIT-2 §11: no throughput cap — per-identity or global — is a sybil-share defense;
  **PoP quality is the binding G11 lever, now unconditionally.** windowCap stays
  catastrophic-event insurance (zero honest friction at 1×-p95 sizing). At k=200 the
  attack breaks G1/G2 too — a ring that size is a visible macro attack.
- G11 scaling record: 6.07 / 10.71 / 17.33% at 12/50/200 mules (sub-linear).

Earlier in session 5 — **Art is IN the UI** (`d569c5c`) — the staged batch is wired into its sanctioned slots
(DESIGN-SYSTEM-WEB §6), and the **FTUE guided first Call now exists** (§10.4):

- `Ftue` in `apps/web/src/App.tsx`: a fresh Fox boots into the onboarding beat — the
  art, a two-line invitation, and the lowest-stakes Call as a regular honest ActionRow
  (SplitBar, terms, Unsettled chip — disclosure doesn't relax for onboarding). One
  primary CTA; the first *resolved* Call (win or Nicked) ends FTUE and lands on The
  Tape with the result printed on its row. Persistence: localStorage + the
  fresh-balance check (returning accounts on new devices skip it; private-mode
  storage failure skips rather than loops).
- Item thumbs on Market listing/kit rows (`/art/item-<kind>.webp` — file name is the
  item kind); the after-hours scene on the Market-book and Ledger empty states via a
  new `EmptyState` `art` prop. New CSS: `ofx-art`, `ofx-thumb`, `ofx-empty__art` —
  hairline-framed cards so the dark-world art reads intentionally in both themes.
- Verified live **13/13** (Playwright, fresh dev world): FTUE shows only for a fresh
  Fox, art loads (no 404s), the flow lands on the Tape, thumbs + empties render, zero
  console errors. Build 61.1 KB gz.
- **Still staged, awaiting a surface:** `state-nicked.webp` (no interstitial surface
  exists — inline row results are the design) and `mascot.webp` (character reference;
  the sub-8-KB **layered SVG fox** traced from it is the open derivation task — canon
  requires SVG for in-app mascot instances and it's the base of the jacket cosmetic
  line). **No further AI generation needed** for the current build: all 7 ART-PROMPTS
  are generated and every live slot is covered. Future generations only when their
  features exist (RewardReveal, Margin Called interstitial, OG/social art).

**Earlier in session 5 — the $ALPHA carry is LIVE** (`7c54bc3`), the M4 build-vs-model
gap closed:

- `applyAlphaCarry` (`apps/server/src/settlement.ts`; ECONOMY.md §13.A + §13.D): idle
  in-game $ALPHA decays 0.45%/day (no floor, proportional across lots — the seasoning
  mix is preserved); the total position above the published 250-$ALPHA per-identity
  shelter pays 4.5%/day on the excess. Capture → ALPHA treasury. Lazy like the Scrip
  carry; dormancy is not a shelter (the catch-up posts on next touch). Applied before
  every lot mutation (deposit credit, exchange buy/sell) and before withdrawal pricing —
  the patient mule now pays ≈−24% for the 60-day seasoning wait the sim always charged.
- **Side door closed:** held (unclaimed) deposits could age seasoning decay-free; they
  now pay the §13.A idle decay for the wait at claim (base rate only — unclaimed value
  belongs to no identity, and a per-address progressive would be split-dodged anyway).
- Constants: `ALPHA_CARRY` in `@outfox/shared`; the shelter and holding cost are
  published on the Clearinghouse Rules sheet. Suite **83/83** (13 new tests pinned to
  an independent reference schedule); web build green (60.6 KB gz); dev-DB migration
  verified (`alpha_carry_at` backfills to upgrade time — never retroactive).
- Known pre-existing (not from this round): `tsc -p apps/server` flags the old
  `LotRow[]` cast at `settlement.ts` (interface vs `Record` overlap) — present at
  `f598987` too; the web build's tsc is the green gate.

## Previous session (2026-08-11, end of session 4)

**The Clearinghouse UI is BUILT** (`5f5edf9` + `f598987`) — the full money loop has a
player-facing surface, entered from the Ledger:

- `apps/web/src/Clearinghouse.tsx`: live rate strip + spark (the G9 series via
  `/api/exchange/history`), the Exchange desk (buy/sell, server quotes, minOut, live
  capacity clamps — over-cap entry impossible per §13), the cash-out ladder (link
  wallet → verify → amount → itemized locked quote → request → vest → redeem), weekly
  capacity meter, deposits, and the published **Clearinghouse Rules** sheet (real
  numbers from `@outfox/shared`). Dates not durations (§19.2) throughout.
- **The client carries no ABI code and no chain library:** every wallet transaction's
  calldata (approve, deposit, voucher redemption) is encoded server-side (`chain.ts`)
  and relayed through a ~90-line EIP-1193 helper (`wallet.ts`). Privy replaces it
  wholesale later; the rung ladder and demanding-surface gates stay.
- The design came from the Claude Design ClearinghouseScreen; its placeholder economics
  (4% fee, 48h vesting, "Monday UTC" resets) were replaced by the real constants and
  rolling windows — canon wins over the mock.
- `playerView` now reports real rungs 0–3 (was clamped to 0|1 since the slice).
- **Verified live** (Playwright, chainless dev world): 14/14 — R1 register, Gig farm,
  buy on the exchange, Fresh chip, capacity meters, honest no-wallet and chain-off
  states, Rules sheet, zero console errors. Suite 70/70; tsc clean; build 60 KB gz.
- Earlier this session: **first art batch wired** (PWA icons live, illustrations staged
  under `apps/web/public/art/` — see the 2026-08-11 log entry).

**Next builds, in leverage order:** (1) ~~the Privy R1 adapter, server half~~ **DONE
`ed0657c`** — the client login sheet + claim-shape pass wait on the owner creating the
production Privy app; the **R3 PoP provider stays an OWNER DECISION** (canon:
ECONOMY §9 "Provider TBD"; World ID is chain-agnostic in our server-side-verify
architecture, but Orb coverage + regulatory record must be checked against the
geofence, and counsel may force KYC-at-cash-out — which would make the KYC vendor *be*
the PoP; v6c made this choice load-bearing); (2)
wallet-in-the-loop pass of the Clearinghouse against anvil (the chain path is
M4-proven server-side; the wallet UX still wants a manual run); (3) sim-side: the
round-7 external open-market scenario (§9) + split-hoard variant; (4) the §13.B
treasury-op job (TWAP legs); (5) art derivation: the sub-8-KB layered SVG fox
(jacket cosmetic base).

*(Session-2 design notes remain in force: visuals source of truth = the "Outfox Design
System" project in Claude Design (project reference: founders' private notes); run
`apps/web/scripts/aa-check.mjs` after any colour change; the design kit's economy
numbers are placeholders — UI reads real ones from `@outfox/shared`.)*

## Git

This repo is the **fresh-history Solana continuation** of a private development
repository; the pre-migration history is not carried over (provenance details:
founders' private notes). Work happens on `master`.

as-of: step-4 client commit (2026-08-28)
