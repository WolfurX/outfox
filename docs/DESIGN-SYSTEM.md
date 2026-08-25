# Design System — "MEMPOOL"

> **SUPERSEDED for the standalone client.** With the Robinhood Chain pivot, the active
> design system is **`DESIGN-SYSTEM-WEB.md`** (v2 — Outfox standalone PWA). This document
> remains the archived TON/Telegram-track spec: its type scale, spacing, motion, component
> inventory, perf philosophy, and a11y baseline carry into v2 (see v2 Appendix B for the
> exact supersession map); its Telegram bindings (§1 theme params, §2 TMA viewport/safe
> areas, §7 SDK haptics) do not.

> **Status:** Phase 0 draft. Defines the visual + interaction contract for the Telegram Mini
> App UI. Implements the GDD's **pillar #3 (deep systems, light to render)** and **pillar #5
> (convenience, never power)** at the UI layer, and honors **`PLAN.md` Confirmed Decision #2**
> (custom-branded UI on Telegram primitives, *not* stock `telegram-ui`) under the
> non-negotiable **low-end-Android performance budget** (`PLAN.md` §3).

---

## 0. Principles

1. **Custom-branded, built on Telegram primitives.** We own the visual identity but ride
   Telegram's theme params, safe areas, viewport, and haptics so the app feels native and
   themes correctly. We do **not** adopt stock `telegram-ui` components — they read as
   generic.
2. **Performance is a design constraint, not an afterthought.** Telegram WebView on a cheap
   Android is *the* target device. Every design decision is checked against the perf budget
   (§6). When beauty and frame-rate conflict, frame-rate wins.
3. **Menu/stat-based, not scene-rendered.** Torn-style lists, tables, and panels — cheap to
   render, infinitely deep in content. No heavy 3D/canvas in the core loop.
4. **Theme-adaptive by default.** The UI must look correct in any Telegram theme (light/dark/
   custom) by mapping to theme params, with brand accents layered on top.
5. **Tactile.** Haptics + micro-motion give a text-based game "game feel" — but every motion
   is disableable for low-end devices and reduced-motion users.

---

## 1. Telegram theme-param mapping

Source of truth is Telegram's `themeParams` (via `@telegram-apps/sdk-react`). We map them to
semantic design tokens; **components reference tokens, never raw params.** Always provide a
brand fallback for params that may be missing.

| Semantic token | Telegram theme param | Fallback (brand) | Usage |
|---|---|---|---|
| `--c-bg` | `bg_color` | `#0B0E14` | App background (the "terminal" base) |
| `--c-bg-secondary` | `secondary_bg_color` | `#11151F` | Cards, list rows, grouped sections |
| `--c-bg-section` | `section_bg_color` | `#161B26` | Section containers / panels |
| `--c-section-header` | `section_header_text_color` | `#7A8499` | Section header labels |
| `--c-text` | `text_color` | `#E6EAF2` | Primary text |
| `--c-text-hint` | `hint_color` | `#7A8499` | Secondary/hint text |
| `--c-link` | `link_color` | `--c-accent` | Links |
| `--c-accent` | `button_color` | `#3DDC97` | Primary actions, brand accent |
| `--c-accent-text` | `button_text_color` | `#04130C` | Text on accent |
| `--c-destructive` | `destructive_text_color` | `#FF5C5C` | Destructive/danger actions |
| `--c-header-bg` | `header_bg_color` | `--c-bg` | App/header chrome |

**Brand-semantic tokens** (NOT from Telegram — fixed across themes, used sparingly so they
stay readable on any base): `--c-credits` (Credits ¢), `--c-token` ($VIG), `--c-compute`
(Compute/E bar), `--c-nerve` (Nerve bar), `--c-heat`/`--c-danger` (Traced/Quarantine states),
`--c-success`, `--c-warning`. Define each with a light- and dark-base variant and pick by the
resolved theme's luminance.

> **Rule:** read params reactively (Telegram can change theme at runtime) and update CSS custom
> properties on `:root`. Never hardcode hex in components — only token references.

---

## 2. Layout, safe areas & viewport

- **Viewport:** use the SDK's viewport API; treat `viewportStableHeight` as the layout height
  (avoid the unstable value during keyboard/expansion animations).
- **Full-screen TMA 2.0:** request expanded/full-screen for an immersive game surface; handle
  the dynamic header.
- **Safe areas:** respect `safeAreaInset` / `contentSafeAreaInset` for notches, the Telegram
  header, and the home indicator. The bottom tab bar sits **above** the bottom inset; primary
  content never hides under system chrome.
- **Single-column, thumb-reachable:** primary actions in the bottom third of the screen.
  Target one-handed play.

---

## 3. Typography & spacing scale

**Type** — system font stack (zero web-font download; perf budget §6):
`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`. Optionally a **single**
subset monospace for numeric/ledger values (balances, stats) — lazy-loaded, with a system-mono
fallback; never block first paint on it.

| Role | Size / line-height | Weight |
|---|---|---|
| Display (rare, screen titles) | 28 / 34 | 700 |
| H1 (section title) | 22 / 28 | 700 |
| H2 | 18 / 24 | 600 |
| Body | 15 / 22 | 400 |
| Body-strong / numeric | 15 / 22 | 600 (tabular-nums for ledgers) |
| Caption / hint | 13 / 18 | 400 |
| Micro (labels, badges) | 11 / 14 | 600, +tracking |

**Spacing** — 4px base scale: `2, 4, 8, 12, 16, 20, 24, 32, 40`. Use tokens
(`--space-1 … --space-9`), not raw px. Card padding 16; list-row vertical 12; section gap 24.

**Radii:** `--radius-sm 8`, `--radius-md 12`, `--radius-lg 16`, `--radius-pill 999`.
**Elevation:** prefer borders/`--c-bg-section` contrast over shadows (shadows are GPU-cheap but
read poorly on dark themes); at most one subtle shadow token.

---

## 4. Component inventory

Custom components, theme-token-driven. Each must render correctly in light/dark/custom themes
and meet the perf budget. (Maps to the GDD core screens.)

**Primitives:** `Button` (primary/secondary/destructive/ghost), `IconButton`, `TextField`,
`NumberStepper`, `Toggle`, `Tabs`, `Chip/Badge`, `Tag`, `Avatar`, `ProgressBar`, `Skeleton`,
`Spinner`, `Divider`, `Toast`, `Sheet` (bottom sheet), `Modal`, `EmptyState`.

**Layout:** `Screen` (safe-area + viewport aware shell), `Section` (uses `--c-bg-section` +
section header), `ListRow` (icon · label · value · chevron — the Torn workhorse), `Card`,
`KeyValueRow`, `StatRow`, `BottomTabBar`.

**Game-specific:**
- `ResourceBar` — Compute (E) / Nerve, with regen countdown + refill CTA.
- `BalancePill` — Credits (¢) and $VIG, color-coded (`--c-credits` / `--c-token`).
- `StatBlock` — the four core stats with train CTA.
- `ActionListItem` — an Exploit/Job: name, cost (Nerve), success %, reward range, cooldown.
- `MarketOrderRow` — order-book row (price / qty / side), buy/sell affordances.
- `CountdownTimer` — regen / cooldown / Quarantine / vesting timers (1 shared ticking source).
- `SyndicateBanner`, `LeaderboardRow`, `OperationCard`, `WalletPanel` (TON Connect state).
- `RewardReveal` — the variable-ratio payout reveal (see §5; respects reduced-motion; **never**
  styled as a real-money slot machine — pays Credits only, per `ECONOMY.md` §6 guardrail).

> **Consistency rule:** currency, resource, stat, and system names in UI copy come **only** from
> the GDD glossary — **§2.1** (Credits, $VIG, Compute, Nerve, Exploit, Syndicate, Operation,
> Market, Network, Safehouse, Exchange) and **§4.1** (the four stats: Cracking, Latency,
> Hardening, Stealth). No synonyms in UI strings.

---

## 5. Motion spec

- **Target: 60 fps.** Animate **only** `transform` and `opacity` (GPU-composited). Never
  animate layout properties (`width`/`height`/`top`/`left`) in the core loop.
- **Durations:** micro 120ms, standard 200ms, emphasis 320ms. **Easing:** standard
  `cubic-bezier(0.2, 0, 0, 1)`; entrance decelerate, exit accelerate.
- **Where motion is used:** tab/screen transitions (slide+fade), sheet/modal present, button
  press (scale 0.97), `RewardReveal`, `ResourceBar` fill, toast in/out.
- **`RewardReveal`:** short, snappy, satisfying — but **not** slot-machine theatrics
  (regulatory posture, `ECONOMY.md` §8).
- **Animation-disable toggle (non-negotiable, `PLAN.md` §3):** a user setting + automatic honor
  of `prefers-reduced-motion`. When off, all transitions resolve to instant state changes with
  zero animation cost. Default to **on** for capable devices; auto-suggest off if frame drops
  are detected.

---

## 6. Performance budget (non-negotiable)

The hard gate from `PLAN.md` §3 — Telegram WebView on low-end Android (Catizen's bar):

- **Bundle:** small initial JS/CSS; **route-level code-splitting**; lazy-load every non-core
  screen (Exchange, Operations detail, Syndicate war, etc.). Set and enforce a max
  initial-bundle KB budget in CI.
- **Assets:** millisecond-tier load. Prefer **inline SVG / CSS** over raster; sprite/atlas any
  icons; no large images in the core loop; lazy-load below-the-fold media.
- **Fonts:** system stack → **zero font download** on the critical path (§3).
- **Runtime:** virtualize long lists (Market, leaderboards); one shared timer source for all
  countdowns (no per-row intervals); memoize rows; avoid reflow-thrashing.
- **Rendering:** 60 fps via transform/opacity only (§5); `content-visibility` for offscreen
  sections; debounce/throttle scroll & input handlers.
- **Network:** server-authoritative state over a lean API; optimistic UI only for safe,
  reversible actions; batch polls; respect the 8GB dev rule (mock services locally).
- **The toggle:** animation-disable mode must drop the app to a near-static, minimal-cost
  render path on weak devices.

**Acceptance (UI verification, ties to `PLAN.md` Verification):** core screens hold the
60 fps / fast-load budget on a low-end Android device **inside the Telegram client** (not a
desktop browser), and respect theme params + safe areas.

---

## 7. Haptics map

Via the SDK haptic API — used deliberately for game feel, debounced, and skipped when
reduced-motion/low-power is active.

| Event | Haptic |
|---|---|
| Primary button press | impact `light` |
| Successful action / Exploit success | notification `success` |
| Failed action / Traced / error | notification `error` |
| Warning (low Compute/Nerve, risky action) | notification `warning` |
| Tab switch / selection change | selection-changed |
| Reward reveal (tier-scaled) | impact `light`→`medium`→`heavy` by reward tier |
| Destructive confirm | impact `rigid` |

> Haptics are an enhancement layer only — never the sole signal for any state (accessibility).

---

## 8. Accessibility & internationalization (baseline)

- Respect `prefers-reduced-motion` and the in-app animation toggle.
- Maintain WCAG-AA contrast against **all** theme bases (verify token pairs in light/dark).
- Minimum 44×44px touch targets; visible focus/pressed states.
- All copy externalized for future localization; never concatenate translated fragments.
- Never rely on color alone to convey state (pair with icon/label) — matters for the
  Credits/$VIG and success/danger distinctions.

---

## 9. Open questions

- Final brand palette & logo (the `--c-accent`/brand tokens here are placeholders).
- Whether to ship a single optional brand display font (weighed against the font-download
  perf cost) for screen titles only.
- Exact initial-bundle KB ceiling (set during Phase-1 scaffolding once the stack is real).
