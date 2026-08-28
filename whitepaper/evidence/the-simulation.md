# The simulation

The economy was simulated, attacked, and re-attacked before economy code shipped. The project's standing rule: **no economy code ships until the model passes.**

## Method

Agent-based Monte-Carlo with exact conservation ledgers: every unit of both currencies is accounted for every tick, and any leak fails the run. Twelve exit criteria (G1 to G12) cover inflation, velocity, sink efficacy, inequality, the firewall, solvency, and sybil extraction.

Six ordinary scenarios, including a growth plateau (the pattern that killed Axie and StepN), a bot swarm, and a mule-ring funnel. Seven adversarial ones: a flight out of the working currency, a coordinated bank run, a pump-and-dump cartel, a 60-day confidence collapse, a demurrage-dodging split, a sophisticated sybil ring, and a whale-dominated market.

An early version of this gate was audited and found too kind: several criteria could not fail. The engine was rebuilt around failable gates and exact ledgers, the earlier "all pass" results were voided, and the numbers below come from the rebuilt engine. We mention this because a gate that cannot fail is worse than no gate, and because it is the part of the story most projects would leave out.

## Results

* **Standard gate: all 6 scenarios, all 12 criteria, at 500 seeds.**
* **Adversarial suite: 6 of 7 pass on the survival criteria** (integrity, solvency, inequality, working sinks, the firewall, recovery). Two peacetime-stability criteria, monetary smoothness and the CPI band, are reported as diagnostics under attack rather than silently waived: no economy holds peacetime price variance during a coordinated attack, and the scoping is printed on every scorecard.
* **The one remaining failure is reported, not tuned away.** A sophisticated sybil ring extracts about 6% of cash-out value against a 5% bar. Scaling the attack up shows the defense that actually binds: not withdrawal caps (the simulation demonstrates no throughput cap moves this number), but the **quality of the proof-of-personhood check**. That decision has since been narrowed: the check will be document-and-liveness verification with biometric duplicate detection, chosen after a provider coverage study, with the final provider pinned at the legal review. Its live quality remains something to measure against this same bar, not assume.
* **21 parameters swept, zero knife-edges.** Every calibrated value sits inside a multi-point safe interval.

## What survived contact with real contracts

The valve's claims were re-checked against actual deployed bytecode and actual server code on a time-warped chain (vesting is 14 days and seasoning 60, untestable on a calendar). Proof of reserves held at every step. Two bugs surfaced that green unit tests never would have: a voucher-nonce collision that would have stranded withdrawals after any database restore, and a seasoning clock keyed to the indexer's wall time instead of the block's, which would have silently reset players' seasoning after an outage. Both fixed.

That exercise also found a protection the model doesn't take credit for: the deployed settlement design carries a **global** rolling withdrawal cap that bounds aggregate extraction no matter how many accounts an attacker controls, while the simulation only ever throttled per identity.

This end-to-end pass was proven against the previous chain target's contracts; it **re-runs against the Solana programs before anything opens**, and [the roadmap](../status/roadmap.md) treats that rerun as a gate, not a formality.

## Boundaries of the model

External market dynamics are probed, not modeled. Player morale (people quitting *because* the price fell) is not endogenous. Inflation is measured with a reduced-form index, not a true basket. The Carry rate exceeds historical demurrage precedent by an order of magnitude. Each of these sits on a queue with a stated plan, not quietly omitted.
