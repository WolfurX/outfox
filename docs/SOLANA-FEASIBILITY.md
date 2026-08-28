# Outfox → Solana: Pivot Record & Migration Contract

**Date:** 2026-08-25 · **Status:** ADOPTED (owner decision) · **Supersedes:** the
Robinhood Chain feasibility study (internal document; its conditions framework is
inherited below and each condition's status is tracked in §5).

**One-line:** the economy, sim, theme, server, and client port unchanged (proven
chain-agnostic by the last migration); the chain edge is rewritten for Solana; and this
time the pivot is driven by the thing the last feasibility study flagged as the
project's single biggest hole — distribution.

---

## 1. Why Solana

This is an **owner decision, not a technology verdict.** The prior study's final word
was: "What Telegram gave for free, this pivot makes you buy. Approve it as a platform
migration with a funded acquisition strategy, or don't approve it at all." Robinhood
Chain never answered that; Solana does:

1. **Distribution.** The team's existing network and community are on Solana — the
   item the prior study rated "blocking" is no longer a cold-start problem to buy.
   (Specifics are internal.)
2. **Ecosystem fit:** consumer-crypto users, mature wallet UX, deep DEX liquidity for
   a tradable token, near-zero fees for the settlement edge, and an active builder/
   grants ecosystem. (Specific integration claims are in §4's verification queue, not
   asserted here.)
3. **Counsel remains a hard pre-launch gate** regardless of chain (`CLAUDE.md`,
   `VALIDATION-BENCHMARKS.md` §4).

## 2. What carries over unchanged

Everything the last migration proved chain-agnostic, now with the added evidence of the
completed AUDIT-2 campaign:

- **The economy design** (`ECONOMY.md`) and every calibrated parameter.
- **The sim and its record:** standard gate 6/6 at 500 seeds, red-team 6/7 with the one
  open item (PoP quality / smart_sybil G11) being a product decision, not a chain
  property. The committed scorecards remain valid — the 2026-08-25 vocabulary
  unification was proven pure by an identical-seed A/B diff (see `sim/README.md` note).
- **The server** (engine, exchange, settlement valve, rung-ladder auth semantics) and
  **the web client** (PWA, Clearinghouse, FTUE, design system) — all TypeScript, no
  chain assumptions outside the edge modules.
- **The theme** (`THEME-OUTFOX.md`), now as the single unified vocabulary.
- **The validation discipline:** no economy code ships until the sim gate passes; the
  chain edge is not done until M4 reruns against the real programs.

## 3. What is rewritten (the chain edge, and only the chain edge)

| Element | EVM era (frozen reference in `contracts/`) | Solana target |
|---|---|---|
| $ALPHA token | ERC-20, fixed 2,000,000, no mint function | SPL mint, fixed 2,000,000, **mint authority revoked** at genesis |
| Settlement | Solidity contract: escrow, deposits, signed-voucher withdrawals, global rolling cap, pause | Anchor program: PDA escrow, same semantics; vouchers via native ed25519 verification |
| Server chain adapter | `chain.ts` (EIP-1193 calldata encoding) | Solana adapter (server-built transactions; client stays ABI-free, same architecture) |
| Client wallet layer | `wallet.ts` (~90-line EIP-1193 relay) | Wallet Standard relay implemented directly (no wallet library — see the §4 Jupiter-kit verification outcome); SIWS message auth replacing the Privy token verify at the same seam (rung semantics unchanged) |
| Proof-of-reserves | Contract balance vs ledger | Escrow token-account balance vs ledger (same invariant) |
| M4 harness | anvil + viem loop | local validator (`solana-test-validator`) + the same priced scenarios |

`contracts/` stayed in-tree as the behavioral spec for the port and was **deleted
2026-08-28** when the devnet end-to-end verification passed (git history keeps it).
Deploy target order: localnet (M4 ✅) → devnet (✅ `programs/deployments/devnet.md`) →
mainnet only behind the §5 gates.

## 4. Verification queue (claims to check before they are relied on — none are
asserted as fact yet)

- ~~Jupiter wallet kit: current package, SIWS support, license, maintenance state.~~
  **Verified 2026-08-28 and REJECTED:** `@jup-ag/wallet-adapter` 0.2.6 is MIT and
  maintained (last publish 2026-08), but its dependency tree ships `@coral-xyz/anchor`,
  emotion, and react-query into the client bundle plus its own modal UI — violating the
  client architecture (no chain code, no foreign UI system) and the perf budget.
  Resolution: the Wallet Standard window-event protocol is implemented directly in
  `apps/web/src/wallet.ts` (zero dependencies; `standard:connect`, `solana:signMessage`,
  `solana:signAndSendTransaction`), which every major Solana wallet registers into.
- ~~On-ramp rails for F3 on Solana (the load-bearing faucet).~~ **Verified
  2026-08-28** (internal coverage study, provider-page/API-checked). Headline:
  native USDC-SPL is carried by every major on-ramp, so F3 pricing is USDC-first
  and the EVM-era bridge-fallback architecture is unnecessary; wallet built-in
  ramps cover day 0 at zero fixed cost; regional local-payment rails exist but
  concentrate in aggregator-only providers and must be re-verified against live
  quotes before launch-market commitments. The F3 rail choice remains coupled to
  the geofence/counsel decision.
- ~~PoP/R3 options in the Solana context.~~ **Verified 2026-08-28.** World ID is not
  viable as primary for our launch geography (suspended/halted in several SEA
  markets through 2025–26; its non-Orb credential path does not claim
  human-uniqueness), and Solana-native PoP no longer exists (Civic's uniqueness
  product sunset July 2025). The viable class is biometric-dedupe verification at
  cash-out, with zk-passport schemes as a possible privacy lane. Provider choice
  remains the standing owner decision (couple with geofence + counsel); decision
  brief is internal.
- ~~DEX/liquidity venue for $ALPHA.~~ **Verified 2026-08-28.** Launch norm for a
  fixed-supply token with team-seeded liquidity: a standard constant-product USDC
  pool on a major venue, full-range, with the LP permanently locked via the venue's
  native lock (verifiable on-chain, fee stream retained); no bonding-curve
  launchpads. Jupiter routes new pools automatically and applies a liquidity
  round-trip check after a grace period — the depth floor that passes it with margin
  starts around $25K. POL depth at launch remains the standing owner decision;
  venue/sizing brief is internal.
- ~~Fee/compute-unit budget for the settlement flows; priority-fee posture.~~
  **Measured 2026-08-28 on the live devnet deployment** (finalized txs, program
  `FFNw…n9o1`):

  | Flow | CU consumed | Base fee | Note |
  |---|---|---|---|
  | Deposit | 12,617 | 5,000 lamports | 1 tx signature |
  | Withdraw (redeem) | 27,432 | 10,000 lamports | the ed25519 precompile verify is charged AS a signature (5,000 + 5,000) |
  | Pause / Unpause | ~4,140 | 10,000 lamports | payer + admin signatures |
  | Initialize (genesis, once) | 54,892 | 20,000 lamports | 4 signatures |

  Posture: settlement traffic is low-frequency by design (deposits + vested
  redemptions only), so even a generous priority fee is economically noise — at
  50k CU × 100k microlamports/CU the tip is 5,000 lamports (< $0.002). Follow-up
  (engineering, review-gated): `prepareRedeemTx` requests a 400k CU limit vs
  27.4k measured — drop to ~60k (2x headroom) and add a
  `setComputeUnitPrice` tip before mainnet, since fee markets price on the
  REQUESTED limit. Fees are a non-issue for the F3/F4 economics.
- ~~Grant/builder programs: current terms and eligibility.~~ **Verified 2026-08-28.**
  Current-term summaries collected (Superteam grants, Solana Foundation
  milestone/convertible tracks, Colosseum hackathon + accelerator, gaming-specific
  programs); no published exclusion language catches the game's mechanics. The
  application plan is internal.
- ~~Distribution plan: revise for the Solana posture.~~ **Done 2026-08-28** (internal
  document, per the standing practice): re-based on measured Solana gaming actuals
  and current channel research; the condition-2 kill machinery carries over
  unchanged.

## 5. Conditions inherited from the Robinhood framework

| # | Condition (2026-07-02 wording) | Status now |
|---|---|---|
| 1 | Sim decision-grade at ≥500 seeds | ✅ done (AUDIT-2, v5/v6 record) |
| 2 | Written distribution plan | 🟡 exists (internal); revise for Solana (Phase C) |
| 3 | Payments (F3) + auth answer | 🟡 auth answered (SIWS at the proven seam); F3 = §4 queue |
| 4 | Legal Phase-0 review (counsel) | ⬜ unchanged, hard launch gate |
| 5 | Retention re-baseline | ⬜ unchanged |
| 6 | Governance unlock recorded | ✅ this document |

## 6. Migration steps

1. ✅ Repo: fresh-history `outfox` repo; vocabulary unified (Outfox/$ALPHA everywhere);
   rename purity proven by identical-seed sim diff; retired-vocab guard in CI.
2. Anchor workspace (`programs/`): $ALPHA mint + Settlement program to the `contracts/`
   reference semantics; program tests to parity with `Settlement.t.sol`.
3. Server: Solana adapter replacing `chain.ts`; SIWS auth replacing `auth-privy.ts` at
   the same seam; suite stays green throughout.
4. Client: wallet kit + SIWS login sheet; the Clearinghouse's server-encoded
   transaction architecture carries over.
5. **M4 rerun** against the programs on a local validator — the gate for calling the
   chain edge done. Then devnet deploy + end-to-end verify (deposit, withdraw voucher,
   replay/forgery rejection, pause).
6. Phase C: whitepaper + distribution plan updates; §4 verifications; launch materials.
