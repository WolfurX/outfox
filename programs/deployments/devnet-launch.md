# Devnet launch rehearsal, 2026-10-02

The $ALPHA launch of `docs/LAUNCH.md`, run end to end on devnet by
`apps/server/scripts/launch.ts` with the published `LAUNCH` rules: create the config and
the pool (which creates the mint), three trades on the curve (two buys and one sell), the
launcher completing the curve, graduation into a DAMM v2 pool, leftover to the treasury,
treasury fee claim. `launch.ts verify` passed before graduation and after it (all checks).
Every trade, the completing buy included, happened inside the 10-minute opening fee
window (at 18 s, 291 s, 307 s and 314 s after the pool opened), so this run never
exercised the resting 1% fee; the feasibility run below did, on a shorter window.

This is a rehearsal with throwaway keys and a throwaway mint. It is NOT the mint the
devnet settlement deployment uses (`devnet.md`); the beta deployment gets its own launch.

| | |
|---|---|
| Cluster | devnet (`https://api.devnet.solana.com`) |
| DBC program | `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` (Meteora) |
| DAMM v2 program | `cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG` (Meteora) |
| Launch config | `8LLMWukhw8ZpNjtnmTpSSy6J3QHYVYSMxf51duG6PXV3` |
| Rehearsal mint | `A93g9PNLzxhwB5K7aZvALUavkpFK7AgvTVR1sNAM72tV` (9 dp, fixed 2,000,000, no mint or freeze authority, immutable metadata) |
| Curve pool | `TcCuTa8oh61J2ChwugzdPopCg2Zpv8GXHNnb3rK7kYt` |
| Quote mint | `8e8BQDLoP9ikezYzGMXjZYGjb517jKagTxPrs7eGAMGN` (6 dp stand-in for USDC, minted freely by the payer) |
| DAMM v2 config | `A8gMrEPJkacWkcb3DGwtJwTe16HktSEfvwtuDh2MCtck` (customizable fee) |
| DAMM v2 pool | `9MKjydp1q9FThUyQ63PxDuhdZHZYccrutJuHVKVxrYmd` |
| Locked position | `7EKxdzbongmHqd35A99yu9LN3AMHyj5LFjqjunrsq7Ui` |
| Treasury | `4DJYV6hWQCY6irD7o8LoeEX1jRbbiRtYHrWasrksrnr2` (fee claimer, leftover receiver, owner of the locked position) |
| Payer | `6Q5H9msVpGg3dZm41prT3Vzr7wtfXpjTmgB8BFxfKc5J` (pool creator: no fee share, no liquidity; it ran `complete`, so it holds the $ALPHA that purchase bought) |

## Result (chain state after the run)

| | |
|---|---|
| Mint supply | 2,000,000.000000000 exactly; mint authority none |
| Sold on the curve | 140,588.74 $ALPHA, held by the two buying wallets (the rehearsal trader and the payer that completed the curve) |
| Locked DAMM v2 pool | 99,212.434529881 $ALPHA and 12,401.554058 USDC; permanently locked liquidity equals total liquidity |
| Pool opening price | 0.125 USDC |
| Treasury | 1,760,000.002927453 $ALPHA (the 88% plus rounding dust) |
| Raised on the curve | 12,426.406872 USDC against a threshold of 12,426.406871 |
| Curve trading fees | 902.843313 USDC to the treasury (claimed), 225.710826 to Meteora; far above the resting rate because every trade, including the completing buy of 11,370.72 USDC, paid the opening-window fee |
| Graduation fee | 0.2% of both sides to Meteora (24.85 USDC, 198.82 $ALPHA) |
| Outside liquidity, added afterwards | the rehearsal trader added its own position (500 $ALPHA and 62.5 USDC, tx `35mwn2iSc7Me83WPkthNaZTG5iGP5qHsDcBNfUA3yxRFvBvVh6cX6qyvKRovsPBcndPjL1HHsqmCkmVvYbyRY6Xq`): the pool then held 99,712.43 $ALPHA and 12,464.05 USDC, the treasury's position stayed locked in full, and the permanently locked share of all pool liquidity read 99.50%. `verify` still passes; this is the case its lock check is written for |

## Transactions

| Step | Signature |
|---|---|
| create stand-in quote mint (6 dp) | `2iLK3B9ro4GDcxKQNPNLveRdeqCy8CTn63PFxiftxtBr1h9MnLLVyFdj8ZQFLzF1iiVQKutpvAboav6DpmVsyoWa` |
| fund 22FAs6VWBAQsKxLdjsKEMC2zbqDqH234VjiPjNewPRZz with 20000 stand-in quote | `2gZn5UK3iPdbRtHX86dqzFkY8uKtPQrXUYTVEzWFvrZLbyXRo1SzKyWjwssCik4ZG8p496XLVx64rQCkd2GHcbAb` |
| fund 6Q5H9msVpGg3dZm41prT3Vzr7wtfXpjTmgB8BFxfKc5J with 40000 stand-in quote | `ZumwqRV2D6HwkURBAPnsvB8Rr4C1CMEgD5PPMhqkACFGtvbt4tfiCbiRNy9vG8Fc3SXqybhPAZ4iMGc9EQDe9jx` |
| create config | `3HXXSiU7LYfjdgSA7NPUHnnKXK6e4skcBhcewD27K8e7wjbg2qi2tHQhqAkHp6oQjrK1rYXYXhY131tXDvGVxEho` |
| create pool (creates the mint) | `4eSj2JFZ5gxwM8hX6fLhq3XaiZNxKQyErGGvhiCMuMbDuBwh2pf3aFpK1uTQujPW9aPKLGAL2iRFv1ceLdNzoLm4` |
| buy with 500 quote | `3S1K9zLHEe9u2X37abgPh1CM81oGcxTrS1mo7aTnRD7GRipAumL8pdh9MFtg1s5VJ9jD2eD2MbmGwy59gLAC7zVi` |
| buy with 1000 quote | `44Cze7AtRfykYSXavhZqdxG9spZhebnXQxAnsMFCDiAiRMFuNP6Vqf2JMq3SvETgnN1wJqjGNUb6KaK1PPesFNEq` |
| sell 2000 ALPHA | `JKtxU2GAREiXZGw3bc3VFBjngbFuSketKY3yukpBS6oDif4Xh51fuogQfBHctYWuSQ5BweS4iFJYGYQ61BmcvtL` |
| complete the curve (11,370.716061 quote still needed) | `3buFZfAcmwh3EvrQfb4CKoxqWExWfbZDRB13sJeFXvgggvaebScMvUckuAhZvfaEtTJ2F5nNwyLqsiL9DxyAZcHn` |
| migrate to DAMM v2 | `5xx7BvCDV6QYsPN6haz5neXVtabb8uXB36fnbziB2BmWcmrro6AANVn2qT6CucnwfMG99oEdK6DZ1qQLzfwnem7V` |
| withdraw leftover to the treasury | `3pAQ9vih6nwWGmmh93scbvPz7xmfuT5Z8Mvkech4chzXwVa4aWaLLaxmvHrE686F8dDdbtoaVWFnwnw5wA8JZATn` |
| treasury claims curve trading fees | `44UAcVZGe3JiXcucEG3bcpW8VMxU1VT3uPhUT1Jk149fT7n373rt2MMKrWSAvMr4NyfepHv9jaWXGB8MS9QfMBhs` |

An earlier feasibility run of the same lifecycle at a 0.50 to 1.00 band supplied the
graduated-pool fixtures in `apps/server/test/fixtures/launch/` (config
`BftDiGCh6t5sPorixN8nBK8tiw9fEHmXgYRKobEjZocq`, curve pool
`5i5YUoQN7R9eAxXMZGKPQ6uNDHmJgtAfV42qSCBhKT2f`, DAMM v2 pool
`Ae5wdHZ3rhNhz7s3KFhqLK8KG89aVw3eRxcFTXhuL2QN`). It also established, by simulating
transactions against the devnet program without sending them, that the treasury cannot
withdraw its share before graduation (`NotPermitToDoThisAction`, 6022, both right after
creation and after the curve completed), that a second withdrawal is refused
(`LeftoverHasBeenWithdraw`, 6026), that the owner of the locked position cannot remove
liquidity (cp-amm `InsufficientLiquidity`, 6023), that a buy larger than the curve
still needs fails (`InsufficientLiquidity`, 6033) unless it is a partial fill, and that
between the curve completing and the pool being created both a buy and a sell are
refused (`PoolIsCompleted`, 6013). That run
used a 120-second fee window and measured the resting fee: a buy at 128 s paid 1.0025%.
That the program has no abort or refund instruction is read from its instruction list
(SDK 1.5.13, IDL 0.2.1), not tested.
