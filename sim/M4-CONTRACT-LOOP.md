# M4 — contract-in-the-loop (2026-07-11)

`ECONOMY-SIM-SPEC.md` §15 milestone 5: *"contract-in-the-loop for the exchange + cash-out;
re-check G10/G11/G12 against real contract behavior."*

**What it is.** The abstract sim credits the cash-out valve with throttling extraction
(w_cap, PoP, vesting, seasoning, fees) and asserts proof-of-reserves as an in-model
identity. Those are now **real code against a real contract**. This harness
(`apps/server/scripts/m4-contract-loop.ts`) drives the **actual deployed artifacts** —
the same `Alpha.json` / `Settlement.json` bytecode that is live on testnet 46630 — plus
the **actual server valve** (`settlement.ts`, `chain.ts`, including the real indexer), and
re-checks the three contract-dependent gates against observed behaviour.

**Why anvil, not testnet.** Vesting is 14 days and seasoning is 60. The harness must warp
time, so it runs on a local EVM and advances the chain clock and the game clock *together*.
Everything else is the production path: real deposits, real logs, real indexing, real
EIP-712 vouchers, real redemptions.

Run: `anvil --silent &` then `npx tsx scripts/m4-contract-loop.ts` (from `apps/server`).

## Results — ALL CHECKS PASSED

### G12 — proof of reserves, against a real chain
- A full round-trip (deposit → index → request → vest → sign → redeem → confirm) holds
  `reserve() >= liabilities` at **every intermediate step**, asserted after each state
  change, not just at the end.
- Fees accrue as **un-owed surplus** inside the contract — which is *why* the invariant is
  `>=` and not `==`. That surplus is exactly the boundary-fee revenue of `ECONOMY.md` §3.

### G10 — the provenance firewall, at the valve
- A Fox holding 1,000,000¢ of **chance-won (Unsettled) Scrip** and zero ALPHA cannot fund
  a cash-out: the request fails, because **no code path converts chance value into ALPHA**.
- Structural check: every ALPHA lot in existence has `source = 'deposit'` — the only writer
  of the ALPHA balance is a confirmed on-chain deposit.

### G11 — sybil extraction, priced against the real valve
- **A fresh deposit round-trips at a 45% LOSS** (50 ALPHA in → 27.50 out): the 5% fee plus
  the 40% unseasoned surcharge make fast in-and-out **strictly value-destroying**. A mule
  ring cannot launder value through the valve at a profit; it can only wait out the 60-day
  seasoning, during which the §13.A idle holding cost applies.
- **The split-identity residual is confirmed and now priced:** `w_cap` is per-identity
  (58 ALPHA/week), so *k* identities do buy *k*× the weekly throughput — the residual named
  in `ECONOMY.md` §13.D and in the AUDIT-2 G11 queue is real, exactly as documented.

## NEW — the contract enforces a bound the sim never credited

The sim models **only per-identity** throttles, so its G11 analysis is pessimistic about
identity-splitting by construction. The deployed `Settlement` adds a **global rolling
withdrawal cap** (leaky bucket, `windowCap` per rolling 24h) that the model has no
representation for. Verified live:

- Once the rolling cap is spent, **even a validly signed voucher is refused** — the drain
  is bounded system-wide, *regardless of how many identities present it*.
- The cap **refills linearly** (leaky bucket), so there is no boundary burst — the fix that
  replaced the original tumbling window after the contract security review.
- At the harness's deliberately tight setting (500 ALPHA/24h vs 58/identity/week), the
  global cap becomes the binding constraint at **~9 identities**: beyond that, adding mules
  buys an attacker nothing.

**Implication for the open G11 item.** Split-identity extraction is bounded by
`min(k · w_cap_weekly, windowCap_daily · 7)`. Sizing `windowCap` near real daily withdrawal
volume therefore caps *aggregate* sybil throughput independently of PoP quality — it does
not replace PoP (which still governs *who* may exit), but it does bound *how much* can exit
per unit time, which the sim's G11 analysis does not currently credit. **Round-7 or the
next sim round should model the global cap** and re-judge `smart_sybil` with it.

## Bug found — and fixed — by running the real thing

`creditDeposit` was timestamping seasoning lots with **`Date.now()` (the indexer's wall
clock)** rather than the deposit's **block timestamp**. Consequence: an indexer catching up
after downtime, or replaying history, would silently **restart the 60-day seasoning clock**
for every affected deposit — penalising honest players and making the ledger non-replayable
in time (though never in amount — the idempotency key held). Now the lot's clock starts at
the block that carried the deposit, which is the only replay-stable answer.

Unit tests could not have caught this: it only appears when the indexer's clock and the
chain's clock diverge, which is precisely the condition a contract-in-the-loop harness
creates. This is the second bug the real chain surfaced that green tests did not (the
first: voucher-nonce collisions, see `apps/server` commit history).

## 2026-08-09 — the exchange half. M4 IS NOW COMPLETE (both halves)

The Scrip⇄ALPHA exchange exists in the build (`apps/server/src/exchange.ts`): a
floating, never-pegged, protocol-owned constant-product pool implementing the sim's
`_exchange_step` mechanics one for one — input-side fee (1.5%, CAPTURE: Scrip leg →
treasury, ALPHA leg → `treasury_alpha`), the §13.B(d) per-side flow cap (2% of that
side's reserve per rolling 24h), the §13.B circuit-breaker fee (multiplier from
fast/slow EMA deviation beyond the band, capped 4×, EMAs rolled once per day from the
close so a trade can never move its own fee), Settled-only input (G10), and every
bought lot lands **unseasoned** with `source='exchange'` (§13.C). Sells consume
**youngest lots first** — the sim's attacker-optimal assumption, and the
player-favorable rule. The harness (same file, `EXCHANGE` section) re-ran everything
against the real contracts. **ALL CHECKS PASSED:**

- **E6 — the pool is reserve-backed by construction.** Seeding consumed a specific HELD
  on-chain treasury deposit (`poolSeedFromDeposit` deletes the unclaimed row — the same
  deposit can never also be claimed by a later wallet link), and `solvencyAudit` now
  counts pool inventory + ALPHA treasury as liabilities. PoR held at every step of every
  trade and cash-out, including the seed itself.
- **G10 at the exchange.** A Fox holding 1,000,000¢ of chance-won (Unsettled) Scrip
  cannot buy ALPHA — the refusal is the firewall (`insufficient_settled`), not a rung
  gate. With exchange lots live, every ALPHA lot still traces to a real deposit or a
  Settled-Scrip buy.
- **G11 — the farmed channel, finally priced end-to-end.** The channel the sim's
  `funnel`/`smart_sybil` scenarios assume is now real, and it behaves exactly as the
  model prices it: 5,000¢ farmed → exchange → immediate cash-out landed 27.04 ALPHA
  on-chain, a **−45.9% loss vs mid** (exchange fee + slippage + 5% valve fee + 40%
  unseasoned surcharge). A **patient** mule that waits out the full 60-day seasoning
  pays only fee + friction (**−6.5%**) — seasoning, not fees, is what patience buys off,
  and the sim charges that patience the §13.A idle decay (see scope limits below).
- **E4 — the flow cap paces, it does not block.** A buy beyond the rolling cap is
  refused; the same order fills a day later; the pool cannot be pushed more than ~2% per
  side per day.
- **E5 — the toll escalates under attack and only under attack.** 15 days of max-cap
  one-way buying escalated the fee 150 → 283 bps (cap 600); 40 quiet days restored the
  base fee. Calm trade never left 1×.
- **Every ledger closes.** Scrip conservation (players + treasury + pool == faucet
  mints + pool seed), the pool row as an exact fold of the append-only exchange event
  stream (`DATA-ARCHITECTURE.md` principle 1), and final PoR with ~49.5k ALPHA of
  un-owed boundary-fee surplus.

**Deliberate translations from the per-tick model** (recorded, not drift): the sim's
per-tick pro-rata fill becomes a rolling-24h first-come cap (same bound, continuous
time); "last tick's EMAs" becomes a lazy once-per-day roll from the close. Both are the
natural continuous-time readings of the discrete mechanics.

## Honest scope limits

- ~~The exchange half of M4 is not testable yet~~ **CLOSED 2026-08-09** (section above).
- ~~The §13.A/§13.D in-game ALPHA carry is still queued.~~ **CLOSED 2026-08-15**: the
  carry module is live (`apps/server/src/settlement.ts` `applyAlphaCarry`, lazy like the
  Scrip carry) — idle liquid $VIG/ALPHA decays daily at the Credit rate with no floor,
  the total position above the published 250-ALPHA shelter pays the 4.5%/day progressive
  carry, and proceeds land in the ALPHA treasury (CAPTURE). The patient mule now pays
  the §13.A decay the sim always charged (≈−24% over the 60-day wait for a sub-shelter
  hoard, on top of the −6.5% fee floor), and the held-deposit side door (park unclaimed
  to age seasoning decay-free) is priced at claim. Test-pinned against an independent
  reference schedule (`apps/server/test/carry-alpha.test.ts`). Residual translation:
  the build has no staking yet, so the whole position is liquid — the staked exemption
  arrives with the staking module and cannot yet diverge.
- **The §13.B treasury op legs (TWAP buyback/sell) are not built** — the defensive
  *market* mechanics (flow cap, vol-fee) are live; the treasury's own operations remain
  a policy-job for a later round, and the exchange primitives are shaped for it (an op
  is a pool trade by a system actor).
- The harness runs a handful of agents to exercise invariants, not a population-scale
  Monte-Carlo. Population dynamics stay in the Python sim; this validates that the *real
  implementation honours the assumptions the sim makes about the edge*.
- `windowCap` here is deliberately tight (500 ALPHA/24h) to exercise the bound. Production
  sizing is an owner decision (`contracts/README.md`: size near real daily volume).
