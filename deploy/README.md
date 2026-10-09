# Beta deploy — one box, devnet economics

The slice architecture is deliberately one-box: Caddy (TLS + static PWA + /api
proxy) in front of the Node server on loopback, SQLite as the ledger. This
directory holds the production artifacts; nothing here runs in dev.

## Environments (decision 2026-08-31)

Two environments, two boxes, never shared and never co-hosted with unrelated
services:

| Env | Box | Chain | DB | Domain |
|---|---|---|---|---|
| **dev+beta** | Vultr `outfox-beta`, sgp, 1 vCPU / 1 GB (2.4 GB swap from the image), Debian 13, Node 24 (NodeSource) | devnet | SQLite | `outfoxgame.com`, live 2026-10-09 |
| **production** | separate, larger box (2 GB+) | mainnet — exists only after the audit + counsel gates | PostgreSQL (migration queued) | `outfox.game` (whether beta takes the apex first is an open owner call) |

Rules:

- The web bundle is built locally and rsynced; the 1 GB box never builds.
- Fresh keys per environment (prerequisite 3 below); nothing from the dev+beta
  box is ever reused on production.
- Public beta surfaces (dApp Store TWA, shared links) start only once the real
  domain exists; the dev instance may run on the box before that.

## Prerequisites (owner)

1. **Domain** — `outfoxgame.com` (bought 2026-10-09 on the owner's Cloudflare account;
   `.game` turned out to be about $300/yr, deferred). DNS A/AAAA → the box, unproxied.
2. **A VPS** — any small instance; the server is a single Node process and SQLite.
3. The devnet deployment already live (`programs/deployments/devnet.md`) and a
   **production hot signer seed** — generate FRESH for this box (never reuse the
   dev-box devnet seed once real players exist; rotate via the program's
   `set_signer` if needed).

## Steps

```sh
# on the box (as root)
useradd -r -s /usr/sbin/nologin outfox
mkdir -p /srv/outfox/app /srv/outfox/dist /srv/outfox/well-known /etc/outfox
# on the dev machine: npm run build --workspace apps/web   (the box never builds)
# rsync the repo to /srv/outfox/app and apps/web/dist/* to /srv/outfox/dist, then in the app dir:
#   npm ci --omit=dev               # runtime only: tsx is a dependency; the dev tree
#                                   # (build and test tools, the Meteora SDK for
#                                   # scripts/launch.ts) never lands on the box that
#                                   # holds the voucher key
cp deploy/production.env.example /etc/outfox/server.env   # fill in, then:
chown root:outfox /etc/outfox/server.env && chmod 0640 /etc/outfox/server.env
cp deploy/outfox-server.service /etc/systemd/system/
systemctl enable --now outfox-server
# Caddy: install distro package, drop deploy/Caddyfile into /etc/caddy/, reload
```

Smoke test: `curl -s https://outfoxgame.com/api/session/bootstrap -X POST` returns a
player JSON and sets a `Secure` cookie (NODE_ENV=production gates the flag);
`[indexer] watching program …` appears in `journalctl -u outfox-server`.

## Backups (the ledger is the game)

SQLite online backup every 6h + before every deploy:

```sh
sqlite3 /var/lib/outfox/outfox.sqlite ".backup /var/lib/outfox/backup/outfox-$(date +%%Y%%m%%d%%H%%M).sqlite"
```

(cron or a systemd timer; keep 28 copies; copy off-box daily. Never `cp` the live
file — WAL makes that a torn read.)

## Hardening checklist (pre-beta)

- [ ] `OUTFOX_DEV_AUTH`, `OUTFOX_DEBUG`, `OUTFOX_DEV_SEED_EXCHANGE` all unset —
      (a dev-seeded exchange pool is $ALPHA nobody deposited; the public economy page
      then shows proof of reserves as broken, correctly; production seeding goes through
      `poolSeedFromDeposit` after a real treasury deposit)
      verify with `systemctl show outfox-server -p Environment` after start.
- [ ] `OUTFOX_ADMIN` is the settlement's current admin and `OUTFOX_PROGRAM_ID` the beta
      program (`programs/deployments/devnet-beta.md`); the server refuses to start
      without `OUTFOX_ADMIN` when it holds the signer key, and refuses every chain path
      when the state on chain names another admin or signer.
- [ ] `NODE_ENV=production` exactly — it gates the `Secure` cookie AND the listen
      guard (`NODE_ENV=test` starts the process without ever binding: healthy-looking
      unit, 502 from Caddy).
- [ ] Env file 0640 root:outfox; signer seed generated on-box, nowhere else.
- [ ] Server listens 127.0.0.1 only (it does by code); firewall allows 80/443/ssh
      only.
- [ ] Cookie shows `Secure` in the smoke test.
- [ ] `OUTFOX_TRUST_PROXY=1` set (behind Caddy only) — verify a burst of 31
      unauthenticated bootstraps from one client returns 429, and that two
      different clients get separate budgets.
- [ ] Backups verified restorable once (open the copy, run a query).
- [ ] Exchange pool NOT seeded until the operator seeding step is deliberate.

## Known gaps — engineering items BEFORE public beta (review-gated round)

1. **Rate limiting**: DONE (adversarially reviewed 2026-08-31) — per-IP limits via
   `@fastify/rate-limit` (route-scoped, nothing global): `/api/session/bootstrap`
   30/min; `/api/register/*`, `/api/wallet/*`, `/api/verify/dev`, and the chain-edge
   routes (`/api/withdraw/*`, `/api/deposit/prepare` — each fires an outbound RPC
   call) 10/min **per route** (independent counters; the surface as a whole allows
   n_routes × 10/min — the hard brute-force bounds stay engine-side). 429s return
   the client error shape (`code: rate_limited`) with `retry-after`; `/healthz`
   stays unlimited. The public `GET /api/launch` and `GET /api/economy` are 60/min
   each and compute at most once per 30 s (added 2026-10-02). Keying uses `X-Forwarded-For` ONLY when `OUTFOX_TRUST_PROXY=1`,
   and trust is a HOP COUNT of 1 (the Caddy hop), never boolean-all — Caddy appends
   to client-supplied XFF, so trusting every hop would let clients pick their own
   bucket (the review's headline finding; fixed + regression-pinned).
   Regressions: `test/rate-limit.test.ts` (route table, spoof-in-direct-mode),
   `test/rate-limit-proxy.test.ts` (forged-XFF-behind-Caddy, fails on `true`).
   Client backoff: DONE — a failed bootstrap halts the tape but retries with capped
   exponential backoff (a 429's `retry-after` wins when longer) and the browser's
   online event short-circuits the wait. Remaining tuning item for beta: the 30/min
   bootstrap ceiling can pinch CGNAT/office NATs — revisit with real traffic.
2. **Health endpoint**: DONE — `GET /healthz` (unauthenticated, proxied by the
   Caddyfile) returns `{ ok, chain, indexerAgeMs }`: a DB touch (500 if the ledger
   is unreachable) + ms since the last successful indexer pass (null = chain off
   or no pass yet). Point the uptime monitor at it and alert on non-200 or
   `indexerAgeMs` > 60000.
3. **Log target**: Fastify logs at warn to stdout/journal — decide retention.
4. **TWA assetlinks**: generated with the APK (bubblewrap) → place in
   `/srv/outfox/well-known/` — required for the Solana dApp Store listing.
