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
| Client wallet layer | `wallet.ts` (~90-line EIP-1193 relay) | Wallet-standard adapter via Jupiter's wallet kit; SIWS message auth replacing the Privy token verify at the same seam (rung semantics unchanged) |
| Proof-of-reserves | Contract balance vs ledger | Escrow token-account balance vs ledger (same invariant) |
| M4 harness | anvil + viem loop | local validator (`solana-test-validator`) + the same priced scenarios |

`contracts/` stays in-tree as the behavioral spec for the port and is deleted once M4
passes on Solana. Deploy target order: localnet (M4) → devnet → mainnet only behind the
§5 gates.

## 4. Verification queue (claims to check before they are relied on — none are
asserted as fact yet)

- Jupiter wallet kit: current package, SIWS support, license, maintenance state.
- On-ramp rails for F3 on Solana (the load-bearing faucet): providers, geo coverage,
  conversion friction. `ONRAMP-COVERAGE.md` was Robinhood/USDG-specific and is
  superseded; redo the coverage study for Solana.
- PoP/R3 options in the Solana context (World ID chain-agnostic server-side verify
  still holds by architecture; provider choice remains the standing owner decision).
- DEX/liquidity venue for $ALPHA (POL depth is a standing owner decision).
- Fee/compute-unit budget for the settlement flows; priority-fee posture.
- Grant/builder programs: current terms and eligibility.
- Distribution plan: revise for the Solana posture (Phase C; internal document).

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
