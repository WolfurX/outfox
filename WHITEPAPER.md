# Outfox — a game where the economy is the game

**Version 0.2 · Draft · 2026-07 · Pre-launch**

---

### What this document is

An explanation of Outfox: what it is, how its economy is designed, and what evidence exists
that the design holds. It is layered — **Part I** is plain language, **Part II** is the
economic design, **Part III** is for engineers and auditors. Read as far as you care to.

Every quantitative claim cites the artifact it came from, in `code font`. Every result that
is *simulated* rather than *shipped* says so. Every problem that is still open is in
[§What can still go wrong](#what-can-still-go-wrong).

### What this document is not

This is not an offer, a solicitation, or investment material, and it is not a prospectus.

$ALPHA is intended as a **consumable utility token used inside a game** to purchase
convenience. It is **not** an investment, a security, a share, or a claim on the operator or
on any revenue. Holding it confers **no ownership, no governance rights, no dividend, no
profit participation, and no entitlement of any kind**. This document contains no price
expectation, no yield projection, no return promise, and no forward commitment; nothing here
should be read as suggesting $ALPHA will hold or increase in value, or that anyone should
acquire it for any purpose other than using it in the game. Any statement about future
development describes present intention, not obligation, and may change or be abandoned.

**The game is pre-launch.** It has not been released, no real-money functionality is enabled,
the contracts are deployed on a **test network only**, they have not received a third-party
security audit, and legal review is a stated prerequisite before any of that changes. Nothing
described here is available to buy today.

---

# Part I — The game

## The one-line version

*A persistent, player-run economy with no token printer — where what you earn is bounded by
what the economy actually produces, not by a promise written against future buyers.*

## What you actually do

You are a **Fox**: an outlaw trader working *the Street* against *the Houses* — the
institutions that own the game and always have. Outfox is a text-and-numbers game. No 3D
world, no avatars. Screens of decisions — and the decisions have weight, because other
players are on the other side of most of them.

The minute-to-minute loop is small and repeats:

- **Calls** — chance actions against the market and other players. Each has a stated
  probability, shown to you before you act. Win and you take value; fail and you're
  **Nicked**, and sit out a cooldown. (A parallel tier, **Raids**, runs against the Houses.)
- **Gigs** — deterministic work. Slower, safer, reliable pay. Honest work on the Floor.
- Both are gated by two bars that refill over real time: **Focus** (work) and **Risk
  Appetite** (Calls). When they're empty, you stop. That throttle is deliberate — it paces
  the game and means nobody grinds infinitely. It is also the main thing real money can
  buy: **a refill.** (See [Monetization](#how-the-operator-makes-money) — this is the
  convenience being sold, and it's worth being upfront that the pacing gate and the revenue
  model are the same mechanism.)

## The two currencies, and why there are two

**Scrip** is the working money of the game. You earn it from Gigs and Calls, spend it, trade
it. It is **not cashable** — Scrip never leaves the Street. It carries a holding cost we call
**Carry**: money you sit on decays daily. That is deliberate. It makes hoarding expensive,
keeps money circulating, and stops the economy from seizing up.

**$ALPHA** is the premium token: a fixed-supply ERC-20, capped at **2,000,000** units, with
no mint function and no owner (`contracts/src/Alpha.sol`). It is the **only** thing in the
game intended to be cashable, and it buys **convenience, never power** — time, slots,
cosmetics, standing. It cannot buy stats, wins, or an in-fiction advantage. If it could, both
the economy and the game would break.

|  | **Scrip** | **$ALPHA** |
|---|---|---|
| What it is | The game's working currency | A fixed-supply on-chain token |
| Cashable? | **Never** | Yes — through one controlled valve |
| What it's for | Earn, spend, trade, build | Premium convenience |
| Holding cost | Carry (daily decay) | Idle decay; large positions pay a progressive carry |
| Supply | Created by play, destroyed by sinks | Capped at 2,000,000. No minting. |

### About "no faucet" — the precise claim

You will see GameFi projects claim they have "no faucet." Here is exactly what we claim, and
what we don't.

**Scrip has faucets.** Gigs and Calls mint it. Saying otherwise would be false, and the code
says otherwise (`apps/server/src/engine.ts`, `sim/simulation.py` F1/F2). What we claim is
narrower and checkable: **Scrip's sinks are calibrated to outrun its faucets** — the
validated designed-only ratio is **0.984** (`sim/AUDIT-2.md`), i.e. sinks slightly exceed
faucets at steady state — and **$ALPHA is never minted to players at all.** There is no
"log in, collect free tokens" mechanic, and there cannot be: the token has no mint function.

That distinction is the entire thesis, and Part II explains why it is the difference between
a game economy and a countdown.

## The firewall — the rule that holds everything up

Scrip comes in two kinds, and they are not interchangeable:

- **Settled Scrip** — from *deterministic work* (Gigs, market sales). Transferable, tradable.
- **Unsettled Scrip** — from *chance* (Calls). It can **never** be sent to another player,
  sold on the market, or converted into anything cashable. It is spendable only on the
  Street's own services: refills, fees, the Commons.

So: **value won by chance cannot become real money.** Not by policy — by construction. There
is no code path from a chance win to the cash-out door, enforced in the engine and gated in
the simulation (criterion G10: zero leakage across all scenarios).

This rule does a great deal of work. It is what separates a game with chance in it from a
mechanism for converting luck into cash — and it is why the rest of the design can afford to
have chance in it at all.

## Getting value out

Cash-out is the only place internal value can become real value, so it is built as a valve,
not a door. A withdrawal must clear all of these (`apps/server/src/settlement.ts`):

| Gate | What it means |
|---|---|
| **Verification** | One-time proof of personhood, required **only** here — never to play |
| **Fee** | 5% withdrawal fee — a sink and a spam deterrent |
| **Seasoning** | Recently-acquired $ALPHA pays a 40% surcharge; it must age ~60 days to leave cheaply |
| **Vesting** | Withdrawals wait ~14 days before they can be claimed |
| **Weekly limit** | A per-person cap on how much can leave in a rolling week |
| **Solvency** | The system can never promise more than the on-chain reserve holds |

Measured against the real contracts: **value deposited and immediately withdrawn comes back
out ~45% smaller** (`sim/M4-CONTRACT-LOOP.md`). Fast in-and-out is strictly
value-destroying. That is the intent — it is what makes farming the valve with fake accounts
unprofitable.

## Being straight about the chance mechanics

Calls are chance actions with variable payouts. That structure — a **variable-ratio reward
schedule** — is the oldest engagement engine in games, and it is genuinely compelling, which
is exactly why it deserves stating plainly rather than burying.

We bound it deliberately:

- Chance-won value is **structurally walled off** from real money (the firewall above).
- Success probabilities are **stated to the player before they act**, not hidden.
- Resolution is **flat and immediate** — no suspense build, no near-miss theatre, no
  escalating celebration. The reveal is capped at 320ms, constant-duration, by design rule
  (`docs/DESIGN-SYSTEM-WEB.md` §8.2). The reveal must never *be* the reward.
- Gambling vocabulary and imagery are banned from the product, and CI-enforced.

We are not going to tell you what legal category any of this falls into — that is for
counsel and regulators, and the project treats counsel as a hard pre-launch gate. What we
can tell you is what we built and why.

## What exists today

This matters, and most whitepapers are cagey about it.

| Built and running | Designed and simulated — **not built yet** |
|---|---|
| Calls, Gigs, cooldowns, the Focus/Risk bars | Skulks (crews), Desks (player businesses) |
| Scrip, the Settled/Unsettled firewall, Carry | The Index (internal market), the Commons |
| Refill sinks; the Open Market (item trading) | Staking, progressive carry, wealth-indexed issuance |
| Guest→registered identity ladder, PWA client | **The Scrip⇄$ALPHA exchange** |
| $ALPHA + settlement contracts, **on testnet** | Real proof-of-personhood; the payment on-ramp |
| Deposits, withdrawals, the full cash-out valve | **Mainnet. Real money. Any of this being live.** |

Everything in Part II's economic design is **validated in simulation**; most of it is not yet
shipped code. Part III separates the two carefully.

---

# Part II — The economic design

*(This part describes the design and its simulated validation. Where a mechanism is not yet
built, it is marked **[designed]**.)*

## The problem we are actually solving

The project's own benchmark research puts GameFi mortality at roughly **90–93%**
(`docs/VALIDATION-BENCHMARKS.md`), and the deaths rhyme. A token printer funds player
earnings; the faucet outruns the sinks; supply inflates; price falls; earners leave; the
thing unwinds. Axie Infinity and StepN are the famous cases.

The failure mode is not "crypto." It is **emission funding**. If the game *mints the token*
that players earn, player earnings are a claim written against future buyers — and when the
buyers stop, the claim breaks. That is arithmetic, not sentiment, and no amount of tokenomics
cleverness repairs it.

**Torn** — a text-based crime MMO with a deep player economy — has run since 2004 with
players who explicitly play to earn, and does not collapse. The reason is unglamorous: it is
**transfer-funded**. Players earn from other players, plus real-money convenience spending.
No token is printed.

**Outfox copies that structure and refuses the reflex to bolt a token faucet onto it.**

> **The invariant, stated precisely:** $ALPHA is **never minted to players**. Player earnings
> come from player-to-player transfer, from real-money convenience spend, and from Scrip
> faucets whose sinks are calibrated to outrun them. There is no emission faucet paying free
> tokens for showing up.

## Managing money like an economy

The usual heuristic is "keep sinks ≥ faucets." Too crude to steer with. We manage the
economy as a macro system, on the quantity theory of money:

**M · V = P · Q** — money supply, velocity, price level, real output.

Stable prices mean money growth ≈ output growth. All four are instrumented in the model, and
the specification requires the same instruments live (`docs/ECONOMY.md` §10 — dashboards are
specified as acceptance criteria; **they are not running yet**, because nothing is live).

The design is grounded in Lehdonvirta & Castronova, *Virtual Economies: Design and Analysis*
(MIT Press, 2014) — real economic theory, not GameFi folklore.

## The three ways a tradable token kills you

### 1. Velocity — hoarding and dumping

Money that stops moving starves the economy; money that moves in a panic collapses the price.
You need velocity inside a band.

**Carry (demurrage) on Scrip** is the main lever, and it is aggressive: the calibrated rate
is **0.45%/day** — roughly **80%/year** on unsheltered balances above the exemption floor
(`sim/simulation.py`, `DEMURRAGE.ratePerDay`). That is far beyond historical demurrage
precedent (Wörgl ran ~5–12%/yr), and **the project's own audit trail names this as an open
item** (`sim/AUDIT-2.md` — "demurrage magnitude vs precedent"). It is doing real work in the
model; whether players tolerate it is a live design question, not a settled one.

**[designed]** Staking on $ALPHA lets holders shelter value from idle decay by locking it.

### 2. Gresham dynamics — bad money drives out good

If the soft currency inflates while the token doesn't decay, rational players spend the soft
currency and hoard the token. Token velocity dies; the working economy floods with
depreciating cash.

Defenses: the exchange rate **floats and is never pegged** (a peg *creates* the arbitrage).
Some goods are priced in $ALPHA, forcing token use. And critically — **idle $ALPHA carries a
holding cost too**, because a decay-free token is simply the superior hoard. Only *locked*
$ALPHA is sheltered, and locked $ALPHA cannot be sold. **[designed]**

> **Named residual:** locking-as-shelter has a known on-chain weakness — third-party
> liquid-staking wrappers could reconstruct sellable exposure to locked positions, defeating
> the "locked can't dump" property. The mitigation is making staking positions
> non-transferable at the contract level; wrapper markets remain a named risk
> (`docs/ECONOMY.md` §13.C).

### 3. Sinks that capture rather than burn

A sink that merely deletes money produces nothing. Good sinks **capture** value: status goods
whose demand rises with price, auction-based sales of rares that extract true
willingness-to-pay, and **the Commons** — a charity-for-status sink where players donate for
standing (never for power), funding public events open to everyone. **[all designed]**

## Running the economy by rule, not by mood

The intent is to operate as a central bank plus treasury with **pre-committed, published
rules** rather than discretion — discretion invites manipulation and destroys trust. Every
lever is a parameter with a validated band; moves within the band follow a stated rule; a
move outside the band requires a fresh validation run first.

**Not yet done:** no rules or parameter values have been published, and the simulation's
constants are explicitly *not* production values (`sim/README.md` — production constants come
from a later calibration discipline). Publishing them is a launch commitment, not an
accomplishment.

## The whale problem, and how the model solved it

Wealth concentration is where designed economies quietly fail. Ours did too, at first.

Under a scenario where only the wealthy buy the token, the model showed a genuinely
oligarchic distribution — a Pareto tail index of **~1.0**, against a bar of 2.0
(`sim/v5_calibration.txt`). The median was policy-controllable; the *tail* was not.

The diagnosis — which took an adversarial review to get right, and which overturned the
obvious answer — was not compounding wealth. It was that **every drain on the token touched
only liquid holdings**, leaving staked positions perfectly sheltered, *combined with* wealthy
buyers having 12–50× the token inflow of everyone else. Those two facts put different player
types' wealth plateaus 4–7× apart, and the tail index was reading that gap.

Two mechanisms fixed it, and neither works alone **[both designed, validated in simulation]**:

1. **A progressive carry on the total position** — holdings above a published shelter pay a
   daily carry whether liquid or staked. Locking still beats idling at every size, so the
   anti-dump property survives; the shelter is simply bounded.
2. **Wealth-indexed primary issuance** — when you buy $ALPHA from the game, the price rises
   with how much you already hold. Second-degree price discrimination; it compresses the
   *inflow* gap at its source.

Result: tail index **~1.0 → 2.80**, inside a wide passing region rather than on a knife-edge
(`sim/v5_calibration.txt`, `sim/AUDIT-2.md` §7).

> **Two named residuals on this result** (`docs/ECONOMY.md` §13.D):
>
> 1. **It is measured *per identity*.** Someone splitting holdings across many accounts
>    evades a per-identity rule, and the mitigations (proof-of-personhood at exit, transfer
>    fees, seasoning resets) bind at *transfer* and *exit* — **not** at buy-and-hold. The fix
>    is real but conditional on identity integrity.
> 2. **The number partly measures an assumption.** The tail-index window sits at roughly twice
>    the whale population share the model assumes, so a *more extreme* demand monopoly than
>    the one simulated would re-break the gate. The real-world guard is instrumenting the
>    actual payer mix at launch — which is a plan, not a result.

## How the operator makes money

A game needs revenue. The rule, validated in simulation:

> **A fee is revenue only where value was already leaving.**

| Channel | Rule |
|---|---|
| **Selling $ALPHA** | Operator revenue. That cash never enters the game economy. |
| **Convenience purchases** (bar refills, slots, cosmetics) | Split by a published rate. Validated: any split up to 90% has **zero** effect on economic dynamics (`sim/AUDIT-2.md` §8). |
| **Cash-out fees** | Operator revenue — this is value *already exiting*, so taking a cut adds no sell pressure that wasn't there. The exchange-fee model. Validated across the full range (§8b). |
| **Fees on value that stays inside** (market fees, Carry, the progressive carry) | **Never taken.** That value is money supply and policy ammunition. Converting it to cash means the operator trading against its own players. |

That last row is the difference between a platform fee and a rug. Note the treasury *does*
conduct market operations in $ALPHA as a stabilisation policy (buying and selling against
sustained deviations, by pre-committed rule) — that is monetary policy funded by captured
sinks, and it is disclosed here precisely because it involves the operator transacting in the
token.

---

# Part III — Architecture, evidence, and open problems

## How it's built

**Server-authoritative.** The client renders; the server owns every value decision, outcome,
and price. A player can never compute their own reward. All economic logic sits behind a
single mutation gate that writes a provenance-tagged ledger entry for every balance change
and rejects overdrafts atomically (`apps/server/src/engine.ts`).

**The chain is an edge, not a runtime.** The hot loop is off-chain; the blockchain holds two
things:

- **The token** (`Alpha.sol`) — fixed supply, minted once to a treasury address, **no mint
  function, no owner, no pause, no upgrade path**. Inert by construction.
- **The settlement contract** (`Settlement.sol`) — the value boundary. Deposits are
  permissionless. Withdrawals require an EIP-712 voucher signed by the game server, and the
  server signs only after every gate above has passed. The contract enforces what only a
  chain can: single-use nonces, expiry, signature validity, a pause, and a **rolling
  withdrawal cap**.

The contract's balance *is* the proof of reserves: the game can never owe more $ALPHA than
the chain holds, asserted after every state change.

**Trust model, stated plainly.** This is a **custodial** edge — it must be, given
server-authoritative state. So the blast radius is bounded explicitly and verifiably: a
compromised *signing* key can drain at most the rolling cap before the operator pauses. The
*owner* key can pause, rotate the signer, and adjust the cap — but **cannot move funds**, and
cannot renounce itself into a state where the reserve is frozen forever. Those are properties
of the deployed bytecode, driven and verified on chain. **The owner is currently a single key,
not a multisig; moving it to a multisig is a stated prerequisite for mainnet**
(`contracts/README.md`).

## The evidence

The economy was simulated, attacked, and re-attacked before economy code shipped — the
project's own rule is *no economy code ships until the model passes*.

**Method.** Agent-based Monte-Carlo with exact conservation ledgers: every unit of both
currencies is accounted for every tick, and any leak fails the run. Twelve exit criteria
(G1–G12) covering inflation, velocity, sink efficacy, inequality, the firewall, solvency, and
sybil extraction. **Six ordinary scenarios** — including a growth plateau, a bot swarm, and a
mule-ring funnel — and **seven adversarial ones**: a flight out of the working currency, a
coordinated bank run, a pump-and-dump cartel, a 60-day confidence collapse, a
demurrage-dodging split, a sophisticated sybil ring, and a whale-dominated market.

**Results** (`sim/README.md`, `sim/AUDIT-2.md`):

- **Standard gate: all 6 scenarios, all 12 criteria, at 500 seeds.**
- **Adversarial suite: 6 of 7 pass — on the survival criteria** (integrity, solvency,
  inequality, working sinks, the firewall, recovery). Two peacetime-stability criteria
  (monetary smoothness, CPI band) are reported as **diagnostics under attack**, not silently
  waived: no economy holds peacetime price variance during a coordinated attack, and the
  scoping is printed on every scorecard. This is a two-tier gate by design, and saying so is
  part of the result.
- **The one remaining failure is reported, not tuned away:** a sophisticated sybil ring
  extracts ~6.07% of cash-out value against a <5% bar. The binding defense is the *quality of
  proof-of-personhood* — a product decision, not a simulation parameter.
- **21 parameters swept, zero knife-edges** — every calibrated value sits inside a
  multi-point safe interval.

**What survived contact with real contracts** (`sim/M4-CONTRACT-LOOP.md`). The valve's claims
were re-checked against the *actual deployed bytecode and actual server code* on a
time-warped chain (vesting is 14 days, seasoning 60 — untestable on a schedule). Proof of
reserves held at every step. Two bugs surfaced that green unit tests never would have: a
voucher-nonce collision that would have stranded withdrawals after any database restore, and
a seasoning clock keyed to the indexer's wall time rather than the block's, which would have
silently reset players' seasoning after an outage. Both fixed.

> **Scope limit, stated because it matters:** the firewall's *hardest* test cannot be run yet.
> The Scrip⇄$ALPHA exchange is not built, so the "chance-Scrip → exchange → cash-out" path
> **does not physically exist today** — today's green result at the valve is partly vacuous.
> The firewall's exchange leg is proven **in simulation only** (G10, zero leakage), and
> re-checks against real code when the exchange ships (`sim/M4-CONTRACT-LOOP.md`, "Honest
> scope limits").

That exercise also found a protection the *model doesn't know about*: the deployed contract's
**global** rolling withdrawal cap bounds aggregate extraction regardless of how many accounts
an attacker controls, while the simulation only ever throttled per-identity. The economic
analysis does not yet take credit for it.

## What can still go wrong

**The token can be speculated to nothing, and the game keeps working.** At launch $ALPHA will
be a permissionless ERC-20 — which means it *will* trade on open markets, and that cannot be
prevented without breaking the thing that makes it cashable. We simulated the worst
expressible case: permanent, throttle-saturating sell pressure for 21 months. The token ends
**97% down** — and every criterion governing *playability* stays green: conservation,
solvency, the firewall, sinks, velocity, monetary discipline (`sim/v6_extdump_probe.txt`).
Nothing in the core loop is priced in $ALPHA. Price and playability are decoupled by design.

**What is *not* green in that run, reported because we said we would:** the token's price
band breaks (obviously), and **in-game inflation runs ~12–13%/yr through the crash** — our
peacetime CPI criterion fails for the duration. The game remains solvent, honest, and
playable; it is not *comfortable*. That is the whole admission: **we can protect the game,
not the price.**

**Identity is the load-bearing assumption.** Several defenses are per-identity. If cheap
sybil accounts are available at scale, both the whale-tail fix and the sybil bounds weaken.
Proof-of-personhood at cash-out and funding-graph analysis are the answers; their real-world
quality is an open question, not a solved one.

**The model has boundaries.** External market dynamics are probed, not modeled. Player morale
— people quitting *because* the price fell — is not endogenous. Inflation is measured with a
reduced-form index, not a true basket. Demurrage magnitude exceeds historical precedent by an
order of magnitude. Each is on a queue with a stated plan (`sim/AUDIT-2.md`), not quietly
omitted.

**Most of the game is not built.** See [What exists today](#what-exists-today). The economic
design is validated in simulation; the majority of it is not yet code.

**Legal review is a hard gate.** A cashable token, combined with earning as a draw, combined
with variable-ratio mechanics, can implicate gambling, securities, and money-transmission law
simultaneously. The design carries deliberate mitigations — the chance/real-money firewall
above all — but **mitigations are not clearance**, and this document does not assert any legal
conclusion. Counsel before launch is a stated, non-negotiable gate, as is jurisdictional
geofencing.

---

## Closing

Most GameFi projects fail because they promise a return and fund it with a printing press.
Outfox makes a narrower claim and tries to fund it honestly: **there is no token printer
here, and the game's economy is designed to survive people trying to earn from it.**

Whether it does is an empirical question. Everything above that says "verified" points at an
artifact you could re-run. Everything that says "open" is genuinely open. If this fails, it
will most likely fail in one of the places already named — which is the most useful thing a
document like this can offer.

---

*Outfox is pre-launch and not available. $ALPHA is a utility token intended for in-game use
and confers no rights of any kind. Nothing in this document is an offer, a solicitation, or
investment advice; nothing here is a promise about future development, value, or
availability; and nothing here states a legal conclusion about the product.*
