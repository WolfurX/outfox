# chain edge — Settlement, identity, and the valve

> **2026-08-25:** describes the EVM-era edge (now the frozen `contracts/` reference).
> Rewrite this page during migration
> steps 2–5; the trust model and identity ladder carry over.

**Canon:** `contracts/README.md` (trust model), `contracts/src/`, `DESIGN-SYSTEM-WEB.md`
§10 (identity ladder), `ECONOMY.md` §9 (the valve, read through the pivot banner).
**Live:** testnet 46630 — `contracts/deployments/testnet-46630.md` (Alpha
`0x7bfdE6C6…`, Settlement `0xD143081F…`; deposit + voucher withdrawal + all guards
verified on-chain 2026-07-11).

## Architecture in one line

The hot-loop economy is off-chain and server-authoritative; the chain holds exactly two
things — the inert $ALPHA token and the `Settlement` edge (deposits + server-signed
EIP-712 withdrawal vouchers).

## Settlement trust model (as reviewed, `c93276d`)

- Deposits permissionless (event-indexed → credited to the R2-linked account).
- Withdrawals: single-use nonce + expiry vouchers signed by the game server's **hot
  signer key**; a stolen signer key drains at most `windowCap` per **rolling** 24h
  (leaky bucket — an adversarial review replaced the tumbling window that allowed a 2×
  boundary burst). The **cold owner key** (2-step, renounce disabled, `signer != owner`
  enforced) can pause and rotate but **cannot move funds**. `reserve()` = on-chain PoR.
- Mainnet gates: owner → multisig; voucher-reissue reconciliation flow server-side;
  TokenSPICE contract-in-the-loop pass; legal counsel.

## Identity ladder (R0→R3)

R0 guest (anonymous, device-bound; full core loop) → R1 registered (Privy email/social +
silent embedded 4337 wallet; market writes gate here) → R2 linked external wallet (SIWE;
deposits + withdrawal destination) → R3 verified (**provider = pending owner decision**,
only at cash-out; canon "Provider TBD", ECONOMY §9). Wallet jargon banned at R0/R1 — the
embedded account is "your Book".

**R1 Privy adapter — server half IMPLEMENTED** (2026-08-15, `apps/server/src/
auth-privy.ts`): offline ES256 identity-token verification against the app's static
verification key (alg pinned, iss/aud/exp/nbf enforced, downgrade attacks tested), a
single `/api/register/privy` route covering register + collision-adopt with the
§10.1 semantics, and bootstrap advertising `auth.mode` so the client picks its sheet.
Proven over HTTP with a locally-minted keypair (register → collision → adopt; forged
token refused) — **go-live needs only the production Privy app** (owner: create
it, set `OUTFOX_PRIVY_APP_ID` + `OUTFOX_PRIVY_VERIFICATION_KEY`), then a claim-shape
verification pass against the live app and the client login sheet (lazy chunk, dev
sheet stays the fallback). Dev auth remains for the chainless world and tests.

## The valve — IMPLEMENTED (`apps/server/src/settlement.ts`, `chain.ts`)

Every §9 gate runs server-side **before** a voucher is signed: **V1** R3 rung gate ·
**V2** seasoning lots (seasoned spent first; unseasoned pays the 40% surcharge — time
can't be wash-traded) · **V3** 5% fee · **V4** 14-day vesting · **V5** rolling weekly cap
· **V6** solvency (never owe more than `reserve()`, counting other unconfirmed vouchers).
The indexer folds `Deposited`/`Withdrawn` logs in, keyed by `(tx_hash, log_index)` →
re-indexing never double-credits; deposits from unlinked addresses are held, not lost.
ALPHA is BigInt wei end to end. Voucher nonces are random uint256 (a row id would collide
with burned on-chain nonces after a DB restore — found by driving the real chain).
Proven e2e on testnet: deposit → index → request → vest → sign → redeem → confirm →
solvency holds. **Client UI: the Clearinghouse** (2026-08-11, `apps/web/src/
Clearinghouse.tsx`) — the ladder, deposits, cash-out, and voucher redemption, with all
wallet calldata encoded server-side (the client has no ABI code). Still stubbed: real
Privy (R1) and World ID (R3) adapters.

**The $ALPHA carry — IMPLEMENTED** (2026-08-15, `applyAlphaCarry` in `settlement.ts`;
`ECONOMY.md` §13.A + §13.D): idle in-game $ALPHA decays 0.45%/day (no floor,
proportional across lots so the seasoning mix is preserved), and the total position
above the published 250-$ALPHA per-identity shelter pays 4.5%/day on the excess —
constants in `@outfox/shared` `ALPHA_CARRY`, published on the Clearinghouse Rules
sheet. Lazy like the Scrip carry (dormancy accrues; the catch-up posts on next touch),
capture → ALPHA treasury, applied before every lot mutation and before withdrawal
pricing — the patient mule now pays for the wait (closes the M4 build-vs-model gap),
and held (unclaimed) deposits pay the idle decay for their wait at claim. No staking in
the build yet, so the whole position is liquid; the staked exemption comes with the
staking module.

Deposit-fed selling into the game is throttled by the internal exchange's flow cap +
volatility fee (§13.B) — **implemented** (`apps/server/src/exchange.ts`, M4-verified
2026-08-09; the pool's own inventory and the ALPHA fee treasury count as PoR
liabilities, so nothing in the ledger is unbacked). Proven consequence: even permanent
cap-pinned external dumping (−97% token price) leaves every playability gate green
(`sim/v6_extdump_probe.txt`).

## Key hygiene (standing)

Fresh throwaway deployer keys per environment, never reused; `broadcast/` gitignored
(records deployer addresses); production custody = hot/cold split + multisig owner.

as-of: 7c54bc3
