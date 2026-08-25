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
