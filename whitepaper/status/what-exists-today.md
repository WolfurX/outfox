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
| The Solana chain edge: $ALPHA mint (fixed supply, mint authority revoked) and the settlement program, **live on devnet and verified end-to-end** — deposit, signed withdrawal, forgery and replay rejection, pause | Mainnet deployment (behind the audit and counsel gates) |

The economic design in these pages is **validated in simulation**; most of it is not yet shipped code. The server test suite, the simulation scorecards, and the contract-in-the-loop record all live in the repository, so "verified" always points at something you can re-run.

## The migration, honestly

Outfox targets Solana. The chain edge was first built and verified end-to-end against an EVM testnet, then ported: the Solana programs are written to the same verified semantics, pass the same contract-in-the-loop economic harness, and are now deployed on devnet with the full flow verified there end-to-end. On devnet, a deposit lands in escrow and is credited by the indexer, a signed withdrawal voucher redeems for exactly its face value, a forged signature and a replayed voucher are both rejected on-chain, and the admin pause halts the edge. The token's mint authority was revoked at genesis, so the fixed supply is a chain-enforced fact, not a promise. What this does not mean: mainnet. That stays behind a third-party smart-contract and economic audit and the legal review, and nothing real-money opens before those gates.
