# todo-mvp — everything between here and MVP

Non-normative synthesis (canon wins — `wiki/CLAUDE.md`). Sources: `deploy/README.md`,
`docs/SOLANA-FEASIBILITY.md` §5–6, `wiki/state.md` open queues, repo `CLAUDE.md`
security posture, `docs/VALIDATION-BENCHMARKS.md` §4.

**MVP here means the first public beta**: real players on `outfox.game` playing the
full loop — Calls, Gigs, sinks, Open Market, the Clearinghouse money loop — against
**devnet economics** on the one-box deploy (`deploy/README.md`). Real-money mainnet is
a separate, later launch behind hard gates (counsel + external audit); it is listed at
the bottom so beta is never mistaken for launch.

Everything needed for MVP is small. The build itself is done: the Phase-1 slice is
playable, the chain edge is live on devnet and verified end-to-end
(`programs/deployments/devnet.md`), suite 115/115, FTUE exists, art is wired.
What remains is one engineering round, an ops run, and owner unlocks.

## Tier 0 — engineering blockers (the one remaining build round)

- [ ] **1. Rate limiting** (`deploy/README.md` gap #1 — the only open code blocker).
      Per-IP limits (`@fastify/rate-limit`) on `/api/register/siws/nonce`,
      `/api/register/*`, `/api/wallet/*`, `/api/session/bootstrap` — bootstrap mints
      player rows and the nonce endpoint mints DB entries, so an unthrottled IP can
      grow the ledger unboundedly. Touches the server → **adversarial review round**
      per the security posture (repo `CLAUDE.md`), regression tests included.
- [ ] **2. Log retention decision** (gap #3). Fastify logs at warn to journald;
      decide retention (journald cap or forwarding) and write it into the runbook.
- [x] ~~Health endpoint~~ — DONE 2026-08-29 (`/healthz`: DB touch + indexer age;
      alert rule non-200 or `indexerAgeMs` > 60000).

## Tier 1 — deploy the box (owner + ops, `deploy/README.md` steps)

- [ ] **3. Domain** — buy `outfox.game` (~$30/yr, checked available 2026-08-28),
      DNS A/AAAA to the box.
- [ ] **4. VPS + install** — create `outfox` user, rsync, `npm ci --include=dev`,
      web build, systemd unit, Caddy. Generate a **fresh production hot signer seed
      on-box** (never reuse the dev-box devnet seed once real players exist).
- [ ] **5. Backups live + one verified restore** — SQLite online backup every 6h +
      before every deploy, 28 copies, off-box daily; open a copy and query it once.
- [ ] **6. Uptime monitor** on `/healthz` with the alert rule above.
- [ ] **7. Hardening checklist green** (`deploy/README.md`): dev env flags unset
      (verify via `systemctl show`), env file 0640 root:outfox, firewall 80/443/ssh
      only, `Secure` cookie in the smoke test.
- [ ] **8. Deliberate exchange-pool seeding** — the pool stays unseeded until this
      is an explicit operator step.

## Tier 2 — launch materials + distribution (Phase C remainder, SOLANA-FEASIBILITY §6 step 6)

- [ ] **9. Announcement copy** + start the founder-account CT receipts channel
      (channel stack per the internal distribution plan).
- [ ] **10. Superteam Indonesia instagrant** — nudge ~Sep 2 if still silent
      (owner decision 2026-08-28: publish regardless of grant outcome).
- [ ] **11. Colosseum hackathon entry** — window Sep 28 – Nov 2; event-driven,
      prepare the entry from the announcement materials.
- [ ] **12. TWA APK (bubblewrap) + assetlinks** in `/srv/outfox/well-known/` →
      Solana dApp Store listing (`deploy/README.md` gap #4). Can trail day-0 beta;
      required for the dApp Store channel.

## Tier 3 — polish, explicitly non-blocking for MVP

- [ ] **13. Sub-8-KB layered SVG fox** (mascot derivation from `mascot.webp`;
      canon requires SVG in-app — base of the jacket cosmetic line).
- [ ] **14. Retention stack** (historical checklist #9 / inherited condition 5
      re-baseline) — build once there are real players to retain.

## Owner decisions that must land before or during beta (`wiki/state.md`)

- [ ] **R3 PoP provider final call** — Sumsub primary per owner data 2026-08-28,
      Didit cost fallback; couples with counsel (if counsel forces KYC at cash-out,
      the KYC vendor IS the PoP).
- [ ] **Counsel engagement** — THE hard gate for anything real-money; sharpest
      question: does cash-out make us a VASP → KYC mandatory anyway?
- [ ] **POL depth at launch** (≥$25K floor recommended; venue decided: Meteora
      DAMM v2, permanent lock at creation).
- [ ] **Production `op_take_f3` / `op_take_wdfee` rates** (proven intervals in
      AUDIT-2 §8/§8b).
- [ ] **On-ramp rail** (couple with the geofence decision — `ONRAMP-COVERAGE.md`).
- [ ] **Grant-money boundary confirmation.**

## Hard pre-mainnet gates — NOT part of MVP, never skipped

Beta runs on devnet economics precisely so these can come after MVP:

1. **Legal Phase-0 counsel review** (`VALIDATION-BENCHMARKS.md` §4, repo
   `CLAUDE.md` — hard launch gate).
2. **Third-party smart-contract + economic audit** (security posture — in-house
   hardening is not a substitute).
3. **Mainnet deploy behind the launch gates** with key hygiene: fresh keys per
   environment, hot/cold split (voucher signer ≠ admin), multisig admin.
4. **Real-money on-ramp (F3) rail verified** (USDC-first; day-0 = wallet
   built-in ramps).

## Parked queues that do not block MVP (`wiki/state.md`)

- **Sim (AUDIT-2):** split-hoard whale_market variant · round-7 external
  open-market scenario · burst-exit mule variant · basket CPI · demurrage-precedent
  sweep · cadCAD port (M3).
- **Engineering:** §13.B treasury-op job (TWAP legs) · staking + unbonding ·
  PostgreSQL migration (one-box SQLite is the deliberate beta shape).

as-of: 17b0f8d (2026-08-30)
