# Claude project guidance — Outfox

**Orientation:** start at `wiki/state.md` (the llm-wiki — a NON-NORMATIVE derived layer
for fast navigation; conventions in `wiki/CLAUDE.md`). **Round-close discipline:** any
commit that changes canon docs, sim, or programs also updates the touched wiki pages +
`wiki/state.md` and appends one `wiki/log.md` line. Canon always wins over wiki content.

**Whitepaper discipline (standing):** the published whitepaper
(https://outfox.gitbook.io/whitepaper/, source `whitepaper/`) tracks the project. Any
round that changes what the whitepaper states — built-vs-designed status, roadmap
phases, economics, chain facts, results — also updates the affected `whitepaper/`
pages and runs `scripts/publish-whitepaper.sh`. Everything under `whitepaper/` is
public on publish: redaction rules apply, honesty markers ([designed] vs verified)
stay accurate, and the gambling-vocabulary blacklist holds.

Docs are the source of truth: `PLAN.md` (roadmap), `docs/ECONOMY.md` (priority #1 —
economy rules win all conflicts), `docs/GDD.md`, `docs/DESIGN-SYSTEM-WEB.md` (active UI
spec; `docs/DESIGN-SYSTEM.md` is the archived Telegram-track v1), `docs/THEME-OUTFOX.md`
(canonical vocabulary — all copy uses these terms only), `docs/SOLANA-FEASIBILITY.md`
(chain migration contract), `docs/DATA-ARCHITECTURE.md` (data-oriented design contract —
every economic mutation is an append-only event, live metrics use the sim's own
estimators; all server/indexer modules build against it), `sim/` (economy gate — no
economy code ships until it passes at full seeds).

**Vocabulary (unified 2026-08-25):** one vocabulary everywhere — **Outfox** the game,
**$ALPHA** the token, the THEME-OUTFOX.md terms for everything player-facing. The
pre-Solana dev-era names are retired; they survive ONLY inside immutable sim result
records (`sim/*.txt`, `sim/results_*.json`, `sim/sweep_*`, `sim/AUDIT-2.md`,
`sim/REDTEAM.md`, `sim/M4-CONTRACT-LOOP.md`) and the explanatory vocabulary note in
`sim/README.md` — never edit those files to "fix" the
names: they are the evidence trail for the committed scorecards, and rename purity was
proven by an identical-seed A/B diff (2026-08-25, note in `sim/README.md`).
`apps/server/test/vocab-guard.test.ts` enforces that the retired names never re-enter
living code. In sim code, `tail_alpha` is the Pareto tail index (the G7 metric);
`alpha`/`ALPHA_*` identifiers are the token.

## Chain

This repo is the Solana continuation of a private development repository; the economy
design, its simulation campaign (AUDIT-2 rounds 2–6c), and the server/web build carry
over unchanged, with the model, calibration, and committed scorecards intact.

- **Chain: Solana.** `contracts/` holds the frozen EVM reference implementation
  (Alpha.sol + Settlement.sol + tests, plus the testnet deployment record) — it is the
  behavioral spec for the Anchor port and gets deleted once M4 passes against the
  Solana programs. New on-chain work lives in `programs/` (Anchor/Rust): $ALPHA as an
  SPL mint with the mint authority revoked (fixed 2,000,000 — the no-mint guarantee),
  Settlement as a program (PDA escrow, deposits, ed25519-signed voucher redemption,
  global rolling withdrawal cap, pause).
- **M4 discipline carries over:** the Solana Settlement program is not "done" until the
  contract-in-the-loop harness reruns against it on a local validator and prices match
  the model. Devnet first; mainnet only behind the launch gates.
- Server stays TypeScript; Rust is the on-chain language. Client wallet flow: Solana
  wallet sign-in (SIWS) via Jupiter's wallet kit, keeping the rung-ladder collision
  semantics from the provider-agnostic auth seam.

## Security posture (standing — this project handles user funds)

This is custody code: real people's money crosses the chain edge. Treat every change to
the settlement program (`programs/`), the chain adapter (`apps/server/src/chain.ts`),
the §9 gates (`apps/server/src/settlement.ts`), the exchange (`apps/server/src/
exchange.ts`), and the auth adapters as security-critical.

- **Model floor: Fable-grade, no downgrades.** Every subagent spawned for work on this
  project runs on Fable (the main-loop model) or higher — never a cheaper tier, and
  never a `model` override that downgrades security-relevant review, review-verify, or
  implementation. Fable and Mythos 5 are the same underlying model; this is the
  capability floor, deliberately.
- **Adversarial review, not self-review.** Custody-touching changes get an independent
  adversarial pass (fresh agent or reviewer, not the author) before they are called
  done. Money-path changes carry a regression test that goes red on the exact defect.
- **Fail closed.** On any ambiguity in a value-moving path, refuse rather than guess.
  The on-chain program enforces only what the chain must (single-use nonce, expiry,
  signature, pause, rolling cap); every economic gate lives server-side and runs BEFORE
  a voucher is signed. Neither layer may weaken assuming the other will catch it.
- **A professional third-party smart-contract + economic audit is a hard pre-mainnet
  gate**, alongside the counsel gate. In-house hardening raises the floor; it is not a
  substitute for an external audit of code that holds funds.

## Repo hygiene

- **Never commit secrets** — keys, RPC tokens, wallet material, `.env` contents.
- **Never commit anything from `private/`** (gitignored): founders-only notes and
  internal documents live there; public files must not quote or cite their contents
  beyond the stubs already in `docs/`. Business, funding, and identity matters stay
  out of the public tree entirely.
- **Legal counsel remains a hard pre-launch gate** (`VALIDATION-BENCHMARKS.md` §4);
  nothing real-money goes live before it. Deployer/treasury key custody follows
  `contracts/README.md` key hygiene: fresh keys per environment, hot/cold split and a
  multisig owner for anything real.
