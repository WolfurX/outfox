# Outfox

Outfox is an economy-first multiplayer trading game on Solana, built as a web PWA.
Players trade, work, and take chance-based Calls on a living market. Guest play
starts in the browser in under ten seconds with no wallet and no signup; a Solana
wallet enters the picture only when a player wants to keep what they earned.

The unusual part is the order of construction: the player economy was validated by
a Monte Carlo simulation campaign (500-seed scorecards and adversarial red-team
rounds, all committed under `sim/`) before any of the code that moves money was
written. Economy rules win all conflicts; `docs/ECONOMY.md` is the canon.

Two commitments separate this from the GameFi that burned players before:

1. Chance winnings can never be cashed out. A strict provenance firewall separates
   play money (Scrip) from settled value ($ALPHA), enforced in the ledger itself.
2. Every economic parameter is published. Fees, caps, vesting, and reserves are
   auditable rules in the whitepaper and this repository, not house policy.

## The chain edge

Live on devnet and verified end to end (`programs/deployments/devnet.md`):

- $ALPHA is an SPL mint with a fixed supply of 2,000,000. Genesis is one atomic
  transaction (`scripts/genesis.ts`) that mints the supply, revokes the mint
  authority, and initializes the settlement state, so the no-mint guarantee holds
  from the first block.
- The Settlement program (Anchor) holds deposits in PDA escrow and releases funds
  only against server-signed ed25519 vouchers: single-use nonce, expiry, a global
  rolling withdrawal cap, and a pause switch.
- The devnet run covers the full deposit-to-redeem path plus the failure cases:
  forged vouchers rejected, replays rejected, pause honored, and a
  proof-of-reserves audit that balances escrow against the ledger.

The server is authoritative for every economic gate and runs them before a voucher
is signed; the program enforces only what the chain must. Neither layer assumes
the other will catch a mistake.

## Status

The playable slice (Calls, Gigs, sinks, the Open Market, guest-to-wallet identity
ladder) runs today, and the chain edge is verified on devnet. Mainnet is
deliberately gated behind an external audit of the settlement program and legal
review. No real money is live.

## Repository layout

- `apps/server`: TypeScript game server (Fastify + SQLite). Server-authoritative:
  the client is a renderer, every outcome and balance decision happens here.
- `apps/web`: the PWA client, including a direct Wallet Standard integration.
- `programs/`: Anchor programs, LiteSVM tests, deployment records.
- `sim/`: the economy gate. Simulation model, committed scorecards, red-team
  records. No economy code ships until it passes at full seeds.
- `docs/`: design canon. Start with `ECONOMY.md` and `GDD.md`.
- `whitepaper/`: source of the published whitepaper.
- `deploy/`: one-box beta artifacts (Caddyfile, systemd unit, runbook).

## Running it

```sh
npm ci
npm test           # server suite
npm run dev:server # game server on :8787
npm run dev:web    # client on :5173
```

The slice runs standalone with the chain edge off; set `OUTFOX_RPC_URL`,
`OUTFOX_CHAIN_ID`, and `OUTFOX_PROGRAM_ID` to connect it to the deployed devnet
program. Building `programs/` needs Rust and Anchor; the apps need only Node.

## Reading further

The whitepaper carries the full economy design, the published parameters, and the
honest built-versus-designed status of each part:
https://outfox.gitbook.io/whitepaper/

## License

Business Source License 1.1 (`LICENSE`). Read, modify, and use the code freely
for anything non-production; production or commercial use needs a license from
the Licensor until the Change Date (2030-01-01), when the work converts to MIT.
