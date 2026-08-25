# Brief for Claude Design — Outfox

Paste or upload this whole file into Claude Design. It is the **input brief**, not canon:
`DESIGN-SYSTEM-WEB.md` remains the source of truth for the *rules* below; Claude Design
owns the **visual layer** (palette, type, spacing, component look, screen composition).
Anything it produces that breaks a HARD RULE gets reconciled back to the rules, not the
other way round.

---

## 1. What this is

**Outfox** — a mobile-first PWA game. You play a **Fox**: a rogue trader working *the
Street* against *the Houses* (the institutions). Text/stat/menu-based, deep economy,
no 3D, no scene rendering — the whole product is **screens of numbers, lists, and
decisions**, so typography, spacing, hierarchy, and restraint carry 100% of the feel.

**Tone:** neon terminal-noir. Late-night trading floor. Confident, dry, a little
outlaw — *never* casino, *never* crypto-bro, *never* cute. The player is clever, not
lucky.

**Audience & device reality:** low-end Android in a mobile browser is the performance
floor. Many players are on cheap phones. Design must look intentional at 360px wide and
degrade gracefully with animation disabled.

---

## 2. Screens to design (priority order)

1. **The Tape** — home. The core loop lives here: your Focus and Risk Appetite bars,
   the list of available **Calls** (chance actions) and **Gigs** (deterministic work),
   each with a cost, a stated success chance, a cooldown, and a result that prints
   *inline on the row you acted on* (see HARD RULE 4).
2. **The Open Market** ("Market" in the tab bar) — player-to-player listings: item,
   price in Scrip, seller. Buy / list / cancel.
3. **The Ledger** — the value screen. Balances (Settled Scrip, Unsettled Scrip,
   $ALPHA), and the transaction history with a provenance chip on every row.
4. **The Clearinghouse** — cash-out. The most sober surface in the app (see HARD RULE 5).
   Shows: amount, the clearing fee, remaining clearing capacity this week, the vesting
   countdown, and status of pending cash-outs.
5. **Checkout** — buying convenience with real money (stablecoin). Plain, honest,
   no urgency theatre.
6. Supporting: the R1 upgrade sheet (registration), empty states, offline banner
   ("TAPE HALTED"), loading/skeleton states.

**Navigation:** bottom tab bar on mobile (Tape · Market · Ledger), nav rail on wide.

---

## 3. HARD RULES — these are not stylistic preferences

Each exists for an economic, legal, or accessibility reason. Breaking one is a blocker.

1. **No emoji anywhere.** Not in UI strings, not in assets, not as icons. All icons and
   pictographic marks (direction arrows, the currency mark, toggles) are **inline SVG**
   — never a text character standing in for an icon.
2. **Vocabulary is fixed** (see §5). Use these exact terms. No synonyms.
3. **No gambling vocabulary.** Banned: bet, odds, jackpot, spin, wager, all-in, "lucky",
   casino/slot imagery, coin-flip motifs. This is a legal-exposure control, not taste.
   Chance is presented as a *judgment call with a stated probability* — a trade you
   choose to take, never a wheel you spin.
4. **Chance reveals are flat and fast: ≤320ms, constant duration, no suspense build.**
   No spinning, no drum-roll, no escalating tension, no near-miss framing, no
   celebration escalation on wins. A Call resolves; the result prints on the row. This
   is an anti-predatory-design bound — the reveal must never be the reward.
5. **No urgency or pressure near money.** Banned near cash-out and checkout: "instant",
   "anytime", "no limits", countdown timers that manufacture pressure, scarcity
   ("only 3 left!"), loss-framed nudges. The Clearinghouse should feel like a bank
   teller, not a slot lobby.
6. **No wallet jargon for new players.** Never say wallet, keys, gas, sign, on-chain,
   seed phrase, or transaction hash to a guest or newly-registered player. Their account
   is **"your Book."** (Advanced users who link an external wallet may see plain crypto
   terms — they opted into that world.)
7. **Performance budget.** Small bundle, no heavy animation libraries, no large images,
   no webfont bloat (one variable font family maximum). Everything must hold up with
   `prefers-reduced-motion` and on a 4-year-old Android.
8. **Accessibility.** Every color pair meets WCAG AA in **both** dark and light themes.
   Nothing is communicated by color alone (add a mark, a label, or a shape). Tap targets
   ≥44px.
9. **Two themes.** Dark is canonical ("the Floor at night"). Light ("daylight session")
   is flat — no glow — same geometry. Every color token must exist in both.
10. **Money is always exact and never decorated.** Integer Scrip, no fake precision, no
    animated count-ups on balances, no confetti.

---

## 4. Current visual starting point (feel free to improve on it)

Dark theme, calibration values — AA-verified but explicitly **not final brand**. A brand
pass is expected and welcome; keep contrast at least as good.

| Role | Value |
|---|---|
| App background | `#0B0E14` |
| Cards / rows | `#11151F` |
| Panels | `#161B26` |
| Hairlines / borders | `#232A3A` |
| Primary text | `#E6EAF2` |
| Secondary / hint text | `#8A93A8` |
| **Fox orange** (brand accent, primary actions) | `#FF8A3D` |
| Text on accent | `#1A0D02` |
| Destructive | `#FF5C5C` |

**Elevation is by border, not shadow.** In dark theme only, a subtle low-alpha glow is
allowed on at most three things: the primary CTA, the active tab indicator, and the
result reveal — and it must vanish under reduced-motion / low-end mode. Light theme has
no glow at all.

Token architecture (please keep this shape): raw hex lives in exactly one file; components
reference **semantic tokens only** (`--c-bg`, `--c-text`, `--c-accent`, `--space-*`,
`--radius-*`, `--font-*`). A theme switch is a single attribute write, no JS theming.

---

## 5. The vocabulary — use these words, no synonyms

| Concept | The word |
|---|---|
| The player | a **Fox** |
| Home screen | **The Tape** |
| Chance actions | **Calls** |
| Deterministic work | **Gigs** |
| Failure / caught | **Nicked** |
| The world | **The Street** (districts: The Floor, Options Alley, The Pit, The Dark Pool, The Vault, After Hours, The Hollow) |
| The antagonists | **The Houses**; enforcement is **The Sheriff** |
| Crews / guilds | **Skulks** |
| Soft currency | **Scrip** — either **Settled** or **Unsettled** |
| The token | **$ALPHA** |
| Player marketplace | **The Open Market** (tab label: "Market") |
| Value screen | **The Ledger** |
| The player's account | **your Book** |
| Cash-out surface | **The Clearinghouse** (fee = **clearing fee**; weekly limit = **clearing capacity**) |
| The decay on idle balances | **Carry** |
| Offline state | **TAPE HALTED** |
| Stats | Conviction · Execution · Discipline · Edge |
| Bars | **Focus** and **Risk Appetite** |

**One concept needs special care — Unsettled Scrip:** it's money won by *chance*, and by
design it can never be sent to another Fox, traded, or cashed out — only spent on the
Street's own services. It needs a clear, calm visual distinction from Settled Scrip
everywhere it appears (a provenance chip, a distinct treatment — not just a different
color, per HARD RULE 8). This distinction is load-bearing: it's what keeps chance
winnings away from real money.

---

## 6. What to deliver

- A **token set** (both themes) — color, type scale, spacing, radii, and the motion
  values that survive rule 4 and rule 7.
- A **component inventory**: buttons, list rows, action rows (with inline result),
  bars/meters, chips (incl. the provenance chip), sheets/modals, tab bar + nav rail,
  banners, empty states, skeletons, number/currency display.
- **Screen compositions** for the six surfaces in §2, at 360px and a wide breakpoint.
- Notes on anything you'd change about the starting palette and why.

If a rule in §3 seems to be fighting a good design decision, say so explicitly rather
than quietly bending it — some of those rules are load-bearing for reasons outside
design, and the trade needs to be made deliberately.
