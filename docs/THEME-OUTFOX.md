# THEME — "Outfox" (trading-floor world + outlaw-trader lore)

> **Naming:** canonical name is **Outfox** (title case — it's a character brand, not an
> acronym); the logotype MAY be set as OUTFOX as a design treatment. Lineage: the feasibility
> study's theme direction was working-titled "TAPE"; the name evolved to Outfox for
> marketability (verb + mascot) — the fiction below is unchanged.

> **Status: ADOPTED (2026-07-02); vocabulary UNIFIED (2026-08-25).** Adoption was
> recorded in `PLAN.md` at the Robinhood pivot; the Solana migration then retired the
> two-layer rule: **Outfox / $ALPHA is now the single vocabulary everywhere** — canon
> docs, sim code, app code, player-facing copy. The retired dev names (MEMPOOL, $VIG)
> survive only inside immutable sim result records and archived docs; the §2 table is
> the historical mapping for reading those records. The §7 availability checks are
> **still pending**: no literal name strings go on-chain or into contracts until they
> clear. Mechanics, economy, and parameters are **frozen** — this document changes
> fiction and vocabulary only, with ONE exception: the Commons donation sink (§4),
> which is a real economic addition specced in `ECONOMY.md` §2.3.
>
> **Lore route decided: ARCHETYPAL.** Full Robin Hood story beats — the outlaw hero, the
> greedy institutions, the enforcer antagonist, the band, the share-out — with **zero
> trademarked or mythos names**. Players feel the legend; the game never says it. Rationale
> (decided in the Robinhood-chain era, still sound on Solana): Robinhood-the-company brands
> in the Robin Hood mythos space (they own Sherwood Media), so the literal names are a
> trademark / false-endorsement exposure. The archetype is public domain; the names are the risk.

---

## 1. Identity

**Outfox** — a 24/7 trading-floor world, neon terminal-noir meets old-school open-outcry
culture, fronted by the **trickster fox**: the public-domain Reynard archetype (the same
medieval folk tradition as the Robin Hood ballads — zero trademark exposure). The name is a
verb: **"Outfox the Houses."** Players are **Foxes**; crews are **Skulks** (the real
collective noun for foxes). The lore layer sets the central conflict:

> *The Street is owned by the Houses — bloated, slow, connected institutions that have rigged
> the flow. You're an outlaw trader: too small to matter, too fast to catch. Run with a Crew,
> raid the Houses, and share out the take.*

The player is not a criminal being hunted for wrongdoing; they're the **folk-hero competitor**
the market's giants can't out-trade. Failure is a bad call or getting *Nicked* by the Sheriff
— sporting stakes, not moral ones. This preserves TAPE's compliance posture (competition and
satire, not crime) while giving the game a *cause*: the underdog-vs-institutions fantasy.

## 2. Canonical vocabulary (historical mapping)

*(Right column = the single canonical vocabulary. Middle column = retired dev-era
terms, kept only so the immutable sim records and archived docs stay readable.)*

| Mechanic | Retired dev term (pre-2026-08) | Canonical term |
|---|---|---|
| Game name | MEMPOOL | **Outfox** (availability check pending — note the *Outfoxed!* children's board game, different category) |
| Crimes / action list | Exploits | **Calls** (vs players/market) and **Raids** (vs the Houses — the PvE tier) |
| Job tier | Jobs/Gigs | **Gigs** |
| The city / map | The Network | **The Street** — districts: The Floor, Options Alley, The Pit, The Dark Pool, The Vault, After Hours, **The Hollow** (the crews' hideout quarter) |
| NPC antagonist institutions | — (new fiction, existing NPC-faucet role) | **The Houses** — fictional mega-funds; Raid targets. Never named after, or visually evocative of, real firms |
| Enforcement antagonist | — | **The Sheriff** — the Street's enforcer; failed Raids get you **Nicked** |
| Factions / guilds | Syndicates | **Skulks** (crews of Foxes; a.k.a. the Band); treasury = **AUM**; wars = hostile takeovers / turf on the Street |
| Downtime states | Quarantine / Traced | **Margin Called** (busted play) / **Nicked** (caught by the Sheriff) |
| Item market | The Market | **The Open Market** |
| Companies | Operations | **Desks** (prop / OTC / research) |
| Properties | Safehouses / Servers | **Seats** (a Seat on the Exchange — the historical Veblen good) |
| Internal stock market | The Exchange | **The Index** |
| Energy / Nerve | Compute / Nerve | **Focus / Risk Appetite** |
| Training | The Rig | **The Sim** (paper trading) |
| Soft currency | Credits — Clean / Bound | **Scrip — Settled / Unsettled** (T+1 settlement fiction carries the provenance firewall) |
| Premium token | $VIG | **$ALPHA** |
| Stats | Cracking / Latency / Hardening / Stealth | **Conviction / Execution / Discipline / Edge** |
| Redistribution events | treasury events / prize pools | **The Share-Out** — the crew spreads the take (diegetic fiscal policy) |
| Charity-for-status sink | — (new, §4) | **The Commons** — donate winnings for standing |

## 3. Lore rules (what makes it archetypal, and what keeps it clean)

**Banned names (trademark/brand adjacency):** Robin Hood, Sherwood (Robinhood owns Sherwood
Media), Nottingham, Merry Men, Little John/Marian/Tuck, "Hood" as a title; also Robinhood
product names (Gold, Legend, Cortex) and "Greenwood" (Tulsa connotation — hence **The Hollow**).

**Banned framings:** theft/burglary verbs for the core loop ("steal," "rob," "loot" as UI
verbs — use *raid, outtrade, take the other side, claim*); depictions of raiding real-world
institutions; any gambling-vocabulary items from the TAPE blacklist (bet, odds, jackpot,
house edge, parlay, loot box, spin/roll/pull); and never framing chance mechanics as
"prediction markets" or "event contracts" (active CFTC rulemaking category).

**The tone test:** every line of copy should read as *sporting defiance* ("the Houses never
saw it coming"), not criminality ("we broke in"). The Sheriff is an antagonist referee, not
proof the player is a felon.

## 4. The Commons — the lore's mechanical contribution (real economics, not skin)

**Mechanic:** players and Crews may donate Scrip or $ALPHA to **the Commons** in exchange for
**standing** — reputation tiers, titles, cosmetic regalia, Crew prestige, leaderboard weight.
Donations are periodically **Shared Out** as treasury-funded events open to everyone
(newcomer boosts, tournament pools) — never as direct cashable transfers.

**Economic role (why it earns a place in `ECONOMY.md` §2.3):**
- A **voluntary Veblen sink with prosocial framing**: status demand rises with the size of the
  gift — it drains whale wealth *by choice*, complementing progressive demurrage.
- A **new Gini lever** — directly responsive to audit-2's finding that inequality control
  currently leans on the demand-mix assumption; this adds a policy-side redistribution channel.
- **Convenience/status only, never power** (pillar #5 holds), and donations are sink-captured
  to the treasury (CAPTURE-tagged), feeding the Share-Out budget — closing the loop that makes
  fiscal policy diegetic.
- **Firewall-safe:** Unsettled (Bound) Scrip may be donated (it's a sink — an allowed
  destination); donations never mint cashable value and standing is non-transferable.

**Sim/spec follow-up:** add `commons_donate_prob/frac` (status-utility driven, whale-biased)
to the sim's sink set and the sweep; acceptance = measurable Gini improvement at equal
faucet:sink, no G-criteria regressions. Tracked in `sim/AUDIT-2.md` queue as the Gini-lever
response.

## 5. Narrative systems (fiction over existing mechanics — nothing new to build)

- **Heat:** repeated Raids raise Sheriff attention (the existing risk/cooldown pacing) —
  lay low in The Hollow or push your luck. Getting Nicked is the downtime state.
- **The Big Score:** seasonal Crew objectives against a named House (the existing syndicate
  war/season cycle) ending in a Street-wide **Share-Out** (the existing treasury event budget).
- **Standing:** the Commons ladder (§4) — the long-term identity track beside wealth: *rich*
  is one leaderboard, *beloved* is another. Endgame whales compete on generosity — which is
  exactly where we want whale wealth to go.

## 6. The mascot (the marketing engine)

A fox in a trader's jacket: app icon, cosmetic/regalia engine (jacket colors are already the
Open Market's cosmetic line), community identity, meme surface. **$ALPHA** gains a second
meaning (trading alpha / alpha animal). Constraints: the design must NOT resemble Disney's
Robin Hood fox (their specific character design is protected; the generic fox-trickster is
public domain), and per §3 no bows/arrows/tights kitsch — it's a trading floor, not a
costume party.

## 7. Open items

- Availability checks: **Outfox** (trademark/domain/handles; note Gamewright's *Outfoxed!*
  kids' game — different class, counsel to confirm), $ALPHA ticker, The Hollow.
- Art direction pass: terminal-noir + folk-hero iconography + the fox mascot (§6).
- ~~Apply-the-rename decision: executed together with the pivot's governance unlock
  (`ROBINHOOD-FEASIBILITY.md` §6 condition 6), not before.~~ **DONE 2026-07-02** — the
  unlock is recorded in `PLAN.md`; player-facing rename applied going forward (see the
  Status note above for the two-layer vocabulary rule).
