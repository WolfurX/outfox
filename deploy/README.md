# Beta deploy — one box, devnet economics

The slice architecture is deliberately one-box: Caddy (TLS + static PWA + /api
proxy) in front of the Node server on loopback, SQLite as the ledger. This
directory holds the production artifacts; nothing here runs in dev.

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
2. **Health endpoint**: nothing unauthenticated returns 200; add `/healthz`
   (DB touch + indexer age) for uptime monitoring.
3. **Log target**: Fastify logs at warn to stdout/journal — decide retention.
4. **TWA assetlinks**: generated with the APK (bubblewrap) → place in
   `/srv/outfox/well-known/` — required for the Solana dApp Store listing.
