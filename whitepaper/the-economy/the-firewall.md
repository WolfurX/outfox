# The firewall

Scrip comes in two kinds, and they are not interchangeable:

* **Settled Scrip** comes from deterministic work: Gigs, market sales. Transferable, tradable.
* **Unsettled Scrip** comes from chance: Calls. It can **never** be sent to another player, sold on the market, or converted into anything cashable. It is spendable only on the Street's own services: refills, fees, the Commons.

So: **value won by chance cannot become real money.** Not by policy, by construction. There is no code path from a chance win to the cash-out door. The rule is enforced in the engine, and the simulation gates on it: criterion G10, zero leakage, across every scenario including the adversarial ones.

The settlement fiction carries the mechanic for free. On a real trading floor, a trade isn't yours until it settles; on the Street, chance winnings never settle into the outside world.

## Why this rule holds everything up

This one wall is what separates a game that contains chance from a mechanism for converting luck into cash. It is why the design can afford to have chance in it at all, and it is the first thing we would point an auditor, a regulator, or a skeptical player at.

One scope limit, stated because it matters: the firewall's hardest end-to-end test runs through the Scrip⇄$ALPHA exchange, and that path was proven in simulation before it was proven against real code. The exchange now exists in the build, and the contract-in-the-loop harness re-checks the real path as part of the chain-edge work on each migration. [The simulation](../evidence/the-simulation.md) page keeps the current status honest.
