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

Docs are the source of truth, each owning one domain: `docs/ECONOMY.md` (priority #1,
economy rules win all conflicts), `docs/GDD.md` (game rules and systems, unified
vocabulary), `docs/PRD.md` (scope, releases, acceptance; the live roadmap is its §5),
`docs/ARCHITECTURE.md` (engineering contract: components, module map, the system
contract every new game system follows, decisions log), `docs/DATA-ARCHITECTURE.md`
(its data chapter: every economic mutation is an append-only event, live metrics use the
sim's own estimators), `docs/INFRASTRUCTURE.md` (environments, pipeline, keys, backups,
runbooks; `deploy/README.md` is the one-box runbook), `docs/DESIGN-SYSTEM-WEB.md` (active
UI spec; `docs/DESIGN-SYSTEM.md` is the archived Telegram-track v1), `docs/THEME-OUTFOX.md`
(canonical vocabulary, all copy uses these terms only), `docs/SOLANA-FEASIBILITY.md`
(chain migration contract), `docs/LAUNCH.md` (how the $ALPHA mint and its first, permanently
locked liquidity are created through Meteora), `sim/` (economy gate, no economy code ships until it passes
at full seeds). `PLAN.md` is the kickoff record, read as history.

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
**Mechanics-layer exception (owner ruling 2026-09-12):** `docs/ECONOMY.md`,
`docs/ECONOMY-SIM-SPEC.md`, `docs/ECONOMY-ROBUSTNESS.md`, and `sim/` keep the terms they
were validated under (Credits, Clean/Bound, Exploits, Compute/Nerve, Operations,
Safehouses, Quarantine); they are frozen canon and the sim's evidence trail. The bridge
is `docs/GDD.md` §2.4. Every other doc, all code, and all player-facing copy use the
canonical terms only.

## Chain

This repo is the Solana continuation of a private development repository; the economy
design, its simulation campaign (AUDIT-2 rounds 2–6c), and the server/web build carry
over unchanged, with the model, calibration, and committed scorecards intact.

- **Chain: Solana.** The chain edge lives in `programs/` (Anchor/Rust): $ALPHA as an
  SPL mint with the mint authority revoked (fixed 2,000,000 — the no-mint guarantee;
  from the launch on, created by the Meteora launch pool, `docs/LAUNCH.md`),
  Settlement as a program (PDA escrow, deposits, ed25519-signed voucher redemption,
  global rolling withdrawal cap, pause). **Live on devnet, verified end-to-end**
  (`programs/deployments/devnet.md`). The EVM-era reference implementation
  (`contracts/`) served as the behavioral spec for the port and was deleted when the
  devnet e2e passed (2026-08-28); it remains in git history.
- **M4 discipline carries over:** the Solana Settlement program is not "done" until the
  contract-in-the-loop harness reruns against it on a local validator and prices match
  the model. Devnet first; mainnet only behind the launch gates.
- Server stays TypeScript; Rust is the on-chain language. Client wallet flow: Solana
  wallet sign-in (SIWS) via Jupiter's wallet kit, keeping the rung-ladder collision
  semantics from the provider-agnostic auth seam.

## Security posture (standing — this project handles user funds)

This is custody code: real people's money crosses the chain edge. Treat every change to
the settlement program (`programs/`), the chain adapter and indexer
(`apps/server/src/chain/`), the ledgers and their gates (`apps/server/src/ledger/`), the
§9 gates and the carry (`apps/server/src/economy/`), and the identity adapters
(`apps/server/src/identity/`) as security-critical.

- **Model floor, sized to the stake (owner, 2026-10-03).** The top tier is for what
  touches custody: changes to the program, the voucher path, the ledger gates, and the
  independent review of those. Finders, mechanical stages, doc checks and refuters run
  on cheaper tiers (seats as in the wiki's workflow-seats skill). A review is sized to
  the diff: a few finders and one refuter per finding, not a fleet; one review per round
  before it ships, not one per commit. Fifty top-tier agents for one round is the
  mistake this line exists to prevent.
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
  nothing real-money goes live before it. Deployer/treasury key hygiene: fresh keys
  per environment, hot/cold split (voucher signer is never the admin), and a multisig
  admin for anything real.
