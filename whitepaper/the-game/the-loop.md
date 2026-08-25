# The loop: Calls, Raids, Gigs

The minute-to-minute game is small and repeats.

**Calls** are chance actions against the market and other players. Each Call shows its probability before you act. Win and you take value; fail and you're **Nicked**, sitting out a cooldown while the Street moves without you.

![](../.gitbook/assets/state-nicked.webp)

**Raids** are the parallel tier run against the Houses, the game's institutions. Same structure, different opponent: this is where the underdog fantasy gets its teeth.

**Gigs** are deterministic work. Slower, safer, reliable pay. Honest work on the Floor, and the backbone of the working economy.

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
* Success probabilities are **stated to the player before they act**, not hidden.
* Resolution is flat and immediate. No suspense build, no near-miss theatre, no escalating celebration; the reveal is capped at 320ms by design rule. The reveal must never *be* the reward.
* Gambling vocabulary and imagery are banned from the product, and the ban is enforced by an automated check in the build.

We are not going to tell you what legal category any of this falls into; that is for counsel and regulators, and the project treats legal review as a hard pre-launch gate. What we can tell you is what we built and why.
