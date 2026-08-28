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
