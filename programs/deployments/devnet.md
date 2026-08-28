# Devnet deployment — 2026-08-28

The Solana chain edge, live on devnet and verified end-to-end
(`apps/server/scripts/e2e-devnet.ts`: deposit → indexer credit (idempotent) →
§9 gates → vest → voucher sign → forged signature rejected → redeem → replay
rejected (nonce single-use) → pause blocks deposits → unpause → indexer confirm →
proof of reserves holds. ALL CHECKS PASSED, 2026-08-28).

| | |
|---|---|
| Cluster | devnet (`https://api.devnet.solana.com`), voucher chain id **1** |
| Program | `FFNwC5HX9jzjnNrLiUkJ3y6uovVCGCpms5jo9R2Yn9o1` |
| Deploy tx | `4L7tjTmYBy9b9GJXpUUBSvr1eyKmfCBPjodc1D5ttkCoYJ373umEPkMzmW5wuFzfs9VhK3u2cWsHpk4fmMRq7rvp` |
| $ALPHA mint | `EGm6SfMKZJ4A4zHN5Fyu9JRpUzkbetku5iWqUu5iZpaa` (9dp, fixed 2,000,000, **mint authority revoked at genesis**) |
| Genesis tx | `5dq9QVQLzuBZyC1Edt4M81yFvx1ruZub9fCbMYo9SE4wofGdrKj8QsGLwAd6eVbG5yDfgew67YDDp4WF4dRAaM9t` (one atomic tx: mint, revoke, initialize) |
| State PDA | `5BfA3t1pjD3n6jR6GDJ42MapgsEb1JVRUuc8s4PmEXXp` |
| Escrow ATA | `ArFm77mP7x2tPnSsBPYtDjwSWYHp5HZ2pPYfdx5GZwqb` |
| Admin (cold) | `3wB38UVsGbz5UPgVYwNZGqEMF7iyAot7Eu27weH4eBZQ` |
| Voucher signer (hot) | `g6i4aTX9evh386rDo6c2xL3WnrYMiNbcwZXULZabpeB` |
| Treasury | `8n8rmq86KfiUXo7miNDFYhozFB7kfAyyMoB8sYhT2sgT` |
| Window cap | 500 ALPHA per rolling 24h (leaky bucket) |

Keys are throwaway devnet keys (fresh per environment, per the standing key
hygiene; they live outside the repo). Mainnet requires fresh keys, a multisig
admin, the third-party audit, and the counsel gate — see `CLAUDE.md`.

The EVM-era reference implementation and its testnet record were removed from the
tree when this deployment closed migration step 5; they remain in git history
(`contracts/` up to the removal commit).
