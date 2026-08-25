# Outfox — Phase-1 vertical slice

The `PLAN.md` §6 slice: **scaffold + one core-loop action, playable in the browser,
server-authoritative, no token.** One guest Fox boots in seconds, runs Calls and Gigs,
spends on sinks, and trades on the Open Market — with the economy's core invariants enforced
in code, not copy.

## Run it

```bash
npm install
npm run dev:server   # Fastify + node:sqlite on :8787
npm run dev:web      # Vite on :5173 (proxies /api)
npm test             # engine invariant tests (vitest)
```

## What the slice implements (and where it comes from)

| Piece | Source of truth |
|---|---|
| Guest R0 identity (httpOnly session, no wallet, <10 s to the loop) | `DESIGN-SYSTEM-WEB.md` §10.1 |
| Calls (chance) → **Unsettled Scrip only**; Gigs (work) → Settled | `ECONOMY.md` §6 guardrail #1 |
| The provenance firewall at the P2P boundary (market buys = Settled only, engine-enforced + tested) | `ECONOMY.md` §6 / VALIDATION-BENCHMARKS critical finding |
| Single mutation gate + provenance-tagged ledger | `DESIGN-SYSTEM-WEB.md` §12 (`ProvenanceChip`) |
| Conservation audit (players + treasury == mints) | sim G12 discipline |
| Carry (demurrage, lazy daily, floor-exempt, capture-not-burn) | `ECONOMY.md` §2.1, sim-calibrated δ |
| Market fee 3.5% → treasury (CAPTURE) | sim-calibrated φ_market |
| Lazy regen bars (Focus / Risk Appetite), one shared client tick | v1 §6 timer rule |
| Tokens/theme (dark canonical + light, no-FOUC), tab bar, Outfox vocabulary | `DESIGN-SYSTEM-WEB.md` §2/§4/App. A |
| TAPE-HALTED offline banner; reveal ≤320 ms constant-duration, no theatrics | `DESIGN-SYSTEM-WEB.md` §1.2/§8.2 |

Items on the market are **deterministic-origin only** (starter Terminal, pity-counter
Signal Boosters from Gigs). Chance never mints a tradable object — the sim formally
descoped item-hoard vehicles, and the slice keeps chance value inside Unsettled Scrip.

## Deliberate slice boundaries

- **No token, no cash-out, no wallets** — Phase 2+ (`ROBINHOOD-FEASIBILITY.md` migration steps).
- **node:sqlite, single process** — persistence is portable SQL; production target is
  PostgreSQL + Redis (`PLAN.md` §4).
- **R1 identity ladder is wired (Phase 2).** Guests (R0) play, earn, and spend; the
  Open Market write surfaces (list/buy) gate at R1 via the demanding-surface flow —
  tapping List/Buy as a guest opens the upgrade sheet with the action queued and
  auto-resumed on success (§10.1). Upgrade is in-place (Scrip/items/stats persist);
  credential collision shows a choose sheet (continue-as-existing / cancel), never a
  silent merge. **Auth is a dev adapter** (email + one-time code, code returned inline
  when `OUTFOX_DEV_AUTH=1`); the production Privy embedded-wallet flow replaces
  `startRegister`/`verifyRegister` wholesale — the rung model and gate stay.
- **Service worker is wired (Phase 2).** Precaches the app shell only; API responses are
  never cached (offline = read-only TAPE HALTED because /api fails, not stale money
  state). Polite update banner + forced-update message path (§1.1). Registered after
  first paint; absent in dev.
- **Still deferred:** notifications, F3/cash-out, external wallets, PostgreSQL.
- `GET /api/debug/conservation` exists for the slice only; drop before any public deploy.
- Slice constants (`packages/shared`) are demo-paced; production values must come from
  the sim's calibrated `DEFAULT_PARAMS` (TEC discipline — no unswept production constants).
