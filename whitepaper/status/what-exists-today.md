# What exists today

This matters, and most whitepapers are cagey about it.

| Built and running | Designed and simulated, **not built yet** |
| --- | --- |
| Calls, Gigs, cooldowns, the Focus and Risk Appetite bars | Raids as a distinct tier, Skulks (crews), Desks (player businesses) |
| Scrip, the Settled/Unsettled firewall, Carry | The Index (internal market), the Commons, the Share-Out |
| Refill sinks; the Open Market (item trading) | Staking/locking, progressive carry, wealth-indexed issuance |
| Guest → registered identity ladder with Solana wallet sign-in; the PWA client | Real proof of personhood; the payment on-ramp |
| The Scrip⇄$ALPHA exchange and the Clearinghouse UI | Retention and notification stack |
| The full cash-out valve: fees, seasoning, vesting, caps | **Mainnet. Real money. Any of this being live.** |
| Chain edge proven end-to-end on an EVM testnet (frozen reference); the Solana settlement program, passing the same economic harness locally | Devnet and mainnet verification of the Solana edge |

The economic design in these pages is **validated in simulation**; most of it is not yet shipped code. The server test suite, the simulation scorecards, and the contract-in-the-loop record all live in the repository, so "verified" always points at something you can re-run.

## The migration, honestly

Outfox targets Solana. The chain edge was first built and verified end-to-end against an EVM testnet, including deposits, signed-voucher withdrawals, forgery and replay rejection, pause, and the economic harness. That implementation is now a frozen reference. The Solana programs are written to the same verified semantics and pass the same contract-in-the-loop harness in a local environment, and the client signs in and transacts through Solana wallets. What remains before anything opens to players is the live-cluster rerun: devnet deposit, withdrawal, forgery and replay rejection, pause. Until that is green, the Solana edge should be treated as unproven on a live network, because it is.
