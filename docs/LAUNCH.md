# Launch: how $ALPHA and its market come into existence

Owns one domain: the creation of the $ALPHA mint and of its first open-market liquidity.
Economy rules stay in `ECONOMY.md` (which wins any conflict); the chain edge that moves
$ALPHA in and out of the game stays in `ARCHITECTURE.md` and `programs/`.

**Status:** owner decision 2026-10-02. The launch itself is built and rehearsed end to end
on devnet (`programs/deployments/devnet-launch.md`). **Not built yet:** the join to
settlement. `scripts/genesis.ts` still creates its own mint and initializes settlement
with it, and the devnet settlement deployment still uses that mint; an `initialize` that
takes the launched mint is the next step. Mainnet only behind the launch gates
(third-party audit, counsel). This supersedes the earlier plan in which the operator
minted the supply to the treasury and seeded a pool with its own money.

## 1. What happens

$ALPHA launches through two Meteora programs, both third-party and audited, neither ours:
the Dynamic Bonding Curve (DBC) for price discovery and DAMM v2 for the permanent pool.
We deploy no new program for it.

1. **Create.** One transaction creates the DBC pool, and that transaction creates the
   mint: 2,000,000 $ALPHA at 9 decimals, classic SPL Token, minted once into the curve's
   vault, mint authority removed in the same transaction, metadata immutable.
2. **Curve.** A small share of the supply is sold against USDC along one constant-product
   segment, from the opening price to twice that. The curve fee opens high and decays to
   its resting rate within minutes, so being first is expensive.
3. **Graduate.** When the USDC raised reaches the threshold the curve closes. The USDC and
   the share reserved for the pool move into a DAMM v2 pool at the price the curve ended
   on, and 100% of that liquidity is permanently locked. Nobody can withdraw it, the
   operator included; the position still earns trading fees for the treasury.
4. **Return.** Everything that was neither sold nor pooled goes to the treasury address in
   one permissionless transaction. From here on the token is the inert, fixed-supply mint
   the rest of the project assumes. Settlement is then initialized with it (see Status).

## 2. Published parameters

`LAUNCH` in `packages/shared/src/index.ts` is the single source. The script builds the
on-chain config from it and the verifier reads the chain back against it.

| Rule | Value |
|---|---|
| Total supply | 2,000,000 $ALPHA, fixed |
| Returns to the treasury | 1,760,000 (88%) |
| Sold on the curve | 140,588.74 (7.03%) |
| Paired into the locked pool | 99,411.26 (4.97%) |
| Opening price, graduation price | 0.0625, 0.125 USDC |
| Threshold (USDC that graduates the curve) | 12,426.41 |
| Curve fee | 50% at open, decaying to 1% over 10 minutes, plus a small volatility fee |
| Pool fee after graduation | 0.25% |
| Locked share of pool liquidity | 100%, permanent |

The 12% that goes through Meteora is fixed by the curve's own arithmetic: with one
constant-product segment over a 2x range, the pooled share is the sold share divided by
the square root of 2. The threshold equals the pooled share times the graduation price.

The price band and the depth are **rehearsal values**. The mainnet numbers are an owner
decision at launch time; the earlier depth analysis (a pool of about 25,000 USD total keeps
a 500 USD trade near 4% impact) is where these come from.

## 3. Why this shape

- **The pool no longer needs the operator's money.** The earlier plan needed about 12,500
  USDC of treasury cash beside the token share. Here buyers on the curve supply it.
- **The worst case is close to the old plan.** If demand never reaches the threshold, the
  launcher can complete the curve itself (`launch.ts complete`). It pays what the curve
  still needs, which lands in the locked pool as it would have by seeding it directly,
  plus the curve fee at that moment: 1% at rest, far more inside the opening window. 80%
  of that fee returns to the treasury as fee claimer and 20% goes to Meteora, as does 0.2%
  of the liquidity at graduation. The launcher ends up holding the $ALPHA it bought (the
  sold share), outside the treasury until it sends it back.
- **It is the pool's own price path.** A constant-product segment from the opening price
  to the graduation price is what a pool of that depth would trace anyway, so the curve
  adds an orderly opening and a fee schedule, not a different market.
- **Nothing changes for the game economy.** No play-to-mint path appears, the supply is
  the same fixed 2,000,000, and nothing in the core loop is priced in $ALPHA. The external
  market is outside the validated model either way (`ECONOMY.md` §3, the boundary caveat);
  this decides how that market starts, not how the game runs.

## 4. Invariants

`launch.ts verify` fails on any of these:

- The mint is classic SPL Token, 9 decimals, supply exactly 2,000,000, no mint authority,
  no freeze authority, metadata without an update authority and immutable.
- The config's quote mint, opening price, graduation price, curve share, fee schedule and
  pool fee equal the published rules; the treasury is both fee claimer and leftover
  receiver; the pool creator takes no fee and no liquidity; there is no vesting allocation.
- The pool was built on the recorded config and launched the recorded mint.
- After graduation: the pool is the DAMM v2 pool whose address derives from the launch
  config and the two mints; every position the migration transaction created is locked in
  full (nothing unlocked, nothing vesting) and belongs to the treasury; the treasury holds
  at least its 88%. The launch positions are taken from the migration transaction itself
  (the curve program's own instruction, on this curve pool and this DAMM v2 pool), so
  nothing a third party later creates in the pool or sends to the treasury can pass for
  them or hide them.

What is NOT an invariant: the locked share of the whole pool. DAMM v2 pools are open, so
anyone may add their own liquidity on top of the launch liquidity, and the share that is
permanently locked then falls below 100% although nothing was unlocked. The rehearsal
pool shows 99.50% after one outside position.

## 5. Who receives what

- **Curve trading fees:** 80% to the treasury (claimable any time), 20% to Meteora.
- **At graduation:** Meteora takes 0.2% of the liquidity on both sides. In the rehearsal
  the pool received 12,401.55 of the 12,426.41 USDC raised and 99,212.43 of the 99,411.26
  $ALPHA reserved.
- **Pool trading fees:** to the treasury's locked position, less Meteora's protocol share.
- How the USDC the treasury collects here is classified under `ECONOMY.md` §3 (operator
  revenue, or the reserve for defending the external market) is an open owner decision,
  to be published with the mainnet launch rules.

## 6. Limits, stated plainly

- **The treasury's 88% is locked inside Meteora's program until graduation.** The program's
  instruction list has no abort, refund or early withdrawal, and a withdrawal simulated
  before graduation is refused (`programs/deployments/devnet-launch.md`). The only exit is
  to complete the curve and create the pool.
- **Curve buyers are not wealth-indexed.** Anyone can buy any amount on the curve or in
  the pool. The in-game protections (carry above the shelter, seasoning, the cash-out
  caps) apply once $ALPHA is deposited, not on the open market.
- **Name, symbol and metadata address are frozen at creation.** The metadata file has to
  be final and permanently hosted before a mainnet launch.
- **We depend on two programs we do not control.** Both are audited and widely used, and
  both can be upgraded by Meteora.
- **A curve sale is a sale of tokens to the public.** That is exactly what the counsel
  gate reviews. Nothing here goes to mainnet before the audit and counsel gates.
- A buy that would overshoot the threshold fails; the last buy must be a partial fill.
  After completion the curve is closed both ways until the pool is created. Meteora runs
  keepers that graduate pools on mainnet; on devnet the script does it.

## 7. Runbook

`apps/server/scripts/launch.ts` (its header lists the environment):
`create` → trading on the curve → `complete` only if the backstop is needed → `migrate` →
`claim` → `verify`. `status` at any time. `quote`, `fund`, `buy` and `sell` are rehearsal
commands and refuse to run on mainnet; the cluster is identified by its genesis hash, not
by the environment. `create` checks the on-chain config against the published rules
before it creates the mint, refuses when the settlement program named in the environment
is already initialized, and on mainnet requires USDC as quote and an explicit gates flag.
The treasury can be given as a public key for everything except `claim`, so a cold or
multisig treasury never has to be on the operator's machine. Order with the rest of
genesis: `create` first (the mint must exist), then settlement `initialize` with that
mint, once that mode exists.

Before a mainnet run the script still needs priority fees and rebroadcast on send (devnet
needs neither), and its checks are exercised by the devnet runs only: there is no
automated test of the script itself, only of the server view.

## 8. What the game shows

`GET /api/launch` (public, no session) returns the phase, price, amount raised against the
threshold, and after graduation the pool's reserves and the permanently locked share of
its liquidity. One setting names the launch (`OUTFOX_LAUNCH_POOL`, the curve pool); the
graduated pool's address is derived, never configured. The view is served only when the
launched mint is the mint settlement was initialized with, so the game never presents a
market for a token the Clearinghouse would not accept. It reads upstream at most once per
30 seconds, never makes a request wait on a slow RPC once it has a view, and withdraws a
view that has gone 10 minutes without a successful read.

The server reads the Meteora accounts by byte offset (`apps/server/src/chain/launch.ts`);
the Meteora SDK is a scripts-only dev dependency, never loaded by the process that holds
the voucher key and never installed on the box (`deploy/README.md`). Tests pin the offsets
against the programs' IDLs, the SDK's decoder and real devnet accounts, and guard the
import boundary.
