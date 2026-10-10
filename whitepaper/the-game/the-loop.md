# The loop: Calls, Raids, Gigs

The minute-to-minute game is small and repeats.

**Calls** are chance actions against the market and other players. Each Call shows its probability before you act. Win and you take value; fail and you're **Nicked**, sitting out a cooldown while the Street moves without you.

![](../.gitbook/assets/state-nicked.webp)

**Raids** are the parallel tier run against the Houses, the game's institutions. Same structure, different opponent: this is where the underdog fantasy gets its teeth.

**Gigs** are deterministic work. Slower, safer, reliable pay. Honest work on the Floor, and the backbone of the working economy.

Every fifth Gig earns a **Signal Booster**, a consumable. Run a Call with one and its clean chance rises by 5 points, capped at 95%; the Booster is used up whether the Call lands or not. Boosters trade on the Open Market at prices players set. We simulated it before building it: the economy's gates hold with it in play (see [The simulation](../evidence/the-simulation.md)).

The **Wire** is a Call against the real world. Options Alley lists up to five live markets from Panta, a market platform on Solana, each with the time it settles and Panta's quoted chance, shown with how long ago it was quoted. Take YES or NO for 20 Risk Appetite; if you are right you are paid Unsettled Scrip at the odds you took, fixed when you took them and capped, and if you are wrong you are Nicked. The chance comes from the world, so a Wire Call settles when its market does, and your Book shows it pending until then. No money moves: the Wire pays Unsettled Scrip only and never buys or sells a Panta position. Panta's name is on it ("Powered by Panta", linked to panta.market) because their data is theirs. It is built, and it was simulated before it shipped (see [The simulation](../evidence/the-simulation.md)).

## The two bars

Everything above is gated by two bars that refill over real time:

* **Focus** gates work.
* **Risk Appetite** gates Calls.

When they're empty, you stop. That throttle is deliberate. It paces the game, and it means nobody grinds infinitely. It is also the main thing real money buys: **a refill**. We'd rather say this plainly than have you discover it: the pacing gate and the revenue model are the same mechanism.

## Stats and training

Four stats shape what a Fox can pull off: **Conviction, Execution, Discipline, Edge**. You train them in **The Sim**, the Street's paper-trading room, before risking anything real.

## Being straight about the chance mechanics

Calls are chance actions with variable payouts. That structure is the oldest engagement engine in games, and it is genuinely compelling, which is exactly why it deserves stating plainly rather than burying.

We bound it deliberately:

* Value won by chance is **structurally walled off from real money**. There is no code path from a chance win to the cash-out door. See [The firewall](../the-economy/the-firewall.md).
* Success probabilities are **stated to the player before they act**, not hidden. A Signal Booster changes the stated chance before the Call runs, never after it or out of sight.
* Resolution is flat and immediate. No suspense build, no near-miss theatre, no escalating celebration; the reveal is capped at 320ms by design rule. The reveal must never *be* the reward. A Wire Call is the one exception: it settles when its real market does, and the Book shows it pending until then.
* Casino vocabulary and imagery stay out of the product: no bets, jackpots or loot boxes, by the written copy rules every player-facing string is held to.

We are not going to tell you what legal category any of this falls into; that is for regulators. What we can tell you is what we built and why.
