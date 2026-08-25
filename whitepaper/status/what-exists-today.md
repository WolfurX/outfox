# What exists today

This matters, and most whitepapers are cagey about it.

| Built and running | Designed and simulated, **not built yet** |
| --- | --- |
| Calls, Gigs, cooldowns, the Focus and Risk Appetite bars | Raids as a distinct tier, Skulks (crews), Desks (player businesses) |
| Scrip, the Settled/Unsettled firewall, Carry | The Index (internal market), the Commons, the Share-Out |
| Refill sinks; the Open Market (item trading) | Staking/locking, progressive carry, wealth-indexed issuance |
| Guest → registered identity ladder; the PWA client | Real proof of personhood; the payment on-ramp |
| The Scrip⇄$ALPHA exchange and the Clearinghouse UI | Retention and notification stack |
| The full cash-out valve: fees, seasoning, vesting, caps | **Mainnet. Real money. Any of this being live.** |
| Chain edge proven end-to-end on an EVM testnet (frozen reference) | The Solana programs (port in progress; gated by the harness rerun) |

The economic design in these pages is **validated in simulation**; most of it is not yet shipped code. The server test suite, the simulation scorecards, and the contract-in-the-loop record all live in the repository, so "verified" always points at something you can re-run.

## The migration, honestly

Outfox targets Solana. The chain edge was first built and verified end-to-end against an EVM testnet, including deposits, signed-voucher withdrawals, forgery and replay rejection, pause, and the economic harness. That implementation is now a frozen reference; the Solana programs are being written to the same verified semantics, and the harness reruns against them before anything opens to players. Until that rerun is green, the Solana edge should be treated as unproven, because it is.
