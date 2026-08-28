# chain edge — Settlement, identity, and the valve (Solana)

**Canon:** `docs/SOLANA-FEASIBILITY.md` (migration contract), `programs/settlement/`
(the program), `apps/server/src/chain.ts` + `settlement.ts` + `auth-siws.ts`,
`DESIGN-SYSTEM-WEB.md` §10 (identity ladder, read through the Solana migration note),
`ECONOMY.md` §9 (the valve). **Live on devnet, verified end-to-end 2026-08-28** —
`programs/deployments/devnet.md`. The EVM-era reference (`contracts/`, testnet 46630)
was deleted at that gate; git history keeps it.

## Architecture in one line

The hot-loop economy is off-chain and server-authoritative; the chain holds exactly
two things — the inert $ALPHA SPL mint (fixed 2,000,000, mint authority revoked at
genesis) and the Settlement program (PDA escrow deposits + server-signed ed25519
withdrawal vouchers).

## Settlement trust model (ported to parity, 28 LiteSVM tests)

- Deposits permissionless (event-indexed by `(signature, event index)` → credited to
  the R2-linked address; unlinked depositors are held in `unclaimed_deposits`, not
  lost — and the CLIENT refuses to build a deposit from a non-linked account, because
  a stranded unclaimed deposit has no later link path).
- Withdrawals: single-use nonce PDAs + expiry vouchers over the 116-byte domain
  message (`OUTFOX_SETTLEMENT_V1` ++ program id ++ chain id ++ to ++ amount ++ nonce
  ++ deadline), verified via the native ed25519 program; a stolen hot signer key
  drains at most `windowCap` per rolling 24h (leaky bucket, exact drain-at-old-rate on
  cap change). Admin (2-step transfer) can pause and rotate but **cannot move funds**.
  Escrow ATA balance = on-chain PoR.
- Voucher nonces are random u64 (matching the program's nonce space — 256-bit nonces
  were caught by the M4 rerun).
- Mainnet gates: admin → multisig; third-party audit; legal counsel.

## Identity ladder (R0→R3) — SIWS era

R0 guest (anonymous, device-bound; full core loop) → **R1 registered via SIWS**
(wallet sign-in: server-issued nonce, purpose-bound message, ed25519 verify;
subjects `siws:<base58>`, §10.1 collision semantics — never merge, never demote;
the one sanctioned wallet ceremony, per the §10 migration note) → R2 linked wallet
(separate purpose-bound link message — a sign-in signature can never link and vice
versa; deposits + withdrawal destination) → R3 verified (**provider = pending owner
decision**, only at cash-out). The dev email+code sheet remains the chainless
fallback; a server advertising Privy gets an honest client refusal (no Privy flow
exists on the Solana track — `auth-privy.ts` survives server-side only).

## The client edge (step 4, 2026-08-28)

`apps/web/src/wallet.ts` is a direct Wallet Standard relay — zero dependencies, no
chain code, no wallet library (Jupiter's kit verified and rejected: it ships
anchor/emotion/react-query and its own modal UI; SOLANA-FEASIBILITY §4). Features
used: `standard:connect`, `solana:signMessage` (base58 out, what the server
verifiers expect), `solana:signAndSendTransaction` (chain pinned per-tx: 0/1/2 →
localnet/devnet/mainnet, fail closed on unknown). The Clearinghouse relays
server-built base64 transactions as-is: deposit is ONE tx (no approve step), redeem
is `[compute, ed25519 verify, withdraw]` with fee payer = voucher recipient (client
checks the connected account matches before asking the wallet). Money inputs
format/parse at 9dp with a locale-proof machine formatter (id-ID dot-grouping broke
Max-fill round-trips 1000×; found by the step-4 adversarial review, both gating
findings fixed + regression-probed). Live harness:
`apps/web/scripts/verify-live.cjs` (14/14).

## The valve — IMPLEMENTED (`apps/server/src/settlement.ts`, `chain.ts`)

Every §9 gate runs server-side **before** a voucher is signed: **V1** R3 rung gate ·
**V2** seasoning lots (seasoned spent first; unseasoned pays the 40% surcharge) ·
**V3** 5% fee · **V4** 14-day vesting · **V5** rolling weekly cap · **V6** solvency
(never owe more than the escrow reserve, counting unconfirmed vouchers). Ledger is
BigInt base units at SPL 9dp (`ALPHA_BASE_UNITS`), seasoning clocks keyed by
blockTime. M4 contract-in-the-loop is GREEN against the real program (LiteSVM), and
the devnet e2e gate is PASSED (2026-08-28): deposit, forgery/replay rejection, pause,
and PoR verified against the live devnet deployment. Mainnet remains behind the
audit + counsel gates.

**The $ALPHA carry — IMPLEMENTED** (`applyAlphaCarry`; ECONOMY §13.A + §13.D): idle
decay 0.45%/day, 4.5%/day above the 250-$ALPHA shelter, lazy catch-up, capture →
ALPHA treasury, applied before every lot mutation and withdrawal pricing; held
unclaimed deposits pay the idle decay at claim. Staking (and its exemption) not built
yet. Deposit-fed selling is throttled by the exchange flow cap + volatility fee
(§13.B, M4-verified).

## Key hygiene (standing)

Fresh throwaway keys per environment, never reused; production custody = hot/cold
split + multisig admin; the voucher signer key is NOT the admin key.

as-of: step-5 devnet commit (2026-08-28)
