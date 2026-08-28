# Design System v2 — Outfox standalone client (PWA · Robinhood Chain)

> **Status:** Phase-0 pivot-track spec — the UI/UX contract for the **standalone web client**
> that replaces the Telegram-only delivery under the Robinhood Chain pivot
> (`ROBINHOOD-FEASIBILITY.md`). Supersedes `DESIGN-SYSTEM.md` (v1) for the standalone
> client; v1 remains the archived TON/Telegram-track document. **Economy and mechanics are
> frozen** — this document changes the platform and presentation layer only.
>
> **Vocabulary:** all UI copy comes exclusively from the canonical glossary — Appendix A,
> which is `THEME-OUTFOX.md` §2 verbatim plus the coinages this document registers. The
> Outfox / $ALPHA availability checks are still pending (`THEME-OUTFOX.md` §7): token-name
> aliases (§4.4) stay in place until they clear, and no literal name strings go on-chain
> before then (`GDD.md` §2.2 rule).
>
> **Perf floor:** low-end Android (360px, throttled) remains the non-negotiable floor
> (`PLAN.md` §3). Desktop is now a first-class surface — additive, never the baseline.

---

## 0. Principles (revised)

1. **Own the platform.** v2 owns its theme, auth, payments, notifications, and install
   surface end to end. Nothing inherits from a host app; every platform capability is
   accessed through one adapter seam (§3.3). *(Supersedes v1 principles 1 and 4.)*
2. **Performance is a design constraint, not an afterthought.** Low-end Android in a plain
   mobile browser is *the* target device. Every decision is checked against the CI gates
   (§21). When beauty and frame-rate conflict, frame-rate wins. *(v1 principle 2, carried.)*
3. **Menu/stat-based, not scene-rendered.** Torn-style lists, tables, and panels — cheap to
   render, infinitely deep in content. No heavy 3D/canvas in the core loop.
   *(v1 principle 3, carried.)*
4. **The market is honest.** Money UI never lies, softens, or surprises: quotes are locked
   before commit, limits are visible before they bind, offline state never masquerades as
   live, and chance surfaces never borrow casino grammar. *(New — the standalone-money-app
   principle; sharpened by the US-broker-adjacent optics, `ROBINHOOD-FEASIBILITY.md` §4.)*
5. **Tactile.** Haptics, audio ticks, and micro-motion give a text-based game "game feel" —
   every channel disableable, none ever the sole signal. *(v1 principle 5, carried; audio
   added because iOS web has no vibration path.)*

---

## 1. App model & shell

**Outfox ships as ONE installable PWA** — a single React + Vite SPA serving every surface:
mobile browser, installed PWA, desktop browser, wallet in-app browsers. No native wrapper,
no store build, no per-surface forks. Surface differences are absorbed by the
PlatformAdapter (§3.3), never by branching component code.

### 1.1 Service worker

- **Scope `/`**, Workbox, registered after first paint (never blocks LCP).
- **Precache:** the app shell only — hashed JS/CSS chunks, manifest, icon set, the offline
  shell route. Route-level code-split chunks precache lazily post-idle.
- **Runtime caching:** static assets `stale-while-revalidate`; **API responses
  `network-only` — authenticated game state is never cached by the SW.** Navigation
  requests fall back to the app shell.
- **Update flow — two distinct paths.** *Polite:* new SW installs in the background →
  toast (“New build posted — refresh”) → on confirm, message the waiting SW to
  `skipWaiting`, listen for `controllerchange`, then reload. *Forced:* on a `/min-version`
  violation, the same skipWaiting → `controllerchange` → reload sequence runs **without**
  the confirm toast (calling `registration.update()` first if no SW is waiting yet) —
  a bare page refresh would just reload the old precached shell from the still-active old
  SW and loop forever.
- **Chunk-load failure:** a not-yet-precached route chunk can 404 after a deploy replaces
  hashed assets. On dynamic-`import()` rejection: check for a waiting SW /
  `registration.update()` → toast-and-reload (§18.3 error class). The CDN keeps N−1 build
  assets available across deploys to shrink the window.
- **Storage:** IndexedDB holds *reconstructable cache only* (last-known balances, static
  catalogs, i18n bundles). The server is authoritative for everything; eviction must never
  lose player value. Call `navigator.storage.persist()` after install.

### 1.2 Offline policy — the market halts, it does not pretend

- Offline, the shell renders in read-only **“TAPE HALTED”** mode: a persistent banner, all
  cached values stamped with staleness (§18.4 format), every economy action (Calls, Raids,
  Open Market orders, transfers, Commons donations) disabled at the component level.
- **No offline action queue. No Background Sync for gameplay. Non-negotiable.** Replaying
  queued economy actions against moved server state is an integrity exploit, not a feature.
- Reconnect: banner clears, state refetches, a light “tape resumes” motion (§8 rules apply).

---

## 2. Responsive architecture & navigation

Compact-first, always. Every screen must be complete and playable at Compact; wider
breakpoints *add* density and panels — they never gate content.

### 2.1 Breakpoints

| Token | Range | Class | Layout |
|---|---|---|---|
| `--bp-compact` | 320–767px (floor: 360) | Phones | Single column, bottom tab bar |
| `--bp-medium` | 768–1199px | Tablets, small laptops, split-screen | Nav rail + single workspace |
| `--bp-wide` | ≥1200px | Desktop — the trading floor | Nav rail + workspace + Tape Rail |

Content max-width **1440px**; beyond 1600px viewport the app letterboxes on `--c-bg`.
Viewport height uses `dvh`/`svh` (address-bar-safe); notches and home indicators use
`env(safe-area-inset-*)` — these replace v1's TMA viewport/safe-area APIs.

### 2.2 Layout grid

4px spacing scale unchanged (v1 §3). Columns: **4 (Compact) / 8 (Medium) / 12 (Wide)**,
gutter 16, outer margins 16 / 24 / 32. Panels snap to the column grid; no free-floating
widths.

### 2.3 The Wide layout — a floor, not a stretched phone

Three fixed regions, left to right:

1. **Nav rail** — 72px icon rail, expands to 240px (labels) on toggle; persists collapsed
   state.
2. **Workspace** — the routed screen. Screens with list→detail structure (The Open Market,
   The Index, Skulk rosters, Desks) render list-detail side-by-side at Wide: master list in
   4–5 columns, detail in the rest. At Compact/Medium the same routes stack.
3. **Tape Rail** — 320px, `--bp-wide` only: live tickers (The Index, $ALPHA/Scrip rate),
   active timers (Focus/Risk Appetite regen, cooldowns, Nicked/Margin Called countdowns),
   Skulk alerts, Share-Out announcements. Built entirely from existing primitives
   (`ListRow`, `MarketOrderRow`, `CountdownTimer` — one shared ticking source, §21 rule).
   The Tape Rail is presentation-only: every item it shows is also reachable in the
   workspace, so Compact loses zero information.

**Launch scope guard:** Wide launches with list-detail on The Open Market and The Index
only, Tape Rail read-only. Each additional side-by-side screen is a scoped addition, not a
default — every one is new QA surface across three breakpoints.

### 2.4 Navigation per breakpoint

One route tree, three presentations. Deep links, push-notification URLs, and quest links
resolve identically everywhere.

| Breakpoint | Primary nav | Notes |
|---|---|---|
| Compact | Bottom tab bar, 5 tabs | Thumb-zone rule from v1 §2 unchanged; sits above `env(safe-area-inset-bottom)` |
| Medium | Left nav rail (icons) | Bottom bar removed; contextual stacks unchanged |
| Wide | Left nav rail + Tape Rail | Rail expandable; `Cmd/Ctrl+K` command palette is a post-launch candidate (§20.3 reserves the binding) |

**Tab order (canonical):** **The Tape** (home/status: Focus, Risk Appetite, Scrip, $ALPHA,
Overnight Tape) · **The Street** (districts) · **Market** (The Open Market; “Market” is
the registered tab-label short form, Appendix A) · **Skulk** (§16 screen spec) ·
**Ledger** (§12).

**The Street (screen spec):** a district panel list — one `Card`/`ListRow` per district
(The Floor, Options Alley, The Pit, The Dark Pool, The Vault, After Hours, The Hollow)
showing the district's state and entry points. It is **menu/stat-based, not a rendered
map** (principle 3 — no canvas, no geography; “map” is banned as a description of this
screen). Stacked list at every breakpoint; it does not join the §2.3 Wide list-detail
launch scope.

**Compact entry points for secondary screens (normative — the rail's overflow does not
exist at Compact, and no content may be gated by breakpoint):** The Index → from the
Market tab (segmented header) and Tape tickers; The Sim, Desks, Seats, the Commons → from
their districts on The Street (The Sim also from FTUE, §10.4); Settings → header icon on
The Tape; Activity Log → from the Overnight Tape and The Tape header. Every secondary
screen names its Compact entry point; “reachable only via the rail” is a defect.

> Naming notes (registered in Appendix A): the home tab is **The Tape**, not “The Floor” —
> The Floor is a district of The Street and district names are frozen fiction; one name
> never has two referents. The wallet tab is **Ledger**, never “Wallet” — wallet jargon is
> banned at R0/R1 (§10.1).

### 2.5 Settings information architecture

Settings is one screen (stack under The Tape's header icon at Compact; rail overflow at
Medium/Wide) with six groups — every Settings entry named anywhere in this document lives
in exactly one of them, and the §17.2 scheduler's silent-degradation targets resolve here:

| Group | Contents |
|---|---|
| **Account** | Rung status; email (change = step-up, §10.2); active sessions with per-device revoke (§10.3); linked wallets + designated withdrawal destination (§10.2, R2) |
| **Notifications** | Enable/permission entry (scheduler-exempt, §17.2); channel toggles with connection state + connect CTAs (Push / Email / Discord); per-category × per-channel matrix (rows = the §14.3 event categories); Quiet hours window + the two exemption toggles; frequency footnote (“max 5/day”). Phase-1 granularity is category-level, not per-event |
| **Feedback** | The §9.2 four rows (Sound cues · Ambience · Vibration · Animations) |
| **Appearance** | Theme cycle System → Dark → Light (§4.6) |
| **Your Recruits** | The §15 referral surface |
| **About & rules** | Add to home screen (§17.3, always-available entry); Clearinghouse Rules (§13); support entry (error codes, §18.3); legal/licenses |

---

## 3. Distribution surfaces & the PlatformAdapter

### 3.1 Surface classes

The shell must render correctly inside four surface classes; each is a PlatformAdapter
profile over the same bundle.

| Surface | Viewport | Storage | Wallet flow | Install prompt | Push |
|---|---|---|---|---|---|
| **Mobile browser** (Chrome Android = perf floor; iOS Safari) | Dynamic toolbar — `dvh`; iOS keyboard resizes visual viewport | iOS ITP may evict after 7 days pre-install — sessions must survive storage loss (state is server-side; re-auth per §10.2) | WalletConnect deep link; injected if present | Android: custom prompt (§17); iOS: instructional sheet | Android: yes; iOS: install-gated |
| **Installed PWA** | `display: standalone`; `env(safe-area-inset-*)` mandatory | `storage.persist()` granted-by-default post-install | Same as mobile; deep-link returns re-enter the standalone context | n/a | Full (incl. iOS 16.4+) |
| **Desktop browser** | Resizable — all three breakpoints in one session; test live resize | Stable | Injected extension first; WalletConnect QR fallback | Custom prompt after value moment | Yes |
| **Wallet in-app browsers** (MetaMask Mobile, Robinhood Wallet, Bitget) | Mobile-class; nonstandard chrome; assume no `beforeinstallprompt` | Treat as ephemeral — never rely on persistence | **Injected EIP-1193 provider — zero-friction path; use it.** No `window.open` | Suppressed | Suppressed |

Wallet-browser sessions are ephemeral. R1: re-established silently via refresh token if it
survived, else silent Privy re-auth; R2 step-up uses injected-provider SIWE only (§10.2).
**R0 has no recovery on this surface by definition** (an anonymous device-bound account on
ephemeral storage) — wallet-browser guests are re-minted routinely, so the `UpgradeBanner`
fires at a lower threshold here (§10.1) and `iam_guest_created` is expected to over-count
on this surface. *(No per-visit SIWE ceremony — the identity ladder governs; see §10.)*

### 3.2 Popup policy & framing

**Popup rule (hard):** no auth, payment, or signing flow may *depend* on `window.open`.
Popups (Privy OAuth, wallet flows) are permitted when opened synchronously in the tap's
event handler; if blocked, the flow falls back to full-page redirect automatically — no
“please enable popups” dead end. In wallet in-app browsers and installed iOS PWAs the popup
attempt is skipped and redirect is the default.

**Framing forbidden:** `Content-Security-Policy: frame-ancestors 'none'`
(+ `X-Frame-Options: DENY`). Inside a cross-origin iframe, storage partitioning breaks
sessions — and injected providers **do** reach iframes (MetaMask injects with
`all_frames: true`), which makes framed signing a live clickjacking vector for an app
holding cashable $ALPHA. Both facts argue the same way: never framed. Quest platforms
(Galxe, Layer3) link out to the canonical URL with a tracked `?src=` param; completion is
verified via on-chain events or the server-side verification API, never by playing inside
an iframe.

### 3.3 PlatformAdapter

One interface, resolved once at boot, injected via context:

```
PlatformAdapter {
  auth        // connect variant: injected | walletconnect | embedded (Privy)
  theme       // owned token set (§4); no host theme params
  haptics     // Vibration API (Android) | no-op (iOS web, desktop)  — transport for §9
  safeArea    // env(safe-area-inset-*) readings
  share       // Web Share API | clipboard fallback
  storage     // persistence class: durable | ephemeral
  install     // beforeinstallprompt capture | ios-instructions | suppressed
}
```

Shipped profiles: `web-mobile`, `web-desktop`, `pwa-standalone`, `wallet-browser`.
Parked: `telegram` (§3.4). **No code outside the adapter layer may import a platform SDK**
— this rule is what keeps parked options cheap.

### 3.4 Telegram — dropped as a surface, retained as a seam

**Telegram is not a shipped surface for the v2 launch.** The GDD §10.4 seam is retained as
the PlatformAdapter interface; a TelegramAdapter may return post-launch as a distribution
experiment, subject to a fresh policy review.

Rationale (recorded): the pivot removes Telegram's payment rail, and Telegram policy
requires Stars for digital-goods sales inside Mini Apps — a TMA selling $ALPHA convenience
over external crypto rails would re-import the platform-takedown risk this pivot exists to
escape. With `initData` auth also replaced, a TMA adapter buys distribution only, at the
cost of doubling the pre-launch test matrix.

---

## 4. Theme & token architecture

We own the theme end to end. This section replaces v1 §1 (Telegram theme-param mapping).

> **Visual layer → Claude Design (owner decision, 2026-07-11).** The palette, type scale,
> spacing, component look, and screen composition are produced in **Claude Design**; the
> brief handed to it is `CLAUDE-DESIGN-BRIEF.md`. **This document keeps owning the rules**
> — the vocabulary and gambling-vocabulary bans (Appendix A), the ≤320 ms constant-duration
> reveal (§8.2), the no-pressure-near-money rule (§13), the wallet-jargon ban at R0/R1
> (§10.1), the no-emoji / inline-SVG-marks rule (§6), the perf budget (§21), and the
> accessibility matrix (§4.5). Claude Design output that conflicts with those is reconciled
> back to them. The hex values below stand until that pass lands, and whatever replaces
> them must re-verify §4.5 and may not regress it.

### 4.1 Token layers

Three layers; reference direction strictly downward; no layer skips.

| Layer | Prefix / form | Who may reference it | Contents |
|---|---|---|---|
| **Base** | raw hex, private to the two theme blocks | semantic layer only | The dark and light palettes. Never appears in a component, utility class, or inline style. |
| **Semantic** | `--c-*`, `--space-*`, `--radius-*`, `--font-*` | components, utilities | The stable API. Names carried from v1 plus the brand-semantic set (§4.4). |
| **Component** | `--btn-*`, `--bar-*` (optional) | one component each | Aliases of semantic tokens only; never introduces a raw value. |

Rules (v1 §1 contract, source swapped):
- Components never see raw values. Hex appears in exactly one file: `tokens.css`.
- Tokens are plain CSS custom properties in `:root[data-theme="dark"]` and
  `:root[data-theme="light"]`. No runtime theming JS; a theme switch is one attribute write.
- Every semantic color token must appear in the contrast matrix (§4.5) for **both** themes
  before it ships. A token without both variants + verified contrast is a review blocker.
- `color-scheme: dark` / `light` declared per block (native form controls, scrollbars).

### 4.2 Dark theme — canonical (“the Floor at night”)

Neon terminal-noir per `THEME-OUTFOX.md` §6. Base surfaces carried **verbatim** from v1's
fallback column — v1's fallbacks were always the real brand; they are now primary.

> **All hex values in §4.2–§4.4 are calibration values, not final brand.** They are
> AA-verified starting points; the brand pass (`THEME-OUTFOX.md` §7 open item) may adjust
> hues but must re-verify the §4.5 matrix and may not regress it. **Schedule the brand pass
> before component styling hardens** (Appendix C).

| Token | Value | Usage |
|---|---|---|
| `--c-bg` | `#0B0E14` | App background — the terminal base |
| `--c-bg-secondary` | `#11151F` | Cards, list rows, grouped sections |
| `--c-bg-section` | `#161B26` | Section containers / panels |
| `--c-border` | `#232A3A` | Hairlines, dividers, elevation-by-border (v1 §3 rule) |
| `--c-text` | `#E6EAF2` | Primary text |
| `--c-text-hint` | `#8A93A8` | Secondary/hint text (lifted from v1 `#7A8499` for AA headroom) |
| `--c-section-header` | `#8A93A8` | Section header labels |
| `--c-link` | `var(--c-accent)` | Links |
| `--c-accent` | `#FF8A3D` | **Fox orange** — primary actions, brand accent |
| `--c-accent-text` | `#1A0D02` | Text/icons on accent fills (8.1:1) |
| `--c-destructive` | `#FF5C5C` | Destructive actions (aliases `--c-danger`) |
| `--c-header-bg` | `var(--c-bg)` | App chrome |

**Neon treatment:** glow accents (subtle `box-shadow` in the accent/brand-semantic hue at
low alpha) are permitted in dark theme only, on at most: primary CTA, active tab indicator,
`RewardReveal`. Glow is decoration — stripped by the animation-disable/low-end path, absent
in light theme.

### 4.3 Light theme — “daylight session”

Flat (no glow), white-card, same geometry. Exists because a standalone PWA inherits
nothing: outdoor readability and `prefers-color-scheme: light` are now ours to serve.

| Token | Value |
|---|---|
| `--c-bg` | `#F6F7F9` |
| `--c-bg-secondary` | `#FFFFFF` |
| `--c-bg-section` | `#EDF0F4` |
| `--c-border` | `#D7DDE7` |
| `--c-text` | `#171C26` |
| `--c-text-hint` / `--c-section-header` | `#545E72` |
| `--c-link` | `var(--c-accent)` |
| `--c-accent` | `#B34A0F` |
| `--c-accent-text` | `#FFFFFF` (5.4:1) |
| `--c-destructive` | `#C42B2B` |
| `--c-header-bg` | `var(--c-bg)` |

### 4.4 Brand-semantic tokens (Outfox vocabulary)

Fixed-meaning tokens, one value per theme, used sparingly so they read on any surface.
Renames v1's set; **v1 names ship as deprecated aliases** until the Outfox/$ALPHA
availability checks clear — the alias layer is the rename blast-radius containment.

| Token (v1 alias) | Meaning | Dark | Light | Notes |
|---|---|---|---|---|
| `--c-scrip` (`--c-credits`) | Scrip amounts, `BalancePill` | `#3DDC97` | `#0B7A54` | Inherits v1's mint — “money green” |
| `--c-alpha` (`--c-token`) | $ALPHA amounts, premium tier | `#B48CFF` | `#6B3FC9` | Violet = premium register; keeps amber free for warning |
| `--c-focus` (`--c-compute`) | Focus bar + regen | `#4CC3FF` | `#0A6EA8` | |
| `--c-risk` (`--c-nerve`) | Risk Appetite bar | `#FF5CA8` | `#B01E66` | |
| `--c-heat` / `--c-danger` | Sheriff heat, Nicked / Margin Called, errors | `#FF5C5C` | `#C42B2B` | `--c-heat` aliases `--c-danger` |
| `--c-success` | Positive feedback, fills, Raid success | `#2FD98A` | `#0E7A4E` | Green-family proximity to Scrip is deliberate; disambiguation is always icon/label (§20) |
| `--c-warning` | Low Focus/Risk, risky Call, pending states | `#FFC24B` | `#8A5A00` | |

### 4.5 Contrast matrix (CI-checked)

Requirement: every text-capable token ≥ **4.5:1** (WCAG AA) against **all three** surface
levels of its theme; on-fill pairs ≥ 4.5:1; non-text UI (borders, bar fills ≥3px) ≥ 3:1.
Current calibration values (script-verified; worst dark pair 5.6:1 — hint on section;
worst light pairs cluster at the AA line on the light section surface: **Scrip green
4.68:1, success green 4.70:1, fox orange 4.71:1** — all three have thin headroom, and a
brighter brand pass on any of them forces a two-tone strategy, see Appendix C #6).

The contrast script lives beside `tokens.css` and runs in CI: any token change that drops a
pair below threshold fails the build (§21).

### 4.6 Theme switching

- **Default:** follow `prefers-color-scheme`. **Override:** Settings cycle
  System → Dark → Light, persisted as `localStorage["outfox.theme"]`.
- **No-FOUC:** a ≤400-byte inline `<script>` in `<head>`, before any stylesheet, reads the
  key, resolves `"system"` via `matchMedia`, sets `data-theme` on `<html>` and updates
  `<meta name="theme-color">` (dark `#0B0E14`, light `#F6F7F9`). First paint is always in
  the correct theme.
- **Live changes:** `matchMedia` listener re-resolves only while preference is `"system"`;
  a `storage` listener syncs across tabs (desktop is real now).
- **PWA manifest:** `theme_color`/`background_color` pinned to dark (canonical); the head
  script corrects the meta tag per session.
- Theme transitions are **instant** (no cross-fade) — a global custom-property transition
  is a full-tree style/paint cost the low-end floor cannot afford.

### 4.7 Third-party theme bridge

Privy, WalletConnect modal, on-ramp widgets, and World ID all ship their own UI. Each
supports partial theme config; the build maintains **one mapping module**
(`theme-bridge.ts`): semantic tokens → each vendor's config object, both themes, updated
whenever `tokens.css` changes (checklist item in the token-change review). Visual seams at
the F3/cash-out boundary are a named polish risk (Appendix C) — the bridge is the
mitigation, not a guarantee.

---

## 5. Typography

**UI text: system stack, unchanged from v1 §3** — zero font download on the critical path.
The v1 type scale (Display 28/34 … Micro 11/14), spacing scale, and radii carry forward
untouched.

**Display/ledger face — v1 §9's open item, resolved: ADOPTED.** Exactly one web font:

| Property | Spec |
|---|---|
| Face | **Martian Mono** (variable, SIL OFL) — self-hosted, no third-party font CDN |
| File | Single variable woff2, `wght` 400–800, subset to Basic Latin + digits + `¤$%±+−` (direction and currency marks render as §6 SVG icons, never font glyphs — ¤ stays in the subset only as the plain-text fallback form) |
| Budget | **≤ 30 KB** — CI-enforced (size-limit) next to the JS gate; estimate, verify on the real build (Appendix C) |
| Loading | `font-display: swap`; **not** preloaded ahead of LCP-critical CSS; `size-adjust`/`ascent-override`/`descent-override` metric-matched to the fallback → zero CLS on swap |
| Fallback | `--font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace` |
| Exposed as | `--font-display` (titles), `--font-mono` (ledger) — components use tokens, never family names |

**Used in (exhaustive):** Display/H1 screen titles; ledger numerals in `BalancePill`,
`MarketOrderRow`, `StatBlock` (Conviction / Execution / Discipline / Edge),
`CountdownTimer`, Index tickers; badges. Monospace numerals are inherently tabular —
ledger columns never jitter. **Never:** body text, hints, buttons, inputs. If the subset
exceeds 30 KB, cut glyphs or weight range — never add a second family.

---

## 6. Iconography & the mascot

**Icons**

- **Inline SVG only.** No icon fonts, no raster icons, no `<img src=".svg">` in the core loop.
- **Delivery:** one build-generated, content-hashed sprite (`/assets/sprite.[hash].svg`)
  via `<use href>`. Icon bytes live outside the JS budget and cache immutably. Per-icon
  SVGR components only for icons with internal animation/state (counted against JS budget).
- **Grid & stroke:** 24px grid, 2px stroke, `stroke="currentColor"`, `fill="none"` — every
  icon themes through its parent's semantic token. Filled/duotone variants reserved for the
  brand-semantic glyphs (Scrip mark, $ALPHA mark, Focus/Risk pips), which may reference
  their `--c-*` token directly.
- **Style: folk-hero cut** — slightly heavier stroke, chamfered joins (woodcut/ballad-print
  flavor per `THEME-OUTFOX.md` §6), not generic feather-line icons.
- Decorative icons `aria-hidden="true"`; meaningful icons get `<title>`/label; never the
  sole carrier of state (§20).

**The fox (mascot)**

- Static optimized SVG illustrations **≤ 8 KB each**, lazy-loaded below the shell.
- **Allowed:** onboarding, `EmptyState`, `RewardReveal`, Nicked / Margin Called
  interstitials, app icon & splash. **Max one mascot instance per screen.**
- **Forbidden:** any data-dense component — `ListRow`, `MarketOrderRow`, tables,
  `ResourceBar`, headers. The fox sells the game; the tables are the game.
- Animation: `transform`/`opacity` only, §8 durations, fully suppressed by reduced-motion
  and the animation toggle. No Lottie, no sprite-sheet raster, no video.
- Design constraints (non-negotiable, `THEME-OUTFOX.md` §3/§6): must not resemble Disney's
  Robin Hood fox; no bows/arrows/tights kitsch; jacket-color variants are the Open Market
  cosmetic line and must be swappable via a single themed layer in the SVG. (Referral-
  reward jackets, §15, are a separate account-bound line — never Open Market inventory.)

---

## 7. Component inventory v2 (delta from v1 §4)

Every component renders correctly at all three breakpoints, in both themes, and under
animation-off. The consistency rule carries: names in UI copy come **only** from
Appendix A.

**Carried unchanged (v1 primitives & layout):** `Button`, `IconButton`, `TextField`,
`NumberStepper`, `Toggle`, `Tabs`, `Chip/Badge`, `Tag`, `Avatar`, `ProgressBar`,
`Skeleton`, `Spinner`, `Divider`, `Toast`, `Sheet`, `Modal`, `EmptyState`, `Screen`,
`Section`, `ListRow`, `Card`, `KeyValueRow`, `StatRow`.

**Carried with changes:**

| Component | Change |
|---|---|
| `BottomTabBar` | Compact-only (§2.4); tab set: The Tape · The Street · Market · Skulk · Ledger |
| `ResourceBar` | Re-tokened: Focus (`--c-focus`) / Risk Appetite (`--c-risk`) |
| `BalancePill` | Re-tokened: Scrip (`--c-scrip`) / $ALPHA (`--c-alpha`); Unsettled variant per §12 |
| `StatBlock` | Stats renamed: Conviction / Execution / Discipline / Edge |
| `ActionListItem` | An entry in Calls / Raids / Gigs lists: name, cost (Risk Appetite), success %, reward range, cooldown |
| `MarketOrderRow` | Unchanged mechanics; ledger numerals in `--font-mono`; P&L formatting per §19.2 |
| `CountdownTimer` | One shared ticking source app-wide — now also feeds vesting tranches, clearing-capacity reset, Tape Rail |
| `SyndicateBanner` → `SkulkBanner` | Rename only |
| `LeaderboardRow`, `OperationCard` → `DeskCard` | Rename per glossary |
| `RewardReveal` | Re-specced §8.2: single-stage, constant duration, **pays Unsettled Scrip only — the component cannot render an $ALPHA amount, by type** |
| `WalletPanel` → **`Ledger`** | Fully re-specced (§12); TON Connect state removed |

**New in v2:**

| Component | Section | Purpose |
|---|---|---|
| `NavRail` | §2 | Medium/Wide primary nav |
| `TapeRail` | §2.3 | Wide-only live rail (lazy chunk, never in first-load JS) |
| `OvernightTape` | §14.4 | Return-visit delta ledger on The Tape |
| `CheckoutSheet` | §11 | Two-lane F3 purchase flow |
| `OnrampWidgetHost` | §11 | Themed container for the on-ramp provider iframe/widget |
| `ClearingCapacityMeter` | §13 | Always-visible weekly w_cap allowance meter |
| `TrancheTracker` | §13 | Dated settlement timeline (reuses `CountdownTimer`) |
| `ProvenanceChip` | §12 | Origin tag on Ledger entries (Call, Raid, Gig, Market, Desk, Share-Out, Purchase) |
| `QRHandoff` | §10.3 | Device-handoff QR display + in-app scanner |
| `AddressRow` | §19.3 | Truncated address + copy affordance + explorer link (R2+) |
| `AmountField` | §19.1 | Money input with presets/max/cap-clamping |
| `SkulkBoard` | §16 | Officer-posted pinned notices (3 slots) |
| `TacticalPing` | §16 | Preset war-coordination strings |
| `PresenceDot` | §16 | Roster presence (shared timer source) |
| `InstallSheet` | §17 | Custom install prompt / iOS A2HS instructions |
| `UpgradeBanner` | §10.1 | R0→R1 value-threshold suggestion (1/session max) |
| `ThemeToggle` | §4.6 | System → Dark → Light cycle |
| `Sparkline`, `IndexChart` | §19.4 | The only two chart components |
| `StalenessTag` | §18.4 | “as of HH:MM” stamp for cached/held values |
| `ActivityLog` | §14.4 | Event-history stack under The Tape (`ListRow` + `ProvenanceChip` + `StalenessTag`, virtualized, server-paginated) |

**Retired:** TON Connect surfaces, Telegram theme listener, TMA viewport/haptics bindings.

---

## 8. Motion

Everything in v1 §5 carries unchanged: **60 fps target; animate `transform`/`opacity`
only; micro 120 ms / standard 200 ms / emphasis 320 ms; easing
`cubic-bezier(0.2, 0, 0, 1)`; `prefers-reduced-motion` honored; the in-app
animation-disable toggle resolves all transitions to instant state changes.** Desktop does
not get a looser budget — the tokens are surface-independent.

### 8.1 Desktop additions

All gated on `@media (hover: hover) and (pointer: fine)` — touch devices must never
receive hover styles (sticky-hover is a defect class).

| Affordance | Spec |
|---|---|
| Hover-in / hover-out | micro tier, 120 ms both directions; background shifts to the row's pressed token at 60% strength, or `opacity` 0.92 → 1.0 on icon buttons |
| Hover transform | optional `translateY(-1px)` on `Card` and primary `Button` only; **never** `scale` on rows (text shimmer on 1× displays) |
| Cursor grammar | `pointer` = actionable; `default` = static; `grab`/`grabbing` = draggable (order-book ladder); `not-allowed` = disabled. No custom cursor sprites |
| Keyboard focus | `:focus-visible` ring: 2 px `--c-accent`, 2 px offset, radius inherits (§20.2) |
| Tooltips | desktop-only, 400 ms delay, micro-tier fade, never load-bearing — all tooltip content must exist on tap-reachable surfaces |
| Pointer-fine density | desktop MAY tighten `ListRow` vertical padding 12 → 10; touch keeps 44×44 px targets |

### 8.2 RewardReveal — guardrail restated for the open web

One component, all surfaces. Single-stage decrypt/flip: the result card resolves in
≤ 320 ms; tier-colored glow fades over a further 200 ms. Tier is expressed through
**static channels** — color token, glow intensity, haptic/audio weight — never motion
length.

Hard prohibitions (`ECONOMY.md` §8 posture, sharpened by the US-broker-adjacent chain):

- No reels, spinners, wheels, or sequential symbol reveals.
- No near-miss framing (never render “what you almost won”).
- No anticipation build: **reveal duration is constant regardless of payout size.**
- No celebratory escalation loops; the Share-Out event screen is the only sanctioned
  celebration surface, and it is informational.
- Desktop adds nothing: no larger canvas, no extended animation, no sound-stinger upgrades.
- **Pays Unsettled Scrip only** — the component never renders an $ALPHA amount, enforced at
  the type level. *(Unsettled, not merely “Scrip”: Settled Scrip is exchangeable, so a
  Scrip-typed reveal would re-open the chance → exchange → cash-out chain the
  `VALIDATION-BENCHMARKS.md` critical finding closed.)*
- Reduced-motion / animation-off: result appears instantly with the tier color applied.
- No purchase surface inside or adjacent to the reveal loop; no decaying-timer discount
  pressure anywhere; no “X people bought this.”

---

## 9. Input feedback: haptics & audio

**Ownership:** this section is the feedback spec; the PlatformAdapter (§3.3) is the
transport resolution layer. Components emit semantic events; they never call
`navigator.vibrate` or WebAudio directly.

### 9.1 One semantic map, three transports

v1 §7's event map is retained as the abstract layer, routed by a single dispatcher:

| Event | Vibration (Android Chrome) | Audio cue (all platforms) |
|---|---|---|
| Primary button press | 10 ms | soft tick, ~1.2 kHz, 30 ms |
| Successful Call / Raid | 20 ms | two-note rising blip, 90 ms |
| Failed Call / Nicked / Margin Called / error | 30-40-30 ms | single low buzz, 120 ms |
| Warning (low Focus / Risk Appetite, risky Raid) | 20-30 ms | muted double-tick, 80 ms |
| Tab switch / selection | 5 ms | silent — selection stays haptic/visual only |
| RewardReveal, tier-scaled | 15 / 25 / 40 ms by tier | tier-pitched resolve chime ≤ 150 ms; **amplitude scales, not length** |
| Market fill (foreground) | 15 ms | “paper snap” tick, 60 ms |
| Destructive confirm | 35 ms | low thunk, 100 ms |

> The 15/25/40 ms haptic tiers scale pulse length; the anti-anticipation rule (§8.2)
> targets the visual/temporal reveal channel — the Vibration API has no amplitude control
> and ≤40 ms deltas are imperceptible as anticipation.

Rules:

- **Vibration:** feature-detect; effectively Android Chrome only (iOS web and desktop get
  nothing — platform fact, not a bug). Fire only after sticky user activation. Patterns
  ≤ 3 pulses / 120 ms total, debounced 80 ms. Suppressed under reduced-motion,
  animation-off, or battery-saver where detectable.
- **Audio (the cross-platform substitute):** cues **on by default at low gain** (cue bus
  −18 dB FS) — iOS has no vibration path; a silent default leaves the majority-mobile
  install base with zero game feel (principle 5). Mitigations: persistent one-tap mute in
  the header (persisted per device); a dismissible “Sound on — mute here” toast on first
  session; cues hard-capped at 150 ms; **no music or ambience by default** (pit-ambience
  loop is a separate opt-in). `AudioContext` created/resumed on first user gesture; until
  then all cues no-op silently. **Telemetry:** `ret_mute_toggled` ships day one — if
  first-week mute rate exceeds ~50%, the default flips to off (Appendix C).
- **Zero-asset audio:** all cues synthesized (WebAudio oscillator + envelope, one ~2 KB
  module). A sampled cue pack is a Phase-2 cosmetic, potentially an Open Market line.
- **Accessibility invariant:** feedback is an enhancement layer — never the sole signal.
  Every event has a visual twin.

### 9.2 Settings surface

`Settings → Feedback`: Sound cues (default on) · Ambience (default off) · Vibration
(default on where supported; row hidden elsewhere) · Animations (v1 toggle, unchanged).
Four rows, no sliders in Phase-1.

---

## 10. Identity ladder & sessions

> **Solana migration note (2026-08-28, per SOLANA-FEASIBILITY.md §3/§6 step 4):** the
> R1 mechanism in this section is superseded. R1 is now **SIWS** — a Solana wallet
> sign-in against the same provider-agnostic seam (rung semantics, collision choose
> sheet, and demanding-surface triggers unchanged). Privy/embedded-4337/SIWE specifics
> below are the archived EVM-era design. Consequences: R1 is the one sanctioned wallet
> ceremony (the §10.1 jargon ban softens exactly there — the wallet is named plainly,
> with the promise that signing moves no funds); R2 keeps its separate purpose-bound
> link message; deposits are one wallet transaction (no approve step). The wallet
> layer is a direct Wallet Standard relay (`apps/web/src/wallet.ts`), never a vendor
> modal kit.

Implements the feasibility conditions at the UI layer: SIWE + embedded wallets preserving
**“no wallet until you need value.”** Internal terms (Clean/Bound, w_cap, F3/F4, PoP)
never appear in player copy.

### 10.1 The ladder

A Fox reaches the core loop in under 10 seconds and can play indefinitely at Rung 0.

| Rung | Identity | Wallet state | Unlocked surfaces |
|---|---|---|---|
| **R0 — Guest** | Anonymous server account, device-bound (httpOnly token) | None | Calls, Raids, Gigs, The Sim, training, Focus/Risk loop, earning Scrip (both settlement states), NPC purchases (sinks), joining a Skulk as member, read-only Open Market & Index |
| **R1 — Registered** | Email or social (Privy); recoverable, cross-device | **Embedded ERC-4337 smart account auto-created silently** — no seed phrase, no wallet UI moment | R0 plus: P2P transfers, Open Market listings/sales, Index trading, Skulk AUM + treasury roles, the Commons, all purchases (F3), buying/holding/staking $ALPHA (F4), device handoff |
| **R2 — Linked wallet** | R1 + external wallet proven via SIWE (wagmi/WalletConnect) | Embedded + external on one account | External deposits of $ALPHA/USDG/USDC; withdrawal destination |
| **R3 — Verified** | + World ID (Orb-level), one-time, per-region KYC-vendor fallback | unchanged | **Cash-out** — the only surface that ever demands identity verification |

Normative rules:
- **The demanding surface triggers the upgrade** (never a settings page): tapping *List on
  the Open Market* at R0 opens the R1 sheet with the action queued and auto-resumed.
- Upgrade suggestions (never forced): first time a Guest's Scrip exceeds a configured
  threshold, and at D1 return — one-line `UpgradeBanner`, *“Your take lives on this device
  only. Register to keep it.”* Max one per session, dismissible, never modal over gameplay.
- Rungs never expire or downgrade. Verification status is account-level, travels across
  devices.
- R2 is never required to buy, play, or hold — external wallets are an on/off-ramp
  convenience, not a status.
- **Wallet-jargon ban at R0/R1:** no “wallet,” “keys,” “gas,” “sign,” “on-chain” in copy.
  The embedded account is **“your Book.”** At R2 the external wallet may be named plainly —
  R2 users chose that world.
- **Guest loss:** R0 accounts are irrecoverable by design (clearing site data destroys
  them); the `UpgradeBanner` states this — the loss condition lives in the banner, not fine
  print. The `iam_*` events watch this cohort for silent value-loss churn (Appendix C). On
  wallet in-app browsers (ephemeral storage, §3.1) the `UpgradeBanner` threshold is lower —
  guests on that surface are pushed to R1 early.
- **Upgrade continuity (normative):** R0 → R1 upgrades the **same server account in
  place** — all Scrip, Skulk membership, stats, Book contents, and referral attribution
  persist; nothing is migrated or re-minted. **Credential collision:** if the Privy
  email/social credential already maps to an existing Outfox account (registered on one
  device, playing as a guest on another — the common case), show a **choose sheet**:
  continue as the existing account (the guest account is then retired — its roster seat
  lapses per §16 and its Scrip does not transfer, stated plainly on the sheet) or keep
  playing as the guest under a different credential. **Never silent overwrite, never
  silent merge.** Event: `iam_rung_upgrade_collision{resolution}` (§22).
- **Upgrade failure recovery:** the R1 upgrade is Privy auth + silent 4337 account
  creation. If account creation fails after auth succeeds, the player proceeds as R1 and
  creation retries silently server-side (it is invisible by design — the retry is too).
  The queued demanding action (*“the action queued and auto-resumed”*) persists
  server-side with an expiry so it survives the §3.2 popup→redirect fallback; abandonment
  at the OAuth step returns to the pre-tap state, guest account intact. Events:
  `iam_rung_upgrade_failed{stage,reason}`, `iam_rung_upgrade_abandoned{stage}` (§22).

### 10.2 Sessions & SIWE

**Primary session (R0/R1):** server session — 24 h access JWT, 60-day rolling refresh,
httpOnly, device-bound. Opening the PWA never shows a login wall while the refresh chain
holds; Privy re-auth (email OTP / social / passkey) only when it breaks. **SIWE is not the
login for R0/R1** — a wallet ceremony on every open is exactly the friction the
embedded-wallet condition bans.

**SIWE (EIP-4361) appears in exactly two places:**
1. **R2 linking** — prove control of an external wallet. `domain` = canonical origin
   (hard-bound), `chainId` = 4663, server-issued single-use nonce (5-min TTL), `statement` =
   “Link this wallet to your Outfox account. This is not a transaction and costs nothing.”
2. **Step-up re-auth** — withdrawal initiation, wallet link/unlink, P2P above threshold,
   email change: fresh auth ≤ 10 min (Privy re-auth for R1, SIWE re-sign for R2 wallets).

**Smart-account signatures:** verification MUST support **ERC-1271** (deployed) and
**ERC-6492** (counterfactual) — linked external wallets may themselves be smart accounts
(Safe, Argent, Coinbase Smart Wallet), and the embedded 4337 account signs
1271/6492-style wherever its signature is ever verified. EOA-only signature verification
is a launch-blocking bug. *(Note: the embedded account never performs SIWE — SIWE is
external-wallet-only per the two-places rule above.)*

**Wallet unlink (R2):** step-up auth required (above). Multiple external wallets may be
linked; **exactly one is the designated withdrawal destination.** Unlinking the
designated wallet is **blocked while tranches are pending to it** — the player must first
re-designate another linked wallet (explicit confirmation; the `TrancheTracker` shows the
new destination from the next tranche, never silently mid-schedule). R2 status persists
account-level after unlinking all wallets (rungs never downgrade); the Clearinghouse
simply re-demands a destination on next use, per “the demanding surface triggers the
upgrade.”

**Connection edge cases (all handled, all instrumented):** injected provider detected →
connect directly, never show the WalletConnect modal inside a wallet's own browser; popups
per §3.2; WalletConnect deep-link limbo → waiting state with elapsed-time awareness (at
20 s: *“Still in your wallet? Return here after approving”* + Retry/Cancel; poll for
session, never rely on the user's return); wrong chain → one-tap
`wallet_addEthereumChain`/switch, never manual RPC instructions; signature declined →
treated as cancel (state preserved), never as error.

### 10.3 Device handoff

Desktop is first-class: the new device shows a one-time rotating QR (60 s TTL); the
logged-in phone scans it in-app and approves; the new device gets a session at the same
rung, verification status included. Fallback: email magic link (R1+). Settings lists
active sessions with per-device revoke.

### 10.4 First run (FTUE)

Organic arrivals at the canonical URL get **the identical guest-boot as referral traffic**
(§15): the server mints an R0 account on first meaningful interaction and the first screen
is a **guided first Call in The Sim** — one pre-selected low-stakes Call with a single
primary CTA, the mascot's one sanctioned onboarding beat (§6), and no interstitials before
it. After the first Call resolves (VM1), the player lands on **The Tape**, which becomes
the home screen from then on. No prompt of any kind fires before VM1 (§17.2). The
10-second core-loop promise (§10.1) is measured, not aspirational:
`iam_guest_created{source: organic|referral|quest}` →
`ftue_first_call_completed{elapsed_ms}` (§22), with p50 ≤ 10 s on the floor device as the
acceptance bar.

---

## 11. Purchases — the F3 checkout

All **F3 checkout SKUs** (Focus/Risk refills, Desk/Market slots, cosmetics — **time and
self-expression, never power**, GDD §7) are **USD-priced** and settle in **USDG/USDC on
chain 4663**. F3 never requires $ALPHA; $ALPHA purchase (F4) is a separate, deliberately
non-impulse flow on the Ledger. **$ALPHA-denominated premium sinks still exist** — the
frozen Gresham lever (`ECONOMY.md` §2.2: some premium goods/fees are priced in the token
to force spending) surfaces as $ALPHA pricing on Seats, premium Desk upgrades, and the
Open Market's premium cosmetic tier, on those screens — F3's USD lane does not replace
them.

**The `CheckoutSheet`** (bottom sheet on mobile, right panel on desktop):

*Lane A — Balance (the repeat-purchase path):*
1. Tap SKU → sheet opens: price (USD) and current Book balance.
2. Tap **Pay** → single 4337 user-op (approve+transfer batched, paymaster-sponsored).
3. Success inline; the item/effect appears immediately **with a pending chip** that clears
   on `pay_tx_confirmed`. **Budget: ≤ 3 taps, ≤ 8 s p50 end-to-end on the floor device.**
   **Reconciliation failure (the user-op fails or reverts after submission):** the player
   is never charged for a failed op and never loses value already consumed — if the
   pending item was consumed, the game absorbs it (principle 4); otherwise it reverts with
   a toast + Ledger entry stating why. `pay_failed{stage:'confirm'}` fires either way.
   *(This is the “optimistic UI only for safe, reversible actions” rule (§21) applied to
   money: presentation is optimistic, the charge is not.)*

*Lane B — Add funds (auto-selected when balance is insufficient):*
1. Sheet shows the shortfall: *“You need $4 more.”* Tap **Add funds**.
2. Embedded on-ramp widget behind the internal `OnrampProvider` interface — condition 3
   makes conversion a NO-GO trigger, so the vendor must be swappable on measured
   performance. **Candidate order per `ONRAMP-COVERAGE.md` (2026-07): Robinhood Connect
   (pending partner-docs verification) → Meld → two-step USDC-to-Arbitrum + 0x
   cross-chain route.** *(The earlier “Ramp primary, MoonPay fallback” assumption is
   superseded — neither settles to 4663 today.)* Widget pre-filled: amount = shortfall
   rounded to presets ($5/$10/$20), asset = **USDG** (USDC is not documented native on
   4663 — USDG-first, `ONRAMP-COVERAGE.md`), destination = Book, chain = 4663.
3. On settlement (webhook-driven; the sheet shows the provider's ETA, not a spinner),
   checkout **auto-resumes Lane A**. **Budget: first-ever fiat purchase ≤ 12 taps,
   ≤ 120 s p50 excluding on-ramp KYC; returning credentials ≤ 60 s p50.**

**Failure map (every node emits its event, §22):** widget load failure → retry + provider
failover; on-ramp KYC rejection → plain-language dead-end with the provider's appeal link,
never a game error; card decline / 3DS abandon → return to sheet, state preserved;
geo-block → checked upfront before the widget opens, not after card entry; settlement
delay past ETA → sheet dismissible, purchase completes in background, delivery announced
by toast + Ledger entry (never lose a paid user to a stuck spinner); quote drift →
re-quote and re-confirm, never silently charge more.

Friction-budget bands are provisional until the condition-5 re-baseline lands — the
instrumentation ships first, the bands are calibrated against it (§22).

---

## 12. The Ledger

One screen owns all value display (replaces v1 `WalletPanel`). Balance hierarchy:

| Row | Display | Rules |
|---|---|---|
| **Scrip** | Single headline figure + inline split row: `Settled` / `Unsettled · SPEND-ONLY` | Unsettled carries the micro-badge and one fixed explainer: *“Unsettled Scrip covers the Street's own services — refills, fees, upkeep, house goods, the Commons. It can't be sent to another Fox, traded on the Open Market, or cashed out.”* No modal, no long copy. *(Sink-only per `ECONOMY.md` §6 guardrail #1 — Unsettled is never spendable on any player-to-player surface.)* |
| **$ALPHA** | Liquid · Staked · Settling (with next release date) | Staked shows yield state; Settling rows link to the `TrancheTracker` (§13). Liquid rows show **seasoning state** (`ECONOMY.md` §13.C): unseasoned $ALPHA carries a *“seasons on {date}”* stamp (dates-not-durations, §19.2) — the withdrawal surcharge is visible weeks before it binds. A hint row notes idle **Carry** (the §13.A holding cost) and that Staked is exempt, linking the published rule schedule |
| **Stablecoin (Book)** | USDG/USDC balance + **Add funds** | Visible only after first funding; guests never see it |
| **Clearing capacity** | `ClearingCapacityMeter` (§13) | Visible from first $ALPHA acquired — before any withdrawal attempt |

**Contextual availability is the enforcement mechanism:** every transfer, exchange, and
donation surface shows only the balance *valid for that action* as “available”
(**transfer, exchange, and all Open Market purchases/listings → Settled only** — the Open
Market is a player-to-player surface; sinks/Commons → total, since Unsettled may be
donated — it's a sink). The UI never lets a Fox compose an action with Unsettled Scrip and
then errors — invalid sources are simply not offered. Color: Settled uses `--c-scrip`;
Unsettled uses the same hue at reduced chroma **plus** the badge (never color alone).

**Gas rules:** embedded-account operations are paymaster-sponsored — **no *network-fee*
line, ever**. In-game Market/transfer fees are frozen economy sinks (`ECONOMY.md` §2.1) and
are **always itemized before commit** — the no-fee-line rule covers chain machinery only,
never game fees. R2 external-wallet deposits show a plain “network fee” estimate (their
wallet pays). Withdrawals show one combined **“clearing fee”** — protocol fee + settlement
gas + the `ECONOMY.md` §13.C seasoning surcharge when the $ALPHA is unseasoned — with the
components itemized on the quote screen. “Gas” is banned from player copy; so is “all-in”
(TAPE blacklist) — the sub-copy is *“includes everything — nothing added later.”*

**Provenance:** every Ledger entry carries its `ProvenanceChip` (Call, Raid, Gig, Market,
Desk, Share-Out, Purchase, **Carry**) — the player-visible face of server-side taint
tracking, and the audit trail players cite when they trust the economy. **Carry** is the
fiction name for the frozen decay levers (Scrip demurrage, `ECONOMY.md` §2.1; idle-$ALPHA
holding cost, §13.A): both post as explicit dated Ledger entries, never as silent balance
shrinkage — principle 4 — and the Ledger links the published policy schedule
(`ECONOMY.md` §3 pre-committed rules).

---

## 13. Cash-out — The Clearinghouse

The only place internal value becomes external value (`ECONOMY.md` §9). Fiction: the
Street's Clearinghouse — capacity, schedules, and fees are how real clearing works, so
limits read as market structure, not a rug.

**Standing display (before any attempt):** the `ClearingCapacityMeter` on the Ledger —
*“This week: 0 / N $ALPHA cleared · resets Mar 3, 00:00”* (absolute, device-local, per
§19.2 — never “Monday” or a UTC time) — from the moment a Fox first holds $ALPHA. The cap
is learned like Focus/Risk Appetite: a regenerating allowance, weeks before it binds.

**Flow (stepper; each step instrumented):**
1. **Amount** — `AmountField` capped live at remaining weekly capacity; over-cap entry is
   impossible, not an error. Remaining capacity + reset date inline.
2. **Quote** — one screen, pre-commitment: amount · clearing fee (components itemized:
   protocol fee, settlement, seasoning surcharge if the $ALPHA is unseasoned — §12) ·
   **settlement schedule as a dated tranche timeline** (“¼ on Mar 3 · ¼ on Mar 10 · …”) ·
   destination. **Quoted numbers are locked** — nothing changes after this screen.
3. **Link wallet** (R1 Foxes — the normal first-time case): the R2 wallet-link flow
   (§10.2) interleaves here, per “the demanding surface triggers the upgrade.” The locked
   quote survives the detour under the same 24 h hold as step 4. Events:
   `cashout_wallet_link_started/completed` (§22).
4. **Verify** (first time only) — World ID Orb-level; regional KYC fallback. Framing:
   *“One-time. Proves you're one Fox — the Clearinghouse clears people, not bots. We never
   see your identity documents.”* On failure: retry + support path; the quote holds 24 h.
5. **Confirm** — step-up auth (§10.2) → `TrancheTracker`: each tranche shows scheduled
   date → settled on-chain, explorer link exposed at R2+.
6. Settled tranches notify via push/email — a positive-trust touchpoint.

**Degraded settlement state (chain reality — the L2 is weeks old):** if sequencer or L1
finality delay pushes a tranche past its date, the tracker switches that tranche to an
explicit **“Settlement delayed — network conditions”** state with a live status line and a
revised estimate; the delayed tranche never silently slips. If delay exceeds 24 h, the S1
security-class notification fires with the same honest status. Monitoring for this state
is a launch prerequisite for enabling real-money withdrawal (§21.3 server obligations).

**Anti-rug messaging (normative):** limits — including the seasoning schedule — published
in a static **Clearinghouse Rules** sheet linked from first $ALPHA acquisition and every
quote screen; *instant*, *anytime*, *no limits*, and *all-in* are banned near cash-out; **dates, not durations** (“Mar 3,” not “in 7
days”; format per §19.2); a quote never worsens after display; capacity changes are
announced ahead of effect, never applied silently.

---

## 14. Notifications & re-entry

Telegram's free bot channel is gone; this stack replaces it. Three channels, one
preference model.

### 14.1 Channels

| Channel | Latency class | Reach | Role |
|---|---|---|---|
| Web Push (FCM transport) | seconds | Android web good; iOS **installed-PWA only**; desktop good | Timers, fills, war events — anything actionable within hours |
| Email | minutes–hours | universal (verified capture) | Irreversible/high-value singles + weekly digest; the push-denied fallback |
| Discord DM (linked bot) | seconds | opt-in minority, highest-LTV | Mirror of push; Skulk-scoped broadcasts |

### 14.2 Permission choreography — the ask is a designed moment

**Never on load. Never unprompted. Never the native dialog first.** All asks route through
the prompt scheduler (§17.2).

1. **Trigger moments** (first occurrence, from the Value-Moment registry §17.1): player
   commits a Focus/Risk regen timer and leaves the screen; first resting Open Market
   order; first $ALPHA unbonding started.
2. **Soft ask (diegetic card):** *“Your Focus refills in 4 h. Want a ping when you're
   ready to trade?”* — [Ping me] / [Not now].
3. **Native prompt** fires only on [Ping me] — a native deny is near-terminal on the
   origin; the soft ask makes that near-impossible from an intentful user.
4. **Cooldowns:** [Not now] → 7-day suppression; after the third lifetime decline the ask
   retreats permanently to Settings.
5. **iOS branch:** the soft ask first routes through the `InstallSheet` (iOS push requires
   the installed PWA); the permission ask follows on next launch from the installed icon,
   re-triggered by the next value moment. This consumes install-surface budget (§17.2).
6. **Email capture** is a separate, later ask — at R1 upgrade (VM9, natural form moment)
   or after first unbonding starts (*“Your $ALPHA unlocks on {date}. Where do we send the
   all-clear?”* — parameterized and dated; the unbonding period is an open model input,
   never hardcoded in copy, and dates-not-durations applies, §19.2). Single field, no
   pre-ticked marketing checkbox, double opt-in.
7. **Discord link** is never globally prompted — offered contextually on joining a Skulk
   and in Settings.

### 14.3 Per-channel content policy

Severity: **S1 actionable-now · S2 actionable-today · S3 informational.**

| Event | Push | Email | Discord DM | Badge |
|---|---|---|---|---|
| Focus / Risk Appetite full | S1 | — | mirror | +1 |
| Open Market order filled | S1 | — | mirror | +1 |
| Outbid / order expired | S2 | — | mirror | +1 |
| Skulk takeover started (war) | S1 | — | Skulk channel | +1 |
| Outtraded by another Fox / Nicked | S1 | — | mirror | +1 |
| $ALPHA unbonding complete | S1 | **single** (irreversible-value class) | mirror | +1 |
| Margin Called ended / heat cleared | S2 | — | — | +1 |
| Share-Out / Commons standing change | S3 — batched daily | weekly digest | Skulk channel | — |
| Season / Big Score events | S3 — batched | weekly digest | server announce | — |
| Security (new device, withdrawal initiated, settlement delayed) | always | **always** | — | — |

Rules: max **5 pushes per player per day**, server-enforced (S1 exempt only for
war-defense and security); S3 never pushes individually; all copy passes the
`THEME-OUTFOX.md` §3 tone test and the gambling-vocabulary blacklist (CI string-lint,
§21); every push deep-links to the exact screen; payloads never contain balances
(lock-screen privacy) — *“Your order filled,”* not the amount.

### 14.4 Quiet hours & re-entry surfaces

- **Quiet hours** (Settings label: **“Quiet hours”** — *not* “After Hours,” which is a
  district): default 22:00–08:00 device-local, on by default. S1/S2 held server-side and
  coalesced into one morning summary push. **The badge is stale by design during quiet
  hours** — held pushes never reach the service worker, and badge-only silent pushes are
  forbidden by both engines (Chrome `userVisibleOnly`; WebKit revokes silent-push
  subscriptions). Badge updates resume with the morning summary push and on next session
  start. Exemption toggles: war defense (default off), security (default on).
- **App badge — honest platform matrix:** `setAppBadge(n)`, n = actionable items
  (claimables, full resources, unread fills, active war) — never unread-news count.
  Support: **iOS installed PWA (requires granted notification permission — the badge
  rides the push permission) and desktop Chromium only. Chrome on Android does not
  support the Badging API** — Android badge dots come from delivered notifications, so on
  the floor device the badge is a side effect of push, not a separate channel. Set on
  push receipt (SW); recomputed on session end where the API exists; cleared item-by-item
  as the player acts. Feature-detected; absence silent. iOS 18.4+ declarative web push
  may extend badge behavior — treat as progressive enhancement, never a dependency.
- **The Overnight Tape:** on session start after ≥ 30 min away, The Tape renders the delta
  since `last_seen` above the fold — server-computed, **riding the session bootstrap
  payload, zero extra round trip** (LCP gate): (1) P&L line — net Scrip change, split
  Settled/Unsettled, top contributing source; (2) resources regenerated (capped time
  surfaced once as missed regen, no nagging); (3) up to 3 event rows (fills, Foxes who
  outtraded you, war outcomes, Sheriff status, Share-Out), overflow → “+ n more” → the
  **Activity Log**, a stack under The Tape (§7): `ListRow` + `ProvenanceChip` +
  `StalenessTag`, virtualized, server-paginated, 90-day retention — the durable home of
  the event history the Tape Rail and badge counts reference; (4) **one claim CTA max** —
  never a claim carousel. Static rows: no
  count-up animation on load (CLS + animation-off). Informational, not a reward mechanic —
  no chance element, gains never styled as winnings.
- **Email digests:** event-triggered singles (unbonding complete, security only) on a
  transactional sending domain, separate from marketing; **weekly Street Recap** (opt-out):
  P&L sparkline, Skulk standing, Commons movement, one season hook — plain-text-first
  HTML < 50 KB, one CTA. No daily digest in Phase-1; daily is opt-in. Sending-domain
  warm-up before launch traffic (§21.3).
- **Discord mirror:** the linking bot mirrors S1/S2 as DMs when push is undeliverable or
  by preference; posts war broadcasts to per-Skulk channels. Discord is a mirror and a
  social home — never the only carrier of an actionable event.

---

## 15. Referral & invite loop

- **Link:** `outfox.game/f/<foxtag>` (player-claimed handle; fallback short code). Share
  surfaces generate OG cards (fox mascot + inviter foxtag + “Outfox the Houses”) for
  Discord/Farcaster/X unfurls. No platform deep-link SDKs.
- **Landing = the game:** the URL boots an anonymous guest session straight into The Sim —
  no marketing page, no signup wall, gameplay starts inside the LCP budget. “No wallet
  until you need value” is preserved end-to-end.
- **Attribution:** captured server-side at guest-account mint (URL param; first-touch;
  30-day window; localStorage + first-party cookie belt-and-braces). No fingerprinting, no
  third-party SDKs. The edge lives on the account and survives the R0→R1 upgrade
  permanently. The attribution cookie and reward classification are explicitly in the
  Phase-0 legal scope (Appendix C).
- **Rewards: convenience/cosmetic only** — Focus refills and a referral jacket cosmetic
  line — released in tranches on referee activity milestones (D1 return, first Gig chain,
  first Open Market trade — **which requires referee R1+**, a deliberate anti-farming
  property). **Referral jackets are account-bound — never listable on the Open Market**
  (§6 note), so no reward converts to Scrip via market sale. **Never $ALPHA, never Scrip,
  never Commons standing** (standing is obtainable *only* by donation — it is the
  sanctioned Veblen sink, `ECONOMY.md` §2.3 / `THEME-OUTFOX.md` §4 — a free standing
  channel would dilute it), **never anything on signup.** The economy is frozen and gains
  no new faucet; referral must be economically pointless to farm.
- **Inviter surface:** `Settings → Your Recruits` — invited Foxes, milestone progress,
  pending tranches. Copy frames recruiting for the cause (*“bring a Fox to the Street”*),
  never earnings.

---

## 16. Skulk communication

**Phase-1 ships no freeform in-app chat.** Discord is the canonical social layer; in-app
comms are structured-only.

**The Skulk tab (screen spec):** one stacked screen at Compact/Medium (list-detail stays
out of the Wide launch scope per §2.3): header — Skulk name, `SkulkBanner`, AUM figure
(`--font-mono`; treasury actions gate at R1 per §10.1, treasury *roles* surface only to
officers); then `SkulkBoard` (pinned notices); then the roster (`ListRow` + `PresenceDot`,
virtualized) with standing/contribution columns; then takeover state — if a war is active,
a prominent `Card` linking the **war screen**. Guests appear on rosters like any member;
a guest account inactive ≥ 14 days shows as *“gone quiet”* and is pruned from the roster
at 30 days (R0 accounts are destructible by design, §10.1 — rosters must not accrete
ghosts).

**The war screen** (deep-link target of the §14.3 war S1 push): takeover objective +
`CountdownTimer`, district state, the event feed (`ListRow` stream — fills, pushes,
Sheriff interventions), and the `TacticalPing` bar. Compact-first single column; it is a
stack under the Skulk tab, not a sixth tab.

- **Discord:** one official server; the account-linking bot (OAuth from Settings or the
  Skulk screen) assigns a per-Skulk role and provisions a private channel per Skulk above
  a size threshold. The same link powers the §14 notification mirror — one integration
  covers two rebuild rows. **Linking gates at R1** (VM8 fires for guests but routes
  through the R1 sheet first, per “the demanding surface triggers the upgrade” — a
  persistent Discord identity is never bound to a destructible R0 account).
- **In-app structured comms (no free text anywhere):**
  - `SkulkBoard` — 3 officer-posted pinned notices (300-char limit, officer-only write).
  - `TacticalPing` — during takeovers, one-tap preset strings (“Defend the Vault,” “Push
    Options Alley,” “Regroup in the Hollow”), 10 s per-player cooldown, rendered in the
    war screen's event feed. Preset-only ⇒ zero moderation surface.
  - `PresenceDot` — online dots on the roster (shared timer source, no per-row polling).
- **Why no chat:** freeform text beside a cashable token is an RMT-solicitation and
  moderation liability the Phase-0 legal scope should not absorb, and it needs
  trust-and-safety tooling that doesn't exist. Discord owns moderation tooling and doubles
  as a retention channel.
- **Re-evaluation gate (Phase-2):** revisit in-app chat if Discord-link adoption among
  weekly-active Skulk members ≥ 40% and war participation shows a coordination bottleneck.
  The same review is the Discord-dependency exit-hatch check (Appendix C).

---

## 17. Install UX & the prompt scheduler

### 17.1 Value-Moment registry (canonical)

All engagement prompts key off this registry — one list, one source of truth:

| ID | Moment |
|---|---|
| VM1 | First successful Call payout |
| VM2 | Start of session 2 |
| VM3 | First Focus/Risk regen timer committed + screen left |
| VM4 | First resting Open Market order |
| VM5 | First $ALPHA unbonding started |
| VM6 | Guest Scrip balance crosses the configured threshold |
| VM7 | D1 return |
| VM8 | Joining a Skulk |
| VM9 | R1 upgrade completed |

Consumers: install prompt (VM1, VM2) · notification soft-ask (VM3, VM4, VM5) ·
R1 `UpgradeBanner` (VM6, VM7) · Discord link offer (VM8, gated R1+ per §16) ·
email capture (VM9, VM5).

### 17.2 The prompt scheduler (normative)

One global scheduler owns every system-initiated prompt (install, notification soft-ask,
upgrade banner, email capture, Discord offer):

- **Max one system prompt per session**, full stop.
- **Shared install-surface budget:** 3 automatic offers lifetime, whether triggered by the
  install flow or by the iOS notification→A2HS routing — they draw from one counter.
- **Cooldowns:** the longest applicable cooldown wins (install dismissal 14 days;
  notification [Not now] 7 days). After a prompt's lifetime budget exhausts, it retreats
  permanently to its Settings entry.
- **User-initiated actions are exempt:** tapping “enable notifications” or “add to home
  screen” in Settings always works, immediately, regardless of budgets.
- **Priority when multiple prompts are eligible:** notification soft-ask > install >
  R1 upgrade > email > Discord. The losers wait for a future session. (Security events
  are notifications (§14.3), not scheduler prompts — they bypass the scheduler entirely
  and never consume its budgets.)
- The scheduler is a real state machine with persisted counters, not scattered
  if-statements — the `beforeinstallprompt`-vs-value-moment race (event not yet fired, or
  mini-infobar previously dismissed) must degrade to the Settings entry, silently.

### 17.3 Install prompt

- **Never on first load.** `beforeinstallprompt` captured silently, `preventDefault()`-ed
  (suppresses the mini-infobar).
- **Trigger:** VM1 or VM2 via the scheduler. Copy sells utility: *“Pin Outfox — one tap
  back to the Street, and get word when you're outtraded or Nicked.”* (Glossary terms
  only — never “hit”/attack framing, Appendix A.)
- **iOS Safari** (no prompt API): instructional `InstallSheet` (Share → Add to Home
  Screen) at the same triggers, and again on notification intent (§14.2, budgeted).
- **iOS install-session bridge (normative):** an iOS home-screen web app gets an isolated
  storage container — cookies and IndexedDB do **not** carry over from Safari, so a naive
  A2HS instruction silently strands an R0 guest's account and Scrip in Safari. Before
  showing the iOS `InstallSheet` to an R0 user, either route the R1 upgrade first
  (recoverable identity), or mint a one-time session-transfer token embedded in
  `start_url` and claimed on first standalone launch. “First standalone launch resumes
  the Safari session” is a mandatory §21.4 test-matrix assertion for the PWA column.
- **Wallet in-app browsers: never prompt** (no install path; the CTA would dead-end).
- **Manifest:** `display: standalone`, dark theme/background colors, maskable fox icons
  (per `THEME-OUTFOX.md` §6 constraints), `start_url` with install-attribution param, app
  shortcuts: The Open Market, Skulk.

---

## 18. System states

### 18.1 Loading

- **Skeleton, not spinner,** for any full surface whose layout is known (`Screen`,
  `Section`, list bodies) — skeletons reserve space (CLS ≤ 0.1). Cap: one skeleton pass
  per navigation; skeletons never animate under animation-off.
- **Spinner** only for indeterminate inline waits ≤ a few seconds inside an already-laid-
  out surface (button-internal, sheet steps). Any wait with a known provider ETA (on-ramp,
  settlement) shows the ETA, not a spinner (§11).
- Route-chunk loads render the target screen's skeleton immediately; navigation is never
  blocked on a spinner screen.

### 18.2 Empty states

`EmptyState` = one mascot illustration (§6 rules), one line of copy in the §3 tone
(*“Nothing on the Book yet”*), one action. Empty ≠ error: no red, no retry.

### 18.3 Error taxonomy

| Class | Presentation | Retry |
|---|---|---|
| **Network** (offline/timeout) | TAPE-HALTED banner if global (§1.2); inline row-level “couldn't refresh” + `StalenessTag` if partial | Automatic with backoff + manual |
| **Server** (5xx / maintenance) | Full-surface state: *“The Street is closed for maintenance”* + status link | Manual, suggested interval |
| **Action rejected** (4xx: insufficient balance, cooldown, cap) | Inline, at the control that caused it; never a modal; never lose composed input | n/a — the UI should have prevented it (§12 contextual availability); every occurrence is logged as a design defect |
| **Chain/settlement** (sequencer delay, finality lag) | The §13 degraded-settlement state; honest status, revised estimate | Automatic; S1 notification at 24 h |
| **On-ramp/vendor** | §11 failure map — provider language quoted, appeal links, failover | Provider failover, then manual |
| **Auth/session** (refresh broken, storage evicted) | Silent re-auth attempt → clean re-entry sheet; never a broken half-session; composed state preserved where safe | Automatic then manual |
| **Chunk-load** (route `import()` rejects post-deploy) | Route skeleton → SW update check (§1.1) → toast-and-reload; never a stuck skeleton | Automatic (one reload), then manual |

Error copy: plain language, the fiction's voice but never at the cost of clarity
(*“Not enough Settled Scrip”* — good; cryptic lore riddles — no), and error codes for
support in a copyable footer line.

### 18.4 Staleness

Any value rendered from cache while disconnected or held carries the `StalenessTag`:
`as of 14:32` (device-local, 24-h clock). Stale money values are additionally dimmed to
80% and never sit next to a live-styled action button — the action is disabled with the
same tag.

---

## 19. Forms, numbers & data-viz

### 19.1 Money input — `AmountField`

- Numeric keypad (`inputmode="decimal"`), locale-aware separators, currency glyph fixed in
  the field (never typed).
- **Preset chips** ($5/$10/$20 for funding; ¼/½/**Max** for withdrawals and transfers) —
  Max is always cap-aware (Settled only, remaining clearing capacity, etc.).
- **Caps clamp at input, never at submit** (§13 rule generalized): the field's max is the
  action's true limit; over-typing clamps with a one-line inline reason.
- Paste is sanitized (strips separators/currency); desktop allows keyboard entry with the
  same clamping; steppers honor 44×44 touch targets.

### 19.2 Number & time formatting (canonical)

| Value | Format |
|---|---|
| Scrip | **Scrip mark (§6 SVG brand glyph) prefix** + `12,480` — thousands separators, no decimals (Scrip is integer). `¤` is the plain-text fallback only where SVG cannot render (logs, plain-text email); server-originated strings use the word “Scrip” instead of any glyph |
| $ALPHA | `12.4831 $ALPHA` — up to 4 dp, trailing zeros trimmed; ticker suffix |
| USD | `$4.00` — always 2 dp in checkout |
| P&L | Sign always explicit (`+`/`-` text), colored `--c-success`/`--c-danger` **and** paired with the §6 **up/down SVG marks** — color is never the only channel (§20), and direction never renders as a font glyph |
| Percentages | 1 dp, explicit sign where directional |
| Commitment dates (vesting, tranches, resets) | **Absolute, dated:** `Mar 3, 14:00` device-local — *dates, not durations* (anti-rug rule §13) |
| Activity timestamps | Relative under 24 h (`3 h ago`), absolute after |
| Countdowns | `CountdownTimer`, `H:MM:SS` under an hour, `2d 4h` above; one shared tick source |
| Addresses | `0x1F4a…9c2E` (4+4), monospace — see §19.3 |

All ledger numerals render in `--font-mono` with tabular alignment; columns of money never
jitter (§5).

### 19.3 Addresses & QR — `AddressRow`

Truncated address (4+4, `--font-mono`) · copy button (copies the full address, confirms
with a toast + `success` feedback event) · explorer link (Blockscout), exposed at R2+ only.
Full addresses are never line-wrapped mid-string; QR codes (deposit, device handoff)
render as SVG, minimum 200×200 CSS px, with the full value beneath in a copyable row.
Deposit screens pair chain name + chain ID visibly (*“Robinhood Chain · 4663”*) — wrong-
chain deposits are the classic irreversible loss.

### 19.4 Charts — `Sparkline` and `IndexChart` only

- **`Sparkline`** (weekly recap, Ledger history): inline SVG line, no axes, no
  interaction, ≤ 60 points, one accent color + dot on last value. Static — no draw-on
  animation under any setting.
- **`IndexChart`** (The Index detail): line/area chart, SVG, lazy-chunked with the Index
  route (never in first-load JS). Interactions: crosshair + tap/hover readout of
  `(time, price)`; pinch/scroll zoom desktop-optional; nothing else. No candlesticks in
  Phase-1 (the Index is fictional; OHLC theater invites trading-tool comparisons and
  costs perf).
- **Chart grammar:** up = `--c-success` + the §6 up mark, down = `--c-danger` + the §6
  down mark (SVG icons, never font glyphs; never color alone);
  axes/labels in `--c-text-hint`; gridlines `--c-border`; values in `--font-mono`;
  timestamps per §19.2. No third-party chart library — two components, hand-rolled SVG,
  virtualized data windows.
- Charts are decorative-exempt from `aria-live` (§20.1): each chart carries an accessible
  text summary (*“$ALPHA/Scrip, 7 days: +4.2%, high ¤ 132, low ¤ 118”*).

---

## 20. Accessibility & i18n

v1 §8 baseline carries verbatim: WCAG-AA contrast in both themes (§4.5 CI matrix), 44×44
touch targets, visible focus/pressed states, copy externalized, never color alone.
Additions for the standalone/desktop surface:

### 20.1 Live regions & tickers

- The Tape Rail, tickers, and countdowns are **`aria-live` OFF by default** — a stock
  ticker announced continuously is a screen-reader disaster.
- One polite live region exists app-wide for **discrete events the player caused or must
  act on**: action results, fills, errors, toast content. Coalesced: max one announcement
  per 2 s; queue collapses to the latest per source.
- `CountdownTimer` exposes `aria-label` with the human end time (*“Focus full at 14:32”*),
  not a ticking value.
- The Overnight Tape is a normal document region (navigable, not announced).

### 20.2 Focus management

- Route change: focus moves to the new screen's `h1` (screen-reader users learn where they
  are; no focus loss to `<body>`).
- `Sheet`/`Modal`: focus trapped, restored to the invoking control on close; `Esc` closes
  (desktop); the checkout stepper moves focus to each step's heading.
- List-detail (Wide): selecting a master row moves focus to the detail pane's heading;
  `←` returns to the list.
- `:focus-visible` ring per §8.1; focus order always follows visual order.

### 20.3 Keyboard map (Wide/desktop)

Phase-1 ships: `Tab` order per above · `Esc` close/back · `Enter` primary action ·
arrow-key row navigation in `ListRow` lists and the order-book ladder · `M` mute toggle.
`Cmd/Ctrl+K` is **reserved** for the post-launch command palette — nothing else may bind
it. A `?` overlay lists shortcuts; all shortcuts are single-key-optional (no chords
required for any action).

### 20.4 Text scaling & i18n posture

- All type in `rem`; layout survives 200% browser zoom and OS large-text without loss of
  content or function (WCAG 1.4.4/1.4.10 — reflow, no 2-D scroll except tables/charts).
- Copy externalized with ICU plurals from day one; no concatenated fragments (v1 rule).
- Phase-1 ships LTR locales; **no hardcoded direction:** logical properties
  (`margin-inline-start`, not `margin-left`) from the first component, so RTL is a
  translation project, not a refactor.
- Vocabulary keys map to Appendix A entries — a locale file cannot introduce a synonym for
  a canonical term.

---

## 21. Performance budget & CI gates

Low-end Android in a plain mobile browser is the floor; wide layouts must not smuggle in
cost. v1 §6's philosophy carries whole: route-level code-splitting, lazy-load every
non-core screen, inline SVG over raster, virtualized long lists, one shared timer source,
memoized rows, `content-visibility` for offscreen sections, optimistic UI only for safe
reversible actions, batched polls.

### 21.1 Hard CI gates

Measured on a throttled low-end-Android profile (Moto G-class: 4× CPU throttle, Slow 4G),
per `VALIDATION-BENCHMARKS.md` §2.2 / §4 action 6 — **all rows, including the three
usually forgotten:**

| Gate | Budget |
|---|---|
| LCP (p75, cold) | ≤ 2.5 s |
| **FCP** | **≤ 1.8 s** |
| **Speed Index** | **≤ 3.4 s** |
| INP (p75) | ≤ 200 ms |
| CLS | ≤ 0.1 |
| TBT | ≤ 200 ms |
| Lighthouse mobile | ≥ 90 (build fails below) |
| **Critical path total** (JS+CSS+HTML pre-LCP) | **≤ 170 KB** — the binding byte gate |
| First-load JS (gzip) | **derived**: 170 KB − measured HTML − critical CSS (working ceiling **~140 KB**; `size-limit` pinned to the derived number, not 200 KB) |
| Display font | ≤ 30 KB (§5) |

> **Why the JS gate is derived, not 200 KB:** in a client-rendered SPA the LCP element
> cannot paint until the entry JS executes, so first-load JS is pre-LCP by definition — a
> subset of the 170 KB critical-path budget. Sizing dependencies against
> VALIDATION-BENCHMARKS' 200 KB row passes `size-limit` while violating the 170 KB gate.
> The 200 KB figure applies only to first-load JS that is provably post-LCP (deferred
> non-critical chunks loaded after first paint) — and any use of that allowance must name
> the deferred chunk.

**First-paint architecture (required to make FCP ≤ 1.8 s / LCP ≤ 2.5 s reachable):** the
LCP element is **static shell content** — the app header + screen skeleton painted from
inline critical CSS and shell markup in the HTML document itself, not a post-hydration
component. Authenticated data (balances, the Overnight Tape) streams in *below* as
non-LCP content: the §14.4 “zero extra round trip” means one bootstrap fetch **after
hydration, off the LCP path** — never that data precedes paint. A pure empty-`<div>`
CSR shell cannot meet the FCP gate; the inline shell is not optional.

Chunking rules serving the gates: Tape Rail, Index/chart module, Privy/wagmi/on-ramp
SDKs, and World ID are all lazy chunks — **none are needed for the R0 core loop and none
may appear in first-load JS.**

### 21.2 Non-perf CI checks (one pipeline)

| Check | Fails the build when |
|---|---|
| Contrast matrix (§4.5 script) | any token pair drops below AA threshold |
| String-lint: gambling blacklist + banned names (`THEME-OUTFOX.md` §3) | a banned term appears in any player-facing string |
| String-lint: glossary | a UI string uses a term that collides with a canonical name (e.g. “Wallet” tab, “After Hours” outside the district) |
| Event-emission check (§22) | an instrumented flow renders in test without emitting its schema events |
| Bundle budgets | `size-limit` violations (JS, font, per-lazy-chunk caps) |
| Test matrix smoke | any cell of §21.4 fails to render |

### 21.3 Server obligations (design-adjacent backend scope)

These are commitments this spec makes that land in the backend estimate — listed so they
are planned, not discovered:

| Obligation | Consumer |
|---|---|
| Push rate-limit (5/day) + quiet-hours coalescing + morning summary composition | §14.3–14.4 |
| `last_seen` + Overnight-Tape delta computed into the session bootstrap payload | §14.4 |
| Badge count endpoint (actionable-item count) | §14.4 |
| Paymaster sponsorship caps + per-account rate limits (R1 abuse surface) — lands with the economy's sybil heuristics, not after | §10, §11 |
| Referral attribution at guest mint; milestone tranche evaluation | §15 |
| Quote locking + 24 h verify-hold + tranche scheduler + settlement monitoring/degraded-state detection | §13 |
| `/min-version` endpoint | §1.1 |
| Realtime/poll feed — one multiplexed channel or batched poll endpoint for tickers, presence, war events, foreground fills | §2.3, §14, §16, §20.1 |
| Email: transactional vs digest sending domains + warm-up plan before launch | §14.4 |
| Notification event fan-out to Discord bot | §14, §16 |
| Quest-completion verification API | §3.2 |

### 21.4 Device/surface test matrix

Every release candidate passes: **4 surface classes** (mobile browser, installed PWA,
desktop, wallet browser) × **3 breakpoints** × **2 themes** × **animation-on/off** — with
the floor device mandatory for the mobile-browser column, real-device iOS Safari
(standalone mode) mandatory for the PWA column, and a live-resize pass mandatory for
desktop. Wallet-browser column runs on real MetaMask Mobile + Robinhood Wallet builds
(their behavior is unverified assumption until then — Appendix C). The PWA column
additionally asserts: **first standalone launch resumes the Safari session** (the §17.3
iOS install-session bridge — an installed app that opens as an empty new guest is a
failing build).

---

## 22. Instrumentation

One event-naming standard: `snake_case`, prefixed by domain (`iam_`, `pay_`, `cashout_`,
`ret_`), versioned schema file in the repo, every event carrying `session_id`, `rung`,
`surface_class`, `breakpoint`. **A flow that ships without its events is a failing build**
(§21.2) — feasibility condition 3 makes measured conversion a NO-GO trigger, and the sim's
payer-mix assumption (README finding #4) is only checkable live.

**Identity:** `iam_guest_created{source: organic|referral|quest}` ·
`iam_rung_prompt_shown{trigger}` · `iam_rung_upgrade_started{from,to,trigger}` ·
`iam_rung_upgraded{from,to,elapsed_ms}` · `iam_rung_upgrade_collision{resolution}` ·
`iam_rung_upgrade_failed{stage,reason}` · `iam_rung_upgrade_abandoned{stage}` ·
`iam_siwe_started/succeeded/failed{reason}` · `iam_session_refreshed` ·
`iam_handoff_qr_shown/scanned/approved` · `iam_stepup_required/passed/failed{action}` ·
`ftue_first_call_completed{elapsed_ms}` (§10.4 acceptance).

**Payments (each with `elapsed_ms_from_intent`, `tap_count`):** `pay_intent{sku,usd}` ·
`pay_sheet_opened` · `pay_lane{balance|onramp}` · `pay_onramp_widget_loaded{provider}` ·
`pay_onramp_kyc_started/completed/failed` · `pay_tx_submitted` · `pay_tx_confirmed` ·
`pay_failed{stage,reason,provider}` · `pay_abandoned{stage,elapsed_ms}` ·
`pay_completed{sku,usd,lane,first_purchase,tap_count,elapsed_ms}`.

**Cash-out:** `cashout_capacity_viewed` · `cashout_started` ·
`cashout_quote_viewed{amount,fee,tranches}` · `cashout_wallet_link_started/completed`
(the §13 step-3 interleave) · `cashout_pop_started/succeeded/failed{provider}` ·
`cashout_submitted` · `cashout_tranche_settled{n,of}` ·
`cashout_tranche_delayed{n,delay_h}` · `cashout_abandoned{stage}`.

**Retention:** `ret_install_prompt_shown/accepted/dismissed{surface,vm}` ·
`ret_push_softask_shown/accepted/declined{vm}` · `ret_push_permission{granted|denied}` ·
`ret_ios_a2hs_sheet_shown` · `ret_badge_set{n}` · `ret_overnight_tape_rendered{items}` ·
`ret_mute_toggled{on}` · `ret_digest_sent/opened{type}` ·
`ret_referral_landing{code}` · `ret_referral_milestone{n}` ·
`ret_discord_linked` · `ret_prompt_suppressed{type,reason}` (the scheduler's audit trail).

**Derived dashboards (day one):** payer count, purchase-size distribution,
retail-vs-whale mix, conversion %, ARPPU vs the re-baselined bands (condition 5 /
kill-criteria); install→permit funnel split by platform (flip criterion, also recorded in Appendix C #3:
iOS push reach < 15% of iOS WAU ⇒ shift investment to **email** — the badge rides the
same permission as push on iOS and cannot substitute for it, §14.4); mute rate (> 50% week-1 ⇒ flip audio default);
R0 value-loss churn; friction budgets: Lane-A repeat purchase ≤ 3 taps / ≤ 8 s p50 on the
floor device, reported weekly from funnel events, not lab runs.

---

## Appendix A — Canonical UI glossary

UI copy may use **only** the terms below. Source of truth: `THEME-OUTFOX.md` §2 (frozen
mechanics vocabulary), plus the v2 coinages registered here. No synonyms in UI strings.

**From `THEME-OUTFOX.md` §2 (verbatim):** Outfox · Calls (vs players/market) · Raids (vs
the Houses — PvE only; **a Fox is never “raided” by another Fox** — PvP copy uses
*outtraded / took the other side*) · Gigs · The Street — districts: The Floor, Options
Alley, The Pit, The Dark Pool, The Vault, After Hours, The Hollow · The Houses · The
Sheriff · Nicked · Skulks (a.k.a. the Band; treasury = AUM) · Margin Called · The Open
Market · Desks · Seats · The Index · Focus / Risk Appetite · The Sim · Scrip — Settled /
Unsettled · $ALPHA · Conviction / Execution / Discipline / Edge · The Share-Out · The
Commons · Foxes.

**v2 registered coinages (this document is their source):**

| Coinage | Meaning | Introduced |
|---|---|---|
| **The Tape** | Home tab/screen | §2.4 |
| **Tape Rail** | Wide-only live rail | §2.3 |
| **Overnight Tape** | Return-visit delta summary | §14.4 |
| **TAPE HALTED** | Offline mode banner | §1.2 |
| **Ledger** (tab: “Ledger”) | The value screen (replaces “wallet” in copy) | §12 |
| **your Book** | The embedded account, R0/R1 copy | §10.1 |
| **The Clearinghouse** | Cash-out surface fiction | §13 |
| **clearing fee / clearing capacity** | Combined withdrawal fee / weekly cap (w_cap) | §13 |
| **Clearinghouse Rules** | The static limits sheet | §13 |
| **Carry** | Ledger entry/chip for the decay levers (Scrip demurrage, idle-$ALPHA holding cost) | §12 |
| **Market** | Tab-label short form of The Open Market (tab bar / nav rail only) | §2.4 |
| **Activity Log** | Event-history stack under The Tape | §14.4 |
| **Street Recap** | The weekly digest email | §14.4 |
| **foxtag** | Player handle in referral URLs | §15 |
| **Your Recruits** | Referral/invite surface (never “Your Band” — *the Band* canonically means the Skulk — and never the unregistered “Skulk-mates”) | §15 |
| **Quiet hours** | Notification window setting (never “After Hours”) | §14.4 |

**Banned in player copy:** the `THEME-OUTFOX.md` §3 lists (gambling vocabulary, theft
verbs, trademark-adjacent names, including *all-in*) — CI-enforced; plus wallet jargon at
R0/R1 (“wallet,” “keys,” “gas,” “sign,” “on-chain” — §10.1); plus *instant / anytime /
no limits / all-in* near cash-out (§13); plus **emoji anywhere in UI strings, code, docs, or assets**, and **symbol characters
doing icon work** — direction markers, the currency mark, toggle glyphs, and any other
pictographic role renders as a §6 inline-SVG mark, never as a text character. Punctuation
(the middot separator, hyphens, the % sign) is typography and stays; internal terms (Clean/Bound, w_cap, F3/F4, PoP, PLAN/GDD section numbers)
never appear in UI.

## Appendix B — v1 → v2 supersession map

| v1 section | v2 disposition |
|---|---|
| §0 Principles | 2, 3, 5 carried; 1 & 4 (Telegram primitives / theme-adaptive) superseded by §0.1 |
| §1 Telegram theme-param mapping | **Superseded** by §4 (owned theme); semantic token names carried verbatim; fallback palette promoted to primary dark palette |
| §2 Layout, safe areas & viewport | Mechanism swapped: TMA SDK → `dvh`/`svh` + `env(safe-area-inset-*)` (§2.1); thumb-zone and tab-above-inset rules carried |
| §3 Typography & spacing | Carried whole (§5); open mono-font slot resolved (Martian Mono) |
| §4 Component inventory | Carried with the §7 delta table; glossary source swapped to Appendix A |
| §5 Motion | Carried verbatim + desktop layer (§8.1) + RewardReveal restated (§8.2) |
| §6 Performance budget | Philosophy carried; acceptance harness swapped from “inside the Telegram client” to the §21 CI gates |
| §7 Haptics | Event map carried; transport swapped to Vibration API + audio substitute (§9) |
| §8 Accessibility | Carried verbatim + §20 additions (live regions, focus, keyboard, scaling) |
| §9 Open questions | Brand palette → still open (calibration values in §4); display font → **resolved**; bundle ceiling → **resolved** (170 KB critical path; first-load JS derived, working ceiling ~140 KB — §21.1) |

## Appendix C — Open-risks register

| # | Risk | Owning section |
|---|---|---|
| 1 | Robinhood Wallet in-app browser behavior is assumption until smoke-tested on real devices — strategically the most important surface | §3.1, §21.4 |
| 2 | On-ramp coverage of 4663: **verified 2026-07 (`ONRAMP-COVERAGE.md`)** — no third-party ramp settles directly; Robinhood Connect is the likely rail (inference, pending partner-docs confirmation) and requires a Robinhood account (US-KYC ↔ geofence tension); fallback two-step route likely blows the first-purchase budget. Re-check monthly; the chain is weeks old | §11 |
| 3 | iOS retention chain is fragile end-to-end (no install prompt → install-gated push → possible D1/D7 miss on iOS cohorts); instrument install→permit funnel day one, split dashboards by platform. **Flip criterion: iOS push reach < 15% of iOS WAU ⇒ shift investment to email** (not badge — iOS badging rides the same permission as push, §14.4) | §14, §17, §22 |
| 4 | Sequencer/L1-finality delay vs the Clearinghouse's dated-tranche promise; degraded state specced (§13) but monitoring must exist before real-money withdrawal enables | §13, §21.3 |
| 5 | Third-party UI seams (Privy, WalletConnect, on-ramp, World ID) vs the theme bridge — polish risk at the exact moments of maximum trust-sensitivity | §4.7, §10, §11 |
| 6 | Brand pass may fight the AA matrix — three light-theme pairs sit at the AA line (Scrip green 4.68:1, success green 4.70:1, fox orange 4.71:1); a brighter pass on any forces a two-tone strategy. Schedule the brand pass before component styling hardens and re-verify all three | §4 |
| 7 | Martian Mono ≤30 KB is estimated, not measured; fallback = cut weights/glyphs, never a second family | §5 |
| 8 | Audio-on-by-default is a taste risk; flip criterion defined (week-1 mute rate > 50%) | §9, §22 |
| 9 | Privy dependency concentration (auth + keys + orchestration); `OnrampProvider` hedges payments but there is no specced Privy exit path; MSB analysis (condition 4) could reclassify embedded-wallet custody and force architecture changes | §10, §11 |
| 10 | Paymaster sponsorship is a bot-abuse surface at R1; caps land with the economy's sybil heuristics, not after | §10, §21.3 |
| 11 | World ID Orb coverage may not overlap geofenced launch markets; KYC fallback named but unselected; dual-provider sybil-KPI accounting gets messy | §13 |
| 12 | WalletConnect Verify may flag the domain gambling-adjacent, degrading R2 linking inside major wallets; check at first testnet deploy | §10 |
| 13 | Discord as canonical social layer is a platform dependency of the kind the Telegram exit ended; mitigated (never sole carrier of actionable events) + Phase-2 re-evaluation is the exit-hatch review | §16 |
| 14 | Referral attribution cookie + reward classification touch GDPR/ePrivacy — explicitly in the Phase-0 legal scope | §15 |
| 15 | R0 guest value-loss churn is invisible without the `iam_*` cohort watch | §10, §22 |
| 16 | Quest-platform link-out assumption (Galxe/Layer3 accept on-chain/API verification) not re-verified against current docs; `frame-ancestors 'none'` makes embedding a renegotiation, not a code change | §3.2 |
| 17 | Email deliverability is earned: sending-domain warm-up before launch or the one irreversible-value email (unbonding complete) lands in spam | §14.4, §21.3 |
| 18 | Wide-layout scope creep (each list-detail screen = new QA surface ×3 breakpoints); launch scope pinned in §2.3 | §2.3 |
| 19 | Telegram-policy rationale for dropping the TMA should be re-verified by counsel if the adapter is ever revived | §3.4 |
| 20 | Outfox/$ALPHA availability checks pending; the §4.4 alias layer is the rename blast-radius containment — keep it until checks clear | §4.4, header |
