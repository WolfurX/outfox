# Getting value out

![](../.gitbook/assets/clearinghouse.webp)

Cash-out is the only place internal value can become real value, so it is built as a valve, not a door. The player-facing surface is **the Clearinghouse**; behind it, a withdrawal must clear all of these:

| Gate | What it means |
| --- | --- |
| Verification | One-time proof of personhood, required **only** here, never to play |
| Fee | A withdrawal fee: a sink and a spam deterrent |
| Seasoning | Recently acquired $ALPHA pays a heavy surcharge; it must age about 60 days to leave cheaply |
| Vesting | Withdrawals wait about 14 days before they can be claimed |
| Weekly limit | A per-person cap on how much can leave in a rolling week |
| Solvency | The system can never promise more than the on-chain reserve holds |

Measured against real contracts in the contract-in-the-loop harness: **value deposited and immediately withdrawn comes back out roughly 45% smaller.** Fast in-and-out is strictly value-destroying. That is the intent. It is what makes farming the valve with fake accounts unprofitable, and the patient version of the same attack pays for the wait through idle decay and the seasoning clock.

## Why proof of personhood sits here and nowhere else

Playing requires nothing: a guest account works on the full core loop. Identity is demanded only where real money exits, because that is the only place a fake identity can hurt anyone but its owner. The adversarial simulation results are blunt on this point: no throughput cap, per-account or global, defends against a sybil ring; **the quality of the personhood check is the binding defense**, and it is listed as an open product decision on [the simulation page](../evidence/the-simulation.md), not a solved problem.
