# $ALPHA

$ALPHA is Outfox's premium token on **Solana**: an SPL mint with a fixed supply of **2,000,000** and the mint authority **revoked at genesis**, which is Solana's strongest form of "no more will ever exist." The entire supply is minted once, in the transaction that creates the token, and the authority to mint is removed in that same transaction; after that the token is inert. No minting, no owner powers over balances, no upgrade path.

## How it launches

$ALPHA is designed to come into existence through a launch pool on Meteora, a liquidity protocol we use and do not control, rather than being minted to us and listed afterwards. **Status:** the launch has been rehearsed end to end on devnet with a separate test token and checked against the rules below. It is not yet connected to the game: the token the devnet build uses today was created the earlier way, minted once to a treasury address. The numbers below are the rehearsal's; the mainnet price and depth will be published before launch.

* **A small share is sold on a curve.** About 7% of the supply is offered against USDC along a gentle price curve that ends at twice the opening price. The curve's trading fee starts at 50% and falls to 1% within ten minutes, which makes being first expensive rather than profitable.
* **The proceeds become the market, and stay there.** When the curve completes, the USDC it raised and about 5% of the supply move into a trading pool, and that liquidity is permanently locked. Nobody can withdraw it, us included, under the pool program as it is deployed. Others may add their own liquidity to the pool later; the launch liquidity stays locked. This replaces the earlier plan in which we would have funded the pool ourselves.
* **The rest, 88%, returns to the treasury** once the pool exists, to be used only under the published rules (see [Running money by rule](../the-economy/policy-by-rule.md) and [How the operator makes money](../the-economy/operator-revenue.md)).
* **Who receives the fees.** 80% of the curve's trading fees go to the treasury and 20% to Meteora. Meteora also takes 0.2% of the liquidity when the pool is created. After that, the trading fees earned by the locked liquidity go to the treasury, less Meteora's share. This is money the operator's side receives, so it is listed on the revenue page too.
* **If nobody buys, we finish the curve ourselves.** That costs what funding the pool directly would have, plus the curve's trading fee, and the money ends up in the same locked pool. We would then be holding the share we bought, about 7% of the supply, in addition to the treasury's 88%.

Three things to know. Until the pool is created, the treasury's share is held by the launch program and cannot be touched; there is no way to cancel a launch, only to complete it. A public curve is open to anyone in any size: the protections against hoarding and fast exits described below apply inside the game, not on the open market. And the lock is enforced by Meteora's programs, which Meteora can upgrade; that is a dependency we accept and cannot remove.

## What it buys

Convenience and standing, never power:

* Bar refills (time), extra slots, premium cosmetics, Commons standing.
* Nothing that affects stats, outcomes, or any in-fiction advantage. This line is absolute; crossing it breaks both the game and the economy.

## How it enters and leaves circulation

* **In:** purchase from the game (wealth-indexed pricing, see [Running money by rule](../the-economy/policy-by-rule.md)), or deposit from the open market through the settlement program.
* **Around:** the Scrip⇄$ALPHA exchange floats freely; some goods are priced in $ALPHA.
* **Out:** the cash-out valve only, with its fees, seasoning, vesting, weekly caps, and one-time personhood check. See [Getting value out](../the-economy/getting-value-out.md).
* **Never:** minted to players. There is no play-to-mint mechanic and no code path for one.

## Holding it has a cost, on purpose

Idle in-game $ALPHA decays slowly; positions above a published shelter pay a progressive carry. Locking **\[designed]** shelters value from idle decay but cannot be sold while locked. These are the anti-hoarding and anti-whale levers described in [the economy section](../the-economy/two-currencies.md), and they apply inside the game ledger; the on-chain token itself is untouched and standard.

## What we will not promise

$ALPHA will trade on open markets; a cashable token cannot prevent that without breaking the thing that makes it cashable. What we do commit to on that front: the launch liquidity is permanently locked the moment the pool is created, verifiable on-chain, so the operator cannot pull the pool. We simulated the worst expressible case, permanent throttle-saturating sell pressure for 21 months: the token ends 97% down, and every criterion governing playability stays green. Price and playability are decoupled by design, because nothing in the core loop is priced in $ALPHA. The honest reading cuts both ways: **we can protect the game, not the price.** The full result, including what breaks in that run, is on [What can still go wrong](../evidence/what-can-go-wrong.md).

$ALPHA is a utility token intended for in-game use. It confers no rights of any kind: no equity, no revenue share, no governance. See the [Disclaimer](../status/disclaimer.md).
