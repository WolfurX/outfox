# Roadmap

Gates, not dates. Every phase below has a verifiable exit condition, and several are allowed to say no. Publishing a quarter-by-quarter calendar for work that is gated on validation results would be theatre.

## 1. The Solana chain edge

$ALPHA mint and the settlement program, written to the semantics already verified on the EVM reference. Exit: the contract-in-the-loop harness passes against the Solana programs on a local validator, then end-to-end verification on devnet: deposit, signed withdrawal, forgery and replay rejection, pause.

## 2. Wallet and identity

Wallet sign-in on Solana wired into the existing guest → registered ladder. Selection of the proof-of-personhood provider for cash-out, the decision the simulation identifies as the binding sybil defense.

## 3. Economy systems, one at a time

Staking/locking, the progressive carry, the Index, Skulks, Desks, the Commons. Each ships behind the standing rule: **no economy code ships until the model passes at full seeds**, and each addition re-runs the affected scenarios.

## 4. Payments and retention

The real-money on-ramp for convenience purchases, plus the notification and retention stack. On-ramp provider coverage for Solana has been verified: native USDC is carried broadly, so purchases price in USDC and day-one funding can lean on the ramps built into major Solana wallets, with a dedicated on-ramp widget following once the game's own revenue justifies it. Integration work still comes after the beta gates.

## 5. Legal review and controlled beta

Counsel review of the chance/cashable-value separation, money-transmission exposure, and jurisdictional geofencing. **This is a hard gate: nothing real-money opens before it.** Then a closed beta on devnet economics, with the live dashboards from the specification running against real players for the first time.

## 6. Launch

Mainnet deploy under the stated custody model (multisig admin, bounded signer risk), published economic parameters and policy rules, and the cash-out valve opening last.

***

Two standing commitments that outrank any date: the simulation gate stays in force for every economy change forever, and the published-parameters commitment in [Running money by rule](../the-economy/policy-by-rule.md) lands at launch, not after it.
