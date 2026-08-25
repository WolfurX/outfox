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
