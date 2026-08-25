# Two currencies

|  | **Scrip** | **$ALPHA** |
| --- | --- | --- |
| What it is | The game's working currency | A fixed-supply on-chain token |
| Cashable? | **Never** | Yes, through one controlled valve |
| What it's for | Earn, spend, trade, build | Premium convenience |
| Holding cost | Carry (daily decay) | Idle decay; large positions pay a progressive carry |
| Supply | Created by play, destroyed by sinks | Capped at 2,000,000. No minting. |

**Scrip** is the working money of the Street. You earn it from Gigs and Calls, spend it, trade it. It is not cashable; Scrip never leaves the Street. It carries a holding cost we call **Carry**: money you sit on decays daily. That is deliberate. It makes hoarding expensive, keeps money circulating, and stops the economy from seizing up.

An honest number on Carry: the calibrated rate is aggressive, roughly 0.45% per day on unsheltered balances above an exemption floor, which is far beyond historical demurrage precedent. It is doing real work in the model; whether players tolerate it is a live design question, and the project's own audit trail names it as an open item rather than pretending it's settled.

**$ALPHA** is the premium token: fixed supply, no minting path, and the only thing in the game intended to be cashable. It buys **convenience, never power**: time, slots, cosmetics, standing. It cannot buy stats, wins, or an in-fiction advantage. If it could, both the economy and the game would break. Details on [the token page](../alpha/the-token.md).

## Why the token also decays when idle

If Scrip inflates while the token just sits there appreciating, every rational player spends the Scrip and hoards the token. Token velocity dies and the working economy floods with depreciating cash. Economists call it Gresham's law; games discover it the hard way.

So the exchange rate between Scrip and $ALPHA **floats and is never pegged** (a peg creates the arbitrage), some goods are priced in $ALPHA to force token use, and idle $ALPHA carries a holding cost of its own, because a decay-free token is simply the superior hoard. Only **locked** $ALPHA is sheltered, and locked $ALPHA cannot be sold. **\[locking is designed, not yet built]**

## Sinks that capture rather than burn

A sink that merely deletes money produces nothing. Good sinks capture value: Seats and status goods whose demand rises with price, auction-based sales of rares that extract true willingness-to-pay, and [the Commons](../the-game/skulks-and-commons.md). Captured value funds the treasury and the Share-Out instead of vanishing.
