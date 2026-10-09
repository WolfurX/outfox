# Outfox infrastructure

> **Status:** adopted 2026-09-12 as the environments and operations chapter of
> `ARCHITECTURE.md`. `deploy/README.md` stays the step-by-step runbook for the one-box
> beta and holds the hardening checklist; this doc says what exists, what is missing
> before public beta, and how each environment is run. Nothing here changes the
> two-environment decision of 2026-08-31.

## 1. Environments

| Env | Where | Chain | Ledger | Domain | Keys | Who reaches it |
|---|---|---|---|---|---|---|
| local | developer machine | off, or devnet by env | SQLite in `apps/server/` | `localhost:5173` (Vite) proxying `:8787` | throwaway devnet keys in `~/.config/outfox/devnet/` | the developer |
| dev+beta | one small VPS (1 vCPU, 1 GB, swap) | devnet, chain id 1 | SQLite at `/var/lib/outfox/outfox.sqlite` | `outfoxgame.com`, live 2026-10-09 (Vultr sgp box `outfox-beta`) | fresh hot signer generated on the box; admin key stays cold | closed beta players, the operator |
| production | a separate larger box (2 GB+) | mainnet, chain id 2, only after the audit and counsel gates | Postgres | `outfox.game` (apex versus subdomain for beta is an open owner call) | fresh keys; admin = multisig; signer never reused from beta | the public |

Rules: the two boxes never share anything and never co-host unrelated services; the web
bundle is built locally and rsynced (the 1 GB box never builds); public beta surfaces
(dApp Store TWA, shared links) start only once the real domain exists.

## 2. Topology

Beta and production have the same shape; production swaps the ledger and adds a worker.

```
internet ──443──▶ Caddy ──▶ /srv/outfox/dist (static PWA, SPA fallback)
                    │
                    ├─ /api/*, /healthz ──▶ 127.0.0.1:8787  outfox-server.service
                    │                          │  (Node, tsx, User=outfox)
                    │                          ├─ SQLite WAL  /var/lib/outfox/
                    │                          └─ indexer → Solana RPC (outbound only)
                    └─ /.well-known/assetlinks.json (TWA, once the APK exists)

production adds:  outfox-jobs.service (indexer + metrics + treasury ops, DB lease)
                  Postgres (local unit or managed), off-box backups, an RPC provider
```

The server binds loopback only. The firewall allows 80, 443, and SSH. Outbound is RPC
and package mirrors.

## 3. Provisioning

Beta box, in order (exact commands in `deploy/README.md` §Steps):

1. System user `outfox` with no shell; directories `/srv/outfox/{app,dist,well-known}`,
   `/etc/outfox`, `/var/lib/outfox` (systemd `StateDirectory`).
2. Node 22+ (for `node:sqlite`), `npm ci --include=dev` in `/srv/outfox/app` (tsx is a
   devDependency and the unit runs it).
3. `/etc/outfox/server.env` from `deploy/production.env.example`, `root:outfox 0640`.
   `OUTFOX_SIGNER_KEY` generated on the box, never pasted from elsewhere.
4. `deploy/outfox-server.service` installed and enabled. The unit is hardened
   (`ProtectSystem=strict`, `ProtectHome`, `NoNewPrivileges`, private tmp, state dir
   read-write only).
5. Caddy from the distro package with `deploy/Caddyfile`; automatic TLS once DNS points
   at the box.
6. Register the new signer on-chain with `set_signer` from the cold admin key, from a
   machine that is not the box.
7. Smoke test per the runbook; then the hardening checklist, item by item.

Production repeats this with fresh keys and adds Postgres, the jobs unit, and the
backup target before any traffic.

## 4. Build, test, and deploy pipeline

There is no CI today (`ARCHITECTURE.md` A13). Everything below the "deploy" row is a
pre-beta item; the local commands already exist.

| Stage | Command | Gate |
|---|---|---|
| server suite | `npm test` | green |
| program tests | `cargo test` in `programs/` (LiteSVM) | green when `programs/` changed |
| types | `npm run build -w apps/web` (runs `tsc --noEmit`) | green |
| vocabulary | part of `npm test` (`vocab-guard.test.ts`) | retired names absent from living code |
| contrast | `node apps/web/scripts/aa-check.mjs` | matrix passes after any color change |
| bundle budget | size of `apps/web/dist` gzipped | critical path ≤ 170 KB (binding); first-load JS derived from it (about 140 KB); display font ≤ 30 KB |
| live harness | `node apps/web/scripts/verify-live.cjs` (starts its own server and a `vite preview` of the built bundle) | 19/19, zero console errors |
| secrets | the machine's pre-push scan and publish guard | no secrets, no identity leaks |
| deploy | build locally, rsync `dist/` and the app tree, `systemctl restart outfox-server` | healthz 200, cookie `Secure`, indexer heartbeat in the journal |

Target CI (GitHub Actions on push and PR): the first seven rows, plus a Lighthouse run
on the built PWA at the throttled mobile preset with the `DESIGN-SYSTEM-WEB.md` §21.1
table as thresholds.
Deploys stay manual and tagged until beta traffic justifies automating them.

Deploy rules: the previous `dist/` and app tree are kept beside the new ones so rollback
is a symlink flip and a restart. A deploy that includes a schema change runs the
pre-deploy backup first (§6) and is never rolled back past that migration without a
restore. The `/min-version` value is bumped in the same deploy that breaks a client.

## 5. Secrets and keys

| Secret | Lives | Rotation | Never |
|---|---|---|---|
| hot voucher signer seed | `/etc/outfox/server.env` on the box, `root:outfox 0640` | `set_signer` from the admin key; old key drains nothing once replaced | in the repo, in a chat, reused across environments |
| admin key | cold, off the box (a hardware wallet or an offline keypair for beta; a multisig program at mainnet) | `transfer_admin` + `accept_admin` (two steps) | on any server |
| treasury key | cold, same handling as admin | as admin | on any server |
| RPC URL with a provider token | the env file | provider dashboard | in client code |
| GitBook token (whitepaper publish) | `~/.config/gitbook/token` on the developer machine | GitBook settings | in the repo |
| session tokens | hashed at rest in `sessions` | per-device revoke (target) | logged |

The `private/` directory, `.env*`, `*.sqlite*`, and key material are gitignored; the
global pre-push hook scans every push and the publish guard scans deploys and visibility
flips. Placeholders pass with `SKIP_SECRET_SCAN=1`.

## 6. Data: backups, restore, migration

Beta (SQLite, WAL): an online backup every 6 hours and before every deploy, 28 copies
kept, one copy off-box daily. Never `cp` the live file (a torn read under WAL). Restore is
tested once before the first real player: open the copy, run a query, start a server
against it, bootstrap a session. Backup age is an alert (§7).

```sh
sqlite3 /var/lib/outfox/outfox.sqlite ".backup /var/lib/outfox/backup/outfox-$(date +%Y%m%d%H%M).sqlite"
```

Postgres (production): daily base backup plus WAL archiving to the off-box target,
point-in-time restore drilled before launch, the same schema as SQLite (portable SQL
throughout, `ARCHITECTURE.md` §7). Cutover from SQLite: pause the edge, take a final
backup, export tables in id order, import, run `conservationAudit`, `exchangeAudit`, and
`solvencyAudit` against the new ledger, unpause. Ledger events are never rewritten; a
migration that needs a backfill (like `alpha_carry_at`) records the upgrade time and is
never retroactive.

Retention: the event tables are permanent (they are the economy's record and the
dashboards' input). Access logs 30 days. Journal logs 14 days. The identity tables are
separable from the events by design so a deletion request severs the id mapping and the
events stay valid.

## 7. Observability and alerting

| Signal | Source | Alert when |
|---|---|---|
| liveness | `GET /healthz` from an external uptime monitor every minute | non-200 twice in a row |
| indexer age | `indexerAgeMs` in healthz | > 60,000 ms with chain on |
| solvency | `solvencyAudit` run by the metric job | escrow reserve < ledger liabilities, at any time |
| conservation | `conservationAudit`, `exchangeAudit` | any residual |
| economy bands | the metric job's G1–G12 rows | any criterion leaves its band; the alert names the pre-committed §3 response |
| rate limiting | 429 count in the Caddy access log (the server does not log them) | a sustained spike on a single route (beta tuning of the 30/min bootstrap ceiling for CGNAT) |
| errors | Fastify at `warn` to journald; Caddy JSON access log | 5xx rate above baseline |
| disk and memory | node exporter or a cron script | disk > 80%, swap thrash |
| backups | age of the newest copy on and off box | > 7 h on-box, > 26 h off-box |
| RPC | indexer error lines | consecutive failures > 5 minutes |
| certificates | Caddy renews automatically | renewal failure in the Caddy log |

Dashboards are self-hosted (a Grafana or a small static page over the `metrics` table);
no third-party analytics SaaS (`DATA-ARCHITECTURE.md` §1.4). Client instrumentation
lands in the `events` table through one batch endpoint.

## 8. Runbooks

Each runbook names the check that proves it worked.

### Deploy

Build locally (`npm run build`), rsync `apps/web/dist/` to
`/srv/outfox/dist.new` and the app tree to `/srv/outfox/app.new`; pre-deploy backup;
flip the symlinks; `systemctl restart outfox-server`; verify: healthz 200, the indexer
heartbeat within 60 s, one bootstrap returns a `Secure` cookie, `verify-live` against
the box if the change touched a surface.

### Rollback

Flip the symlinks back; restart; verify as above. If a migration ran,
restore the pre-deploy backup first (§6).

### Pause the edge

For a suspected key theft, an insolvency signal, or a bad release. From the cold admin
key, `pause`; verify the state PDA reads `paused`; deposits and redeems
now fail on-chain; the server keeps serving play. Then investigate. `unpause` only after
the cause is named and the signer is rotated if in doubt.

### Rotate the signer

Generate a fresh seed on the box; `set_signer` from the admin key;
update `OUTFOX_SIGNER_KEY`; restart; verify with a devnet redeem or, on mainnet, a
minimum-amount withdrawal by the operator's own R3 account. Vouchers signed by the old
key that are already on-chain are unaffected; unsubmitted ones are void, and a re-claim
re-signs the row with the new key (`prepareClaim` re-signs `signed` rows today).

### Change the window cap

`set_window_cap` from the admin key; the bucket drains at the
old rate until the change lands (exact by program design); record the change as a
`policy.*` event; verify the state PDA.

### Restore the ledger

Stop the server; move the damaged file aside; copy the chosen
backup into place; start; run the three audits from `/api/debug/*` with `OUTFOX_DEBUG`
set for that one session, or the same functions from a script; the indexer re-reads from
its stored cursor, and `chain_events` is idempotent so no deposit double-credits.

### Add the real domain

DNS A/AAAA to the box; replace the site address in the
Caddyfile; reload Caddy; HSTS only after TLS is proven stable; set `OUTFOX_ORIGIN` to the
public origin (SIWS messages bind to it) and restart.

### Scale up

Follow the trigger table in `ARCHITECTURE.md` §17; the first step is
always a bigger box, not a second one.

## 9. Scaling path

Mirrors `ARCHITECTURE.md` §17 from the operations side:

| Trigger | Ops change |
|---|---|
| p95 latency or write contention on the beta box | resize the VPS first; then the Postgres cutover (§6) |
| indexer or metric jobs delay requests | `outfox-jobs.service` on the same box with a DB lease; the API unit stops running jobs |
| public RPC rate limits | a provider endpoint in `OUTFOX_RPC_URL`; no code change |
| availability above one box | managed Postgres, two API instances behind Caddy, jobs single-instance by lease |

## 10. Cost

| Item | Beta | Production |
|---|---|---|
| VPS | one small instance (about $5–6 per month) | 2 GB+ instance; managed Postgres optional |
| domain | `outfoxgame.com`, about $11 per year (`.game` is about $300 per year, deferred) | same |
| RPC | public devnet endpoint | a provider plan once rate limits bite |
| backups | on-box plus a small object-storage bucket | same, larger |
| monitoring | free tier of an uptime monitor; self-hosted metrics | same |

Purchases wait on the owner's grant decision (parked 2026-09-11).

## 11. Open items before public beta

1. Domain and VPS purchase (owner).
2. CI on push and PR with the §4 rows and the Lighthouse budget.
3. `/min-version`, idempotency keys, step-up auth (`PRD.md` FR-PWA-3, FR-CH-6, FR-ID-7).
4. Metric jobs and the `metrics` table; dashboard; the alert list in §7 wired to a pager
   or a chat channel.
5. Backup timer and the off-box copy; one restore drill logged.
6. Log retention decided and applied (`deploy/README.md` gap #3).
7. TWA `assetlinks.json` once the APK exists (gap #4).
8. `prepareRedeemTx` compute limit lowered to about 60k and a priority-fee tip added
   before mainnet (`SOLANA-FEASIBILITY.md` §4 fee row).
9. Beta bootstrap rate ceiling revisited with real traffic (CGNAT).
10. Display font at about 40 KB against the 30 KB gate in `DESIGN-SYSTEM-WEB.md` §21.1
    (subset further or accept and amend the gate).
