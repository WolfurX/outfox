# Outfox

![](.gitbook/assets/hero-street.webp)

*A persistent, player-run economy with no token printer. What you earn is bounded by what the economy actually produces, not by a promise written against future buyers.*

|  |  |
| --- | --- |
| Genre | Text-and-numbers economy MMO. Screens of decisions, no 3D world. |
| Client | Web PWA, mobile-first, built for cheap phones |
| Chain | Solana |
| Token | $ALPHA. Fixed supply of 2,000,000, never minted to players. |
| Status | Pre-launch, in development. Nothing is live, nothing is for sale. |

## What you do

You are a **Fox**: an outlaw trader working *the Street* against *the Houses*, the institutions that own the game and always have. Other players sit on the other side of most of your decisions. You take **Calls** (chance actions with the probability stated up front), work **Gigs** (honest pay, no chance), trade on the Open Market, run Desks with your crew, and try to end up on the right side of the ledger.

<img src=".gitbook/assets/mascot.webp" alt="" width="360">

## Why this document is unusual

Roughly nine out of ten GameFi projects are dead within a few years, and the deaths rhyme: the game mints the token that players earn, so player earnings are a claim written against future buyers. When the buyers stop, the claim breaks. [Why game economies die](the-game/why-economies-die.md) walks through it.

Outfox is built on the opposite structure, the one that has kept Torn alive since 2004: players earn from other players and from real-money convenience spending. No token printer. The whole design was stress-tested in an agent-based simulation and attacked by adversarial scenarios before economy code was written, and the [results are published](evidence/the-simulation.md), including the parts that fail.

Throughout these pages, anything marked **\[designed]** is validated in simulation but not yet built. Anything called verified points at an artifact you could re-run. We think the difference matters, and most whitepapers blur it.

## Where to start

* Playing it: [The Street](the-game/the-street.md), then [The loop](the-game/the-loop.md).
* The economics: [Two currencies](the-economy/two-currencies.md), then [The firewall](the-economy/the-firewall.md).
* Diligence: [The simulation](evidence/the-simulation.md), then [What can still go wrong](evidence/what-can-go-wrong.md).
