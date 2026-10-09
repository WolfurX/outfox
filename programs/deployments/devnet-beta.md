# Devnet beta deployment, 2026-10-03

The first deployment on the launch path of `docs/LAUNCH.md`: the program under a fresh id, the
$ALPHA mint created by a Meteora Dynamic Bonding Curve pool, settlement initialized with that
mint through `GENESIS_MINT` + `GENESIS_LAUNCH_POOL` (state read back and matched), and
`e2e-devnet.ts` ALL CHECKS PASSED against it the same day (deposit, indexer credit, vesting,
signed voucher, forgery and replay rejected, pause, proof of reserves), with a test wallet that
bought on the curve standing in as the token source. The curve is left open for the beta;
completion and graduation are an explicit operator step (`launch.ts complete`, `migrate`).

| | |
|---|---|
| Cluster | devnet (`https://api.devnet.solana.com`), voucher chain id **1** |
| Program | `574eotmx4QLJ1F3eNjBDXa1tECFs2kXRpbYEEmP8U98y` (built from the 2026-10-03 source: `initialize` accepts an existing escrow) |
| Upgrade authority | `Cd9t8S9hqRXdKSmozX19KaDxRs957GJuncckBotgKGC6` (the beta payer; a multisig at mainnet) |
| $ALPHA mint | `43n17cHnw41WBCnxF8BSDprq7CW9wrXgrNwZmiR5NqLL` (9 dp, fixed 2,000,000, created by the launch pool with no mint or freeze authority, immutable metadata at `https://raw.githubusercontent.com/WolfurX/outfox/master/apps/web/public/alpha.json`) |
| Launch config | `F2XFVZFAymbqhDq5pwDNHwEjig22oFUzzK56uHwPgUxH` |
| Curve pool (DBC) | `HhMKSRKXQCRB9jkQdd2PVhTse8a5to5M8h6mdHmFy4XW`, **open**: the curve has not graduated; the treasury's 88% sits in the curve vault until it does |
| Graduated pool (DAMM v2), when it exists | `D6Vqvmbup64Kvw6GMhC44Hbchp13PEtJVStxgfqmUyLT` |
| Quote mint | `BMkzNu1hbuNSvo4LAiMcgEpGfpt6ukneSjqd2LhDM8Gz` (6 dp stand-in for USDC; minted by the payer for testers) |
| State PDA | `CBeSoxt4o7ZtmLEgm5Hz3MF2HQuditYFw7HmrELDeNQD` |
| Escrow ATA | `EBcdf4KxzUwyHThMt3HbRh828jWKD9bfFQMwZhyQ6SzZ` |
| Admin (cold) | `DDpPhoRNLF2hpb7xiuCRiEPaKa7qimfsMYi1ZmHYaoLf` |
| Voucher signer (hot) | `Dt94u1HmFVNAGdxcJPwTfP3fTaAmshhiP6tstnogv5bk`, seed generated on the beta box 2026-10-09 and never left it; registered by `set_signer` (below). The 2026-10-03 signer from the beta key directory is retired |
| Treasury | `8MfTGfFNgPSXsWrMaBGM8kzeyUmySBuTLTnAmyxrue3A` (fee claimer, leftover receiver, locked-position owner) |
| Window cap | 500 ALPHA per rolling 24h |

## Transactions

| Step | Signature |
|---|---|
| create stand-in quote mint (6 dp) | `2pJyW4hBQcfSX6etskrxgVc4BX8k9Gc5ENJz84akDYhbLv3gKr77dXarmKGQMSQoKposea7D4RczGvv7FhyiuPhs` |
| fund CLbRMF4LvWxTPzCX84GyCvu2iR7PULSrY41EDwaNoM1C with 3000 stand-in quote | `62xHUfw4YWcJ6eFsARkSYShxgbWKh3akFx6GoJNr7Qy2ggHkm5A1edKYG2bkeXNRtcXSBDHg7Bc9UY6SizmrxwM8` |
| fund Cd9t8S9hqRXdKSmozX19KaDxRs957GJuncckBotgKGC6 with 20000 stand-in quote | `4Hh7w71ExcLXBJn1qhXy5pv9hPUjQJyw514WWvY1pnZ7XzDiBiBKZEtg1zcTL22mNqQE8DsyVYof6YBPCJt2ypJh` |
| create config | `4A3DirT8PrMGMcSc1AewCmrmSZaGNyMCjFacWCXENvdCWwoBf1AMvqn8HV9HQMs5vu5J6nkHLQct1MJcC44z5N4F` |
| create pool (creates the mint) | `4HjnsDC6UihZG4zDo4kEMdbvBTBwg3S9xY7aq68dgcxy5sVV4JeJUSsowUK6ttPVmE8m5rLJZsA7fedi2AXe1EVB` |
| buy with 1500 quote | `4rhkGobvuaoW9ua7xZyB1RQTyhr4bfDj4mkfyBTK7wxzRjbmkGyVX1hEkdez9ts9Eb6rug4kFKZQmHwBLAj7ayCb` |
| settlement initialize (genesis, GENESIS_MINT mode) | `` |
| set_signer to the beta box's key (2026-10-09, `scripts/set-signer.ts`) | `5MNz6A4bUByxey2KqLrTdii2yYJSvg6SrZgecqtVr8jH65jfAinwdb8Y2rAGPzrvRjhr5L76tsHTmRLxzwLda6ER` |

Server env for the box: `OUTFOX_PROGRAM_ID=574eotmx4QLJ1F3eNjBDXa1tECFs2kXRpbYEEmP8U98y`, `OUTFOX_ADMIN=DDpPhoRNLF2hpb7xiuCRiEPaKa7qimfsMYi1ZmHYaoLf`,
`OUTFOX_LAUNCH_POOL=HhMKSRKXQCRB9jkQdd2PVhTse8a5to5M8h6mdHmFy4XW`, `OUTFOX_CHAIN_ID=1`, the hot seed. The 2026-08-28 deployment (`devnet.md`)
stays as the dev environment on the old program id and the treasury-minted mint.
