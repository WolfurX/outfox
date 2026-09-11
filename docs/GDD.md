# Outfox game design document

> **Status:** rewritten 2026-09-12 in the unified vocabulary, replacing the Phase-0
> draft (git history keeps it). Mechanics, systems, and economy are unchanged; the
> pivot notices are folded in and the Telegram-era platform passages are gone. Where
> this doc and `ECONOMY.md` disagree on an economic rule, **`ECONOMY.md` wins**. UI is
> `DESIGN-SYSTEM-WEB.md`; vocabulary is `THEME-OUTFOX.md`; scope and acceptance are
> `PRD.md`; engineering is `ARCHITECTURE.md`. Status labels as in `PRD.md`: **Built**,
> **Designed** (in the validated model, not coded), **Specified** (written, not modeled),
> **Owner** (waits on an owner decision).

## 1. Vision and pillars

**One line:** a persistent, player-run trading floor where every Scrip you earn was
lost by another Fox or spent by one, never minted by a faucet. Outfox the Houses.

Outfox is a mobile-first, text and stat based MMO in the lineage of Torn, the crime MMO
whose identity is its player-driven economy. Torn's skeleton stays; the fiction is a 24/7
trading floor run by outlaw traders against rigged institutions. It ships as a web PWA on
Solana. The two driving requirements, in priority order: an economy that survives an
earning-first player base, then UI quality.

Pillars:

1. **The economy is the game.** Markets, scarcity, trade, and player-to-player value
   transfer are the content. Calls and Raids exist to feed the economy, not the reverse.
2. **Transfer-funded, never emission-funded.** Earning comes from other players and from
   real-money convenience spend. There is no "log in, mint tokens" faucet.
3. **Deep systems, light to render.** Menus and numbers, a tiny bundle, instant load,
   with an $80 Android in a plain browser as the floor and years of progression
   underneath.
4. **Server-authoritative truth.** The client renders; the server owns every outcome,
   price, faucet, and sink. A Fox can never compute their own take.
5. **Convenience, never power.** Money buys time, slots, and cosmetics, and never stats
   or an outcome. This is both an economy invariant and the spine of the legal posture.

Why play: a fast "one more Call" loop with real stakes and stated probabilities. Why
stay: a reputation that persists, a Skulk that needs you, owned assets that appreciate,
a market you can outsmart, and a second ladder (standing) beside wealth. Mastery is
economic, not reflexive.

## 2. The world

### 2.1 The Street

The Street is owned by the Houses: bloated, slow, connected institutions that have rigged
the flow. The player is an outlaw trader, too small to matter and too fast to catch. It is
a district list, not a map (the word is banned as a description). Districts open when
their system ships; closed ones show one line of fiction, no gate and no date. No district
carries a rung gate.

| District | What happens there | System | Status |
|---|---|---|---|
| The Floor | honest work, reliable pay | Gigs (live on The Tape) | Built, open; enters The Tape |
| Options Alley | Calls against the market and other Foxes | Calls (market side live on The Tape; versus-Fox designed) | Built, open; enters The Tape |
| The Pit | Raids on the Houses | Raids | Designed, closed |
| The Dark Pool | the quiet end of the market | The Index, Desks | Designed, closed |
| The Vault | the Houses' treasure and the target | The Clearinghouse | Built, open; enters the Clearinghouse |
| After Hours | the endgame district; the Street never closes | Seats, late-game systems | Designed, closed |
| The Hollow | the crews' hideout quarter | Skulks, the Commons | Designed, closed |

The assignment is the published whitepaper's (`whitepaper/the-game/the-street.md`).
The Street tab shipped 2026-09-11 had assigned four districts differently; on the
owner's ruling of 2026-09-12 the tab was corrected to this table (`apps/web/src/
Street.tsx`, `verify-live` world D), so three districts are open today.

### 2.2 Who is on the Street

Foxes are the players and Skulks are their crews (the real collective noun). The Houses
are fictional mega-funds and the Raid targets, never named after or styled like a real
firm. The Sheriff is the Street's enforcer and antagonist referee: a failed Raid or Call
gets a Fox Nicked and sitting out a cooldown.

### 2.3 Tone and vocabulary

Every line reads as sporting defiance ("the Houses never saw it coming"), never
criminality ("we broke in"). Banned names, banned framings, and the gambling vocabulary
blacklist are in `THEME-OUTFOX.md` §3; the tone test there applies to every string in
the product, including error messages and empty states.

### 2.4 Vocabulary bridge

`ECONOMY.md` (frozen, priority #1), `ECONOMY-SIM-SPEC.md`, and `sim/` still use the
terms they were validated under. The rows below are the terms that actually appear
there (counted 2026-09-12), so readers can move between the two without ambiguity:

| Canonical (this doc, product, code) | In `ECONOMY.md`, the sim spec, `sim/` |
|---|---|
| Scrip | Credits (¢) |
| Settled Scrip / Unsettled Scrip | Clean Credits / Bound Credits |
| Calls, Raids | Exploits |
| Focus / Risk Appetite | Compute / Nerve |
| Desks | Operations |
| Seats | Safehouses |
| Margin Called | Quarantine |
| Skulks | syndicates (lowercase, in passing) |
| The Commons | The Commons (same term) |

Owner ruling 2026-09-12: the frozen economy canon and `sim/` keep these terms, and repo
`CLAUDE.md` and `THEME-OUTFOX.md` now state the exception explicitly; every other doc,
all code, and all player-facing copy use the left column only. This table is the
bridge. The product names retired at the Solana move survive only inside immutable sim
records (`vocab-guard.test.ts` enforces it).

## 3. The Fox

### 3.1 The two bars

| Bar | Gates | Regen (slice) | Refill |
|---|---|---|---|
| Focus | work: Gigs, training, Desks | 0.2 per second to 100 (full in about 8 minutes, demo-paced) | a sink, payable from Unsettled Scrip |
| Risk Appetite | Calls and Raids | 0.25 per second to 100 | same |

The bars pace the game, stop infinite grinding, and are the main thing real money buys.
The whitepaper says this plainly and so does the product: the pacing gate and the revenue
model are the same mechanism. Production regen and refill prices come from the sim, not
from the slice values.

### 3.2 Stats (Designed)

Four stats shape what a Fox can manage: **Conviction, Execution, Discipline, Edge**.
They are trained in The Sim by spending Focus, gate the higher Call and Raid tiers and
versus-Fox outcomes, and are computed server-side only. Stat names are frozen
(`THEME-OUTFOX.md` §2); the count is four.

### 3.3 The identity ladder (player-facing)

Rung 0 is a guest who can play the whole loop forever. Rung 1 is registered (wallet
sign-in on Solana; the demanding surface asks, the action resumes). Rung 2 has a linked
deposit wallet. Rung 3 is verified, demanded by cash-out and by nothing else. Rungs
never downgrade. Wallet jargon is banned at rungs 0 and 1: the account is "your Book".
Full rules: `DESIGN-SYSTEM-WEB.md` §10.1, Solana translation in `ARCHITECTURE.md` §9.

### 3.4 Downtime

Nicked (Built) means the Sheriff caught you: a failed Call ends in a longer cooldown on
that Call and a flash on the row, with no asset loss. Margin Called (Designed) is busted
play, the downtime after losing a versus-Fox contest; the loss is bounded and never
total.

Both are loss aversion inside guardrails: a lapsed or beaten Fox loses relative position,
never absolute assets.

### 3.5 Standing (Designed)

The second long-term ladder beside net worth: reputation tiers, titles, regalia, crew
prestige, and leaderboard weight, earned by giving to the Commons (§5.15). Standing is
non-transferable. Rich is one leaderboard; beloved is another.

## 4. Core loop

**Minute to minute**: spend Risk Appetite on a Call, or Focus on a Gig; take the
result; bank, spend, or list it; the bars refill; again. Calls state their probability
before commit, resolve flat and immediate (reveal capped at 320 ms, no near-miss
theatre), and pay **Unsettled** Scrip on success or Nicked on failure. Gigs pay
**Settled** Scrip and a tool every fifth completion.

**Session (5 to 15 minutes)**: burn the banked bars, check Open Market listings and
fills, read the Overnight Tape, react to what happened to you.

**Daily**: regen windows, the carry assessment on idle Scrip, Skulk ticks and turf,
Market arbitrage, a Commons gift if standing is the goal.

**Weeks to months**: stats, standing, a Desk that employs other Foxes, a Seat, Skulk
rank, the Big Score against a named House, the Index for late capital. Progression depth
is the retention engine: there is always a next tier and economic mastery has no ceiling.

The chance mechanics are bounded on purpose: value won by chance is structurally walled
from real money (§5.7), probabilities are shown, resolution is flat, and gambling
vocabulary and imagery are banned.

## 5. Systems

Every system carries an economy classification from `ECONOMY-SIM-SPEC.md` (faucets F1–F5,
sinks S1–S8, or Transfer) and the Scrip class it produces or consumes. A system that adds
or changes a faucet, sink, or transfer needs its sim scenario to pass at full seeds
before it ships (`ARCHITECTURE.md` §4).

| System | Player action | Economy | Scrip class | Rung | Status |
|---|---|---|---|---|---|
| Calls | chance action against the market | F1 faucet; versus-Fox tier is F5 transfer | Unsettled out | R0 | Built (market side) |
| Gigs | deterministic work | F2 faucet (small, capped) | Settled out | R0 | Built |
| Raids | chance action against a House, with Heat | F1 faucet | Unsettled out | R0 | Designed |
| The Sim | train stats; FTUE Call | S2 throttle (Focus) | none | R0 | Specified; FTUE Built |
| The Open Market | list and buy items at player prices | Transfer with S3 fee | Settled only | R1 to write | Built |
| Refills | buy back a bar | S2 throttle | Unsettled first, then Settled | R0 | Built |
| Carry | idle holding cost on Scrip and $ALPHA | S1 capture | both | all | Built |
| The Exchange | swap Scrip and $ALPHA on the published pool | fee capture; §13.B defenses | Settled only | R1 | Built |
| The Clearinghouse | deposit; cash out through the valve | S8 capture and throttle | $ALPHA | R2 deposit, R3 cash-out | Built (R3 provider pending) |
| Staking and locking | lock $ALPHA for the base-rate exemption | §13.C | $ALPHA | R1 | Designed |
| Desks | run a business, employ Foxes | F2 output; S4 upkeep; Transfer wages | Settled | R1 | Designed |
| Seats | own a Seat on the Exchange | S5 Veblen capture; bounded shelter | Settled and $ALPHA | R1 | Designed |
| The Index | trade fictional tickers | S3 fees; Scrip cycler | Settled only | R1 | Designed |
| Skulks | crew, AUM, turf, the Big Score | Transfers; sinks; Share-Out spending | both; AUM holds $ALPHA | R0 join, R1 roles | Designed |
| The Commons and the Share-Out | give for standing; treasury spends by rule | S5 capture; fiscal spending | either class in | R1 | Designed |
| Cosmetics and regalia | jacket colors, titles | S5; Transfer on the Market | Settled | R1 | Specified |

### 5.1 Calls (Built)

A Call shows its success probability, costs Risk Appetite, and resolves server-side.
Success pays a range of Unsettled Scrip; failure is Nicked with a longer cooldown. Slice
catalog (production values come from the sim):

| Call | Risk Appetite | Probability | Payout (¢, Unsettled) | Cooldown ok / Nicked |
|---|---|---|---|---|
| Fade the Open | 10 | 0.75 | 80–140 | 15 s / 45 s |
| Front the Rumor | 20 | 0.55 | 180–320 | 25 s / 60 s |
| Squeeze the Basket | 35 | 0.40 | 400–700 | 40 s / 90 s |

Versus-Fox Calls (Designed) take the other side against a named Fox: the loser pays the
winner from Settled Scrip minus a fee, a transfer (F5), never a mint; the loser is Margin
Called. Stats and tools shift the probability; chance stays bounded.

### 5.2 Gigs (Built)

Honest work on the Floor. "Run the Tape" costs 15 Focus, pays 90 ¢ Settled, 20 s
cooldown, and awards a tool every fifth completion (deterministic pity). Gigs are the
bootstrap liquidity faucet and stay small by design: most Settled Scrip should be
transfer-driven.

### 5.3 Raids (Designed)

The parallel tier run against the Houses. Same structure as a Call, different opponent,
and the underdog fantasy gets its teeth. Repeated Raids raise **Heat**, the Sheriff's
attention: the existing risk and cooldown pacing dressed as fiction. Lie low in the
Hollow or push your luck. Raids pay Unsettled Scrip and items; the Houses are the NPC
faucet role that F1 already models.

### 5.4 The Sim (Specified; FTUE Built)

The Street's paper-trading room. Training spends Focus to raise a stat; The Sim also
hosts the guided first Call a fresh Fox boots into (`DESIGN-SYSTEM-WEB.md` §10.4). No
value is created in The Sim.

### 5.5 The Open Market (Built)

Player-to-player listings at player prices, never fixed. Items today: terminals and
signal boosters (tools from Gigs); designed: feeds, models, the jacket cosmetic line. A
3.5% fee (`MARKET_FEE_BPS`, safe interval 2% to 10%) is captured to the treasury.
Settled Scrip only; writing needs rung 1. This is the thick trade layer that raises real
in-game output (Q).

### 5.6 Refills (Built)

Buying a bar back is the first convenience purchase and a sink; it is payable from
Unsettled Scrip because a sink is an allowed destination. The USD-priced refill (F3)
lands with payments (`PRD.md` FR-PAY-1).

### 5.7 Scrip and the carry (Built)

Scrip has two settlement states. **Settled** Scrip is transferable, listable, and
exchangeable. **Unsettled** Scrip comes from chance (Calls, later Raids and versus-Fox
wins) and can be spent only on the Street's own services: refills, fees, upkeep, house
goods, the Commons. It cannot be sent to another Fox, listed, exchanged, or cashed out,
and the one explainer string is fixed (`UNSETTLED_EXPLAINER`). This is the provenance
firewall: no chance-origin value has a code path to real money.

Idle Scrip pays a carry (demurrage) of 0.45% per day above a 500 ¢ floor, assessed
lazily on the next touch and captured to the treasury, so hoarding Scrip is never a
better plan than using it.

### 5.8 The Exchange (Built)

The only bridge between Scrip and $ALPHA: a protocol-owned constant-product pool with a
1.5% fee per leg, a volatility multiplier that grows when the fast and slow price
averages diverge (up to 4x; calm trade stays at 1x; rolled once per day so a trade never
moves its own fee), and a 2% per-side daily flow cap that makes over-cap entry
impossible rather than expensive. Reserves, rate, fee, and remaining capacity are
published live. $ALPHA bought here is a fresh unseasoned lot.

### 5.9 The Clearinghouse (Built)

Entered from the Ledger. Deposits are one wallet transaction. Cash-out runs the valve in
order: rung 3, seasoning (seasoned lots spend first; unseasoned pays a 40% surcharge; any
new $ALPHA is unseasoned for 60 days), a 5% fee, 14 days of vesting, a 58 $ALPHA rolling
weekly cap, and a solvency check against the escrow. The quote itemizes every line and
shows dates, not durations. Idle $ALPHA pays 0.45% per day; the position above a 250
$ALPHA shelter pays 4.5% per day on the excess, whatever the bucket. All of it is on
the Rules sheet, read from the same constants the server enforces.

### 5.10 Staking and locking (Designed)

Locked $ALPHA is exempt from the idle carry (never from the progressive carry) and
unbonds over time, so locking strictly beats idling and a lock cannot be wash-traded
into an early exit (`ECONOMY.md` §13.C). Until it ships, the whole position is liquid.

### 5.11 Desks (Designed)

Player-run businesses: prop, OTC, research. A Desk converts inputs to outputs, employs
other Foxes for wages (a transfer), pays upkeep (S4), and is where specialization pays.
A Fox who is better at one thing than everyone else earns from the difference, which is
what makes the economy thick instead of a row of parallel grinders.

### 5.12 Seats (Designed)

A Seat on the Exchange, the Street's most conspicuous possession and a deliberate piece
of machinery: a status good whose demand rises with its price, so it drains large
fortunes without touching gameplay power. Seats may carry a bounded demurrage shelter
and slot perks, never stats. Primary sales by auction (sealed-bid to resist sniping).

### 5.13 The Index (Designed)

The Street's internal market with visibly fictional tickers: an advanced-player money
game, a Scrip cycler and fee sink, and strictly separated from $ALPHA by design rule to
bound securities exposure. Entry from the Market tab and Tape tickers.

### 5.14 Skulks (Designed)

Crews with ranks, a shared treasury (AUM, holding Scrip and $ALPHA), turf on the Street
contested by hostile takeover, and seasonal campaigns against a named House: the Big
Score, ending in a Street-wide Share-Out. Guests may join as members; treasury roles need
rung 1. The fifth tab (Skulk) and the structured comms surface arrive with it
(`DESIGN-SYSTEM-WEB.md` §16). Skulks are where most player-to-player transfer happens,
and transfer is what funds earning.

### 5.15 The Commons and the Share-Out (Designed)

Foxes and Skulks give Scrip (either class) or $ALPHA to the Commons for standing (§3.5).
Gifts are captured to the treasury and periodically Shared Out as events open to
everyone: newcomer boosts, tournament pools. Never as direct cashable transfers, and
standing never transfers. Economically it is a voluntary Veblen sink with prosocial
framing and the design's Gini lever (`THEME-OUTFOX.md` §4, `ECONOMY.md` §2.3); the sim
follow-up adds the donation propensity to the sink set with a measurable Gini
improvement as the acceptance bar. The Share-Out is the treasury's spending arm made
diegetic, and the whitepaper discloses it as both.

### 5.16 Cosmetics and regalia (Specified)

The fox in a trader's jacket is the mascot and the cosmetic engine: jacket colors are
the Open Market's cosmetic line (the layered SVG fox exposes the jacket fill), titles and
regalia come from standing. Status only, never power.

## 6. Progression and live-ops

- Stats via The Sim; standing via the Commons; wealth via the markets; rank inside a
  Skulk. Districts open by content, not by gate.
- Seasons: the Big Score cycle; leaderboard resets rank, never assets; rewards are
  cosmetic and titles.
- Content cadence: new Calls and Raids, item kinds (eight cards are already
  staged in `docs/ART-PROMPTS.md` Tier 4), Desk types, events. Live-ops events double
  as fiscal tools: prize pools are stimulus, entry fees are sinks, all by published rule.

## 7. Social

Skulks are the backbone. Trading runs through the Open Market and, later, direct
transfers (fee'd, Settled only). Leaderboards reward economic mastery and standing.
Discord is the social layer in Phase 1; in-app comms are structured (pinned board,
preset pings). Referral links are guest-play-first with server-side attribution and pay
in convenience only, never in cashable value or standing.

## 8. Monetization

Two rails. Convenience checkout priced in USD and settled in USDC from the player's
wallet (F3; day-0 funding through wallet built-in ramps; rail choice couples to the
geofence and counsel decisions). Primary $ALPHA sales (F4) with wealth-indexed
allocation. Money buys Focus and Risk Appetite refills, extra Desk and Market slots,
cosmetics, faster regen, name reservations. Money never buys stats, guaranteed
outcomes, or power items. Convenience spend is the real-money faucet that other Foxes
end up earning: the transfer-funded model. Operator revenue comes from the fiat side and
from boundary fees only (`ECONOMY.md` §3); in-loop captured value is never profit.

## 9. UX summary

Full spec in `DESIGN-SYSTEM-WEB.md`. The shell today: four tabs (The Tape, The Street,
Market, Ledger) as a bottom bar at compact widths and a rail at wide widths; the
Clearinghouse from the Ledger; FTUE as a guided first Call; a feedback layer with
synthesized cues, haptics, and a header mute; terminal-noir dark canonical plus a light
theme; art in hairline-framed slots and SVG icons in-app. The Skulk tab arrives with
Skulks. Budgets and the device matrix are in `PRD.md` §4 and §7.

## 10. KPIs and economy health

`PRD.md` §4 holds the table. The economy row is the one that decides: G1–G12 live,
chance leakage at zero, sybil share under 5%, proof of reserves after every change. If
those fail the game fails regardless of DAU.

## 11. Risks and mitigations

1. Economy collapse (hyperinflation, a Gresham split, velocity death): the whole of
   `ECONOMY.md`, the sim gate before any economy code, live G1–G12 with alerting,
   parameter moves only inside swept intervals.
2. Bots and sybils: the firewall, the valve (seasoning, vesting, weekly cap), PoP at
   cash-out as the binding lever (AUDIT-2 measured every throughput cap at zero G11
   effect), funding-graph clustering, referral rewards in convenience only.
3. Regulatory exposure (chance plus cashable value plus loss aversion can touch gambling,
   securities, and money-transmission law): chance value cannot reach cash-out by
   construction; bounded behavioral mechanics; the Index separated from $ALPHA; no
   appreciation marketing; PoP and fees at the boundary; counsel as a hard gate before
   any real money.
4. Distribution: no host-app funnel on the open web. Founder receipts, the dApp
   Store TWA, Colosseum, the kill criteria in `PRD.md` §4.
5. Platform: chain deplatforming risk is near zero; Discord is a dependency of the
   old kind with an exit review scheduled; the server-authoritative thin client keeps
   every surface swappable.

## 12. Open design questions

- The Raid tier's Heat curve and whether Heat is per Fox, per Skulk, or both.
- The item roster for the CPI basket (needs at least a handful of stable kinds).
- Which of Desks, Seats, and the Index ships first after Skulks; each needs a modeled
  scenario.
- Whether The Index ships before launch at all (it is an advanced-player system).
