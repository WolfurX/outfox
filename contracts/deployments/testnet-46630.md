# Deployment — Robinhood Chain testnet (46630)

**Date:** 2026-07-11 · **Status:** live, end-to-end verified on-chain
**Purpose:** migration step 4 (`ROBINHOOD-FEASIBILITY.md`); the target for step 5
(contract-in-the-loop) and the server⇄Settlement integration.

## Addresses

| What | Address |
|---|---|
| **Alpha** (ERC-20, fixed cap) | `0x7bfdE6C66c833c6A7802b309787a0F708e016Ffa` |
| **Settlement** (the valve) | `0xD143081FA41ABcBE9c9A1505AC42a0Cc23A35462` |
| Treasury (holds the cap) | `0xf65CCc9611a4F68Bc5d5038f6c66Db9fFdF7642d` |
| Signer (voucher hot key) | `0x1764bF8DAB277Ce086FEAD715687B2A6572BdEa9` |
| Owner (pause/rotate, cold) | `0x9f5cB0A640Cd1810cE4BBa1e732B48B014172f9a` |

Explorer: `https://explorer.testnet.chain.robinhood.com` · RPC:
`https://rpc.testnet.chain.robinhood.com` · gas token: ETH.

**These are throwaway testnet keys** (`cast wallet new`, kept in gitignored
`contracts/.env`). They must NEVER be reused on mainnet: mainnet needs fresh keys,
a real hot/cold split, and the owner moved to a multisig (`contracts/README.md`).

## Verified on-chain state

Alpha: name `Alpha`, symbol `ALPHA`, `CAP` = `totalSupply` = **2,000,000e18** (= the sim's
hard cap), entire supply at the treasury, no mint path.
Settlement: `alpha` → the token above; `signer`/`owner` as listed; `windowCap` **5,000e18
per rolling 24h**; `paused` false.

## End-to-end behaviour driven live (not just unit tests)

| Action | Result |
|---|---|
| Treasury seeds reserve (10,000 ALPHA) | `reserve()` = 10,000e18 |
| `approve` + `deposit(500)` | `reserve()` = 10,500e18 |
| EIP-712 voucher signed by the signer key, `withdraw(250)` | player +250 ALPHA, `reserve()` = 10,250e18, `usedNonce(1)` = true, leaky `bucket()` = 250e18 |
| **Replay the same voucher** | reverts `NonceUsed()` (`0x1f6d5aef`) ✅ |
| **Voucher forged with a non-signer key** | reverts `BadSignature()` (`0x5cd5d233`) ✅ |
| **`renounceOwnership()` by owner** | reverts `disabled` ✅ (cannot brick the reserve) |
| **`pause()` → withdraw → `unpause()`** | withdrawals revert `EnforcedPause()` while paused ✅ |

The signing flow used here is exactly what the game server will do (EIP-712 domain
`OutfoxSettlement`/`1`, chainId 46630, verifyingContract = Settlement).

## Next

Step 5 (TokenSPICE contract-in-the-loop) and the server⇄Settlement integration (deposit
indexer + voucher signing, built against `docs/DATA-ARCHITECTURE.md`) target this
deployment. Explorer source verification is optional here; if done, the pre-publication
sweep applies (published source must not cite internal repo artifacts).
