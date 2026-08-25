# Outfox contracts — the chain edge

> **FROZEN EVM REFERENCE (2026-08-25).** The project migrated to Solana
> (`docs/SOLANA-FEASIBILITY.md`). These contracts and their tests are kept as the
> behavioral spec for the Anchor port in `programs/` and will be deleted once the
> M4 harness passes against the Solana programs. Do not develop here.

Phase-2 module (ROBINHOOD-FEASIBILITY.md migration step 4). Two contracts, nothing else:
the hot-loop economy is off-chain and server-authoritative (`ECONOMY.md` §9 — read its
pivot banner); the chain holds only the token and the settlement edge.

| Contract | What it is | What it deliberately is NOT |
|---|---|---|
| `Alpha.sol` | Fixed-supply ERC-20 (+ ERC-2612 permit). Entire 2,000,000 cap (= the economy model's hard cap) minted once to the treasury at deploy. | No mint function, no owner, no pause, no upgrade path — the token is inert. All economic controls (carry, seasoning, vesting, fees) live in the game ledger. |
| `Settlement.sol` | The only value edge. Permissionless deposits (event-indexed, credited to the R2-linked account). Withdrawals by game-server-signed EIP-712 voucher (single-use nonce + expiry), pausable, under a **rolling** withdrawal cap (leaky bucket). `reserve()` = on-chain proof-of-reserves. | No owner path moves funds — the owner can pause and rotate the signer, never seize. No upgradeability, no `renounceOwnership`. Per-identity limits, PoP, vesting, and fees are game-side gates applied BEFORE a voucher is signed. |

**Trust model (stated plainly):** this is a custodial edge, as the server-authoritative
design requires.
- A compromised **signer** (hot, game server) key can drain at most `windowCap` in **any
  rolling 24h** before the owner pauses. The cap is a *leaky bucket*, not a fixed window
  — an adversarial review found a fixed window would allow a 2× burst across the boundary,
  which is exactly the bound this is meant to give. Size `windowCap` near real daily
  withdrawal volume.
- The **owner** (cold, `Ownable2Step`) can pause and rotate the signer but **cannot move
  funds**; `renounceOwnership` is disabled (renouncing while paused would freeze the
  reserve forever). Constructor and setters enforce `signer != owner` — sharing that key
  would let one compromise raise the cap and drain everything, silently voiding the bound.
- **Accepted, and gates for mainnet, not testnet:** the owner is a single EOA with no
  timelock — for mainnet, move ownership to a multisig (owner-key loss is the one
  unbounded failure). Voucher deadlines can expire during a pause or signer rotation, so
  the game ledger must treat a withdrawal as spent only on on-chain confirmation and be
  able to reissue (new nonce) — that reconciliation flow is server-side work, not on-chain.
- **Deployment invariant:** `Settlement` must be pointed at the fixed-supply, non-fee
  `Alpha`. It takes a generic `IERC20`; a fee-on-transfer or rebasing token would make
  `Deposited(amount)` over-credit and `reserve()` drift. `Deploy.s.sol` always wires a
  freshly deployed `Alpha`, and the token address is never read from env.
- Block timestamps come from the Orbit sequencer (bounded drift); day-scale windows and
  voucher deadlines tolerate it.

The game ledger's withdrawable liabilities must never exceed `reserve()` — the sim's
proof-of-reserves invariant, now explorer-checkable.

## Network facts (verified 2026-07-11 against docs.robinhood.com/chain)

| | Chain ID | RPC | Explorer |
|---|---|---|---|
| Testnet | **46630** | `https://rpc.testnet.chain.robinhood.com` | `https://explorer.testnet.chain.robinhood.com` |
| Mainnet | **4663** | `https://rpc.mainnet.chain.robinhood.com` | `https://robinhoodchain.blockscout.com` |

Gas token is ETH; the chain is an Arbitrum Orbit L2 with blob DA. `Deploy.s.sol` hard-fails
on any other chain id. Always re-verify before deploying: `cast chain-id --rpc-url robinhood_testnet`.

## Deploy (testnet)

1. **Key hygiene first**: generate a FRESH throwaway deployer key
   (`cast wallet new`). Fund it with testnet ETH via the official faucet
   (`faucet.testnet.chain.robinhood.com` — check what its "verification" requires before
   using; if it wants a Robinhood account, use the fallback) or the canonical Orbit
   bridge from Sepolia. Testnet deployer keys are disposable and never reused.
2. `cp .env.example .env` and fill addresses. Treasury / signer / owner must be three
   DIFFERENT keys, **and none of them may be the deployer** — the script hard-fails
   otherwise (minting the whole supply to a throwaway hot key is the obvious footgun).
   Signer is the game server's hot key; owner is cold.
3. `cast chain-id --rpc-url robinhood_testnet` → must print `46630`.
4. `forge script script/Deploy.s.sol --rpc-url robinhood_testnet --private-key $DEPLOYER_KEY --broadcast`
5. Record the addresses; check token metadata on the explorer says only "Alpha/ALPHA".
   The pre-publication sweep (repo `CLAUDE.md` rule 3) covers **verified source too** —
   published NatSpec/comments must not cite internal repo artifacts or identities.
   `broadcast/` is gitignored: it records deployer addresses.

Mainnet (chain 4663) deploys only after: the TokenSPICE contract-in-the-loop pass
(migration step 5), the legal counsel gate (step 10), and with fresh production keys
under a proper custody setup.

## Test

```bash
forge build && forge test
```

29 tests: fixed supply, deposit paths (incl. permit + griefed-permit), voucher
single-use/expiry/signature/tamper rejection, pause, rolling-cap enforcement (linear
leak, no boundary burst, fuzzed rolling invariant), role-separation guards
(`signer != owner`, `cap > 0`), `renounceOwnership` disabled, owner-cannot-move-funds,
2-step ownership.

Reviewed by a 3-lens adversarial workflow (signatures/replay, accounting, ops lifecycle)
with per-finding verification; 12 findings confirmed, all fixed or documented above.
