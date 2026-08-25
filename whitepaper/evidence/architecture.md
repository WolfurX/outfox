# Architecture

## Server-authoritative

The client renders; the server owns every value decision, outcome, and price. A player can never compute their own reward. All economic logic sits behind a single mutation gate that writes a provenance-tagged ledger entry for every balance change and rejects overdrafts atomically. Every economic event is append-only, which is what makes the live economy measurable with the same estimators the simulation uses.

## The chain is an edge, not a runtime

The hot loop is off-chain. The chain holds exactly two things:

* **The token**: the $ALPHA SPL mint, fixed supply, mint authority revoked. Inert by construction.
* **The settlement program**: the value boundary. Deposits are permissionless. Withdrawals require a voucher signed by the game server, and the server signs only after every gate in [Getting value out](../the-economy/getting-value-out.md) has passed. The program enforces what only a chain can: single-use vouchers, expiry, signature validity, a pause, and a global rolling withdrawal cap.

The escrow's token balance *is* the proof of reserves: the game can never owe more $ALPHA than the chain holds, and the invariant is asserted after every state change.

## Trust model, stated plainly

This is a **custodial** edge; it has to be, given server-authoritative state. So the blast radius is bounded explicitly. A compromised signing key can drain at most the rolling cap before the operator pauses. The program's admin authority can pause, rotate the signer, and adjust the cap, but cannot move funds. Moving that authority to a multisig is a stated prerequisite for anything real.

## Where the implementation stands

The full edge (token, settlement, deposits, signed withdrawals, replay and forgery rejection, pause) was built and verified end-to-end on an EVM testnet first, including the contract-in-the-loop economic harness. That implementation is now the frozen behavioral reference while the edge is rewritten as Solana programs; the reference gets deleted once the harness passes against the Solana implementation. The client carries no chain code either way; every transaction is built server-side, which is why the chain swap does not touch the game.

## Built for cheap phones

The client is a web PWA with a hard performance budget on low-end Android. Text and numbers as an aesthetic is also an engineering choice: the game stays light enough to play on the worst connection in the room.
