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
