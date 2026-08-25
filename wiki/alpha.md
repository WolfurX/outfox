# $ALPHA — the token

> **2026-08-25:** chain facts below are EVM-era; $ALPHA becomes an SPL mint with
> revoked mint authority (`docs/SOLANA-FEASIBILITY.md` §3). Economics unchanged.

**One entity, two names:** $ALPHA is the shipped token (contracts, UI, chain);
**$ALPHA** is the same thing inside the frozen mechanics layer (`docs/ECONOMY*`, `sim/`).
Mapping: `THEME-OUTFOX.md` §2; rule: repo `CLAUDE.md`; enforcement: vocab-guard test.

- **Supply:** fixed cap **2,000,000** (= sim `alpha_max`), minted once to the treasury at
  deploy; no mint function, no owner, no pause — the token contract is inert
  (`contracts/src/Alpha.sol`; ERC-20 + ERC-2612 permit for one-tx deposits).
- **Role:** store-of-value + premium **convenience, never power** (`ECONOMY.md` §7).
  Nothing in the core gameplay loop requires holding it — this is the firewall that
  keeps the game playable under any token-price regime (probes: `sim/v6_extdump_probe.txt`).
- **Acquisition:** F4 primary purchase (USD in; **wealth-indexed pricing** — allocation
  = base·(1+H/href)^−γ, `ECONOMY.md` §13.D) · the internal exchange (Scrip⇄$ALPHA,
  game-ledger AMM — **BUILT** `apps/server/src/exchange.ts`, M4-verified 2026-08-09;
  Settled Scrip only, bought lots land unseasoned) · external DEX (permissionless,
  post-withdrawal).
- **Holding costs:** idle liquid decays ≈ the Scrip demurrage rate (§13.A); staked is
  base-rate exempt; the **total position above the per-identity shelter pays the
  progressive carry** whatever the bucket (§13.D). Locking always strictly beats idle.
- **Exit:** cash-out only via the §9 valve — R3 PoP (World ID), 5% fee + seasoning
  surcharge (unseasoned 40%), 14-day vesting, per-identity weekly cap; settles on-chain
  through `Settlement` vouchers. Boundary fees are operator revenue (§3, proven [0,1.0]).
- **On-chain facts:** Robinhood Chain — testnet 46630, mainnet 4663, ETH gas
  (`contracts/README.md`, verified 2026-07-11).

as-of: 4a88fd8
