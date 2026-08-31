# Beta deploy — one box, devnet economics

The slice architecture is deliberately one-box: Caddy (TLS + static PWA + /api
proxy) in front of the Node server on loopback, SQLite as the ledger. This
directory holds the production artifacts; nothing here runs in dev.

## Environments (decision 2026-08-31)

Two environments, two boxes, never shared and never co-hosted with unrelated
services:

| Env | Box | Chain | DB | Domain |
|---|---|---|---|---|
| **dev+beta** | small VPS (1 vCPU / 1 GB, add swap) | devnet | SQLite | real domain pending (owner purchase); until then dev-only access via a temporary DNS name or SSH tunnel |
| **production** | separate, larger box (2 GB+) | mainnet — exists only after the audit + counsel gates | PostgreSQL (migration queued) | `outfox.game` (whether beta takes the apex first is an open owner call) |

Rules:

- The web bundle is built locally and rsynced; the 1 GB box never builds.
- Fresh keys per environment (prerequisite 3 below); nothing from the dev+beta
  box is ever reused on production.
- Public beta surfaces (dApp Store TWA, shared links) start only once the real
  domain exists; the dev instance may run on the box before that.

## Prerequisites (owner)

1. **Domain** — `outfox.game` (checked available 2026-08-28; ~$30/yr). DNS A/AAAA
   → the box.
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
# rsync the repo to /srv/outfox/app, then in it:
#   npm ci --include=dev            # tsx is a devDep; don't let NODE_ENV omit it
#   npm run build --workspace apps/web
# copy apps/web/dist/* to /srv/outfox/dist
cp deploy/production.env.example /etc/outfox/server.env   # fill in, then:
chown root:outfox /etc/outfox/server.env && chmod 0640 /etc/outfox/server.env
cp deploy/outfox-server.service /etc/systemd/system/
systemctl enable --now outfox-server
# Caddy: install distro package, drop deploy/Caddyfile into /etc/caddy/, reload
```

Smoke test: `curl -s https://outfox.game/api/session/bootstrap -X POST` returns a
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
      verify with `systemctl show outfox-server -p Environment` after start.
- [ ] Env file 0640 root:outfox; signer seed generated on-box, nowhere else.
- [ ] Server listens 127.0.0.1 only (it does by code); firewall allows 80/443/ssh
      only.
- [ ] Cookie shows `Secure` in the smoke test.
- [ ] Backups verified restorable once (open the copy, run a query).
- [ ] Exchange pool NOT seeded until the operator seeding step is deliberate.

## Known gaps — engineering items BEFORE public beta (review-gated round)

1. **Rate limiting**: none exists. `/api/register/siws/nonce`, `/api/register/*`,
   `/api/wallet/*`, and `/api/session/bootstrap` need per-IP limits
   (`@fastify/rate-limit`) — bootstrap mints rows, nonce endpoints mint DB
   entries. Touches the server → adversarial review per the security posture.
2. **Health endpoint**: DONE — `GET /healthz` (unauthenticated, proxied by the
   Caddyfile) returns `{ ok, chain, indexerAgeMs }`: a DB touch (500 if the ledger
   is unreachable) + ms since the last successful indexer pass (null = chain off
   or no pass yet). Point the uptime monitor at it and alert on non-200 or
   `indexerAgeMs` > 60000.
3. **Log target**: Fastify logs at warn to stdout/journal — decide retention.
4. **TWA assetlinks**: generated with the APK (bubblewrap) → place in
   `/srv/outfox/well-known/` — required for the Solana dApp Store listing.
