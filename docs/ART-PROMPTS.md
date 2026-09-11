# Art generation prompts (working doc, not canon)

Prompts for generating the PWA's first image assets with an AI generator (Grok
Imagine or similar). Style constraints derive from `THEME-OUTFOX.md` §1/§3/§6 and
the shipped palette (`apps/web/src/tokens/palette.css`). Each prompt below is
**self-contained** — copy one whole block per generation, nothing to assemble.

## Workflow

1. Generate **#1 (the mascot) first**. Pick the best result, then attach it as the
   image reference for every other prompt — that keeps the fox the same character.
2. Request the **largest PNG** the tool offers. Aspect ratio is noted per prompt.
3. **Never put the game name or ticker in a prompt** (AI text renders as gibberish;
   wordmarks are done in vector, in-house).
4. Reject any result that shows: a soft rounded Disney-style fox, hats/caps, bow or
   arrows, medieval clothing, gambling props (dice, chips, slots, cards), real-firm
   logos, or accidental text/lettering.
5. Drop finished files anywhere in the repo (e.g. `art/raw/`) — wiring them in
   (manifest icons, favicon, FTUE slot) is a build task.

Note: the in-app jacket-color cosmetic line needs a **layered SVG** later; these
rasters are character canon + FTUE/marketing art. A simplified SVG fox gets traced
from the chosen #1.

---

## Tier 1 — must-have

### 1. The mascot — master reference (1:1)

```
Character design of a sly adult fox standing upright, lean and angular with sharp
modern geometric features, confident smirk, half-lidded knowing eyes. Wearing a
tailored charcoal-navy trader's jacket with sleeves pushed up and a loosened dark
tie, hands in pockets. Pose: relaxed, cocky, looking slightly over its shoulder at
the viewer. Full body, centered, plain dark background. Modern flat mascot style —
NOT a medieval or fairy-tale fox, no hat, no cape, no bow, no arrows.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading, subtle neon glow. Terminal-noir trading floor world at night.
Palette: deep ink navy-black background (#0B0E14), vivid fox-orange accents
(#FF8A3D, #F1731C), cool slate blue-greys (#55607A, #ABB4C6), soft indigo glow
(#9DA8F5), small green (#3DD68C) and red (#FF5C5C) ticker accents.
High contrast, no photorealism, no text, no letters, no numbers, no watermark.
```

### 2. App icon — fox head mark (1:1 → maskable PWA icon + favicon)

```
Minimal app icon: a fox head mark, front-facing, built from sharp geometric shapes —
angular ears, narrow sly eyes, pointed muzzle. Fox-orange head on a deep ink
navy-black rounded square. The head fills the center 70% of the canvas with even
margin all around (safe zone for masking). Flat, bold, readable at 48 pixels.
One single subject, no background scene.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading. Palette: deep ink navy-black (#0B0E14), vivid fox-orange
(#FF8A3D, #F1731C). High contrast, no photorealism, no text, no letters,
no numbers, no watermark.
```

### 3. FTUE onboarding beat (4:5 portrait)

```
A sly angular fox in a charcoal-navy trader's jacket stands on a neon trading floor
at night beside a glowing terminal, turning back toward the viewer with a grin, one
hand gesturing an invitation to the empty seat at the screen. Rows of blurred ticker
displays glow orange and indigo in the dark behind it. Mood: sporting defiance, an
underdog inviting you into the game — not crime, not danger. Wide shot, fox on the
right third.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading, subtle neon glow. Terminal-noir trading floor world at night.
Palette: deep ink navy-black background (#0B0E14), vivid fox-orange accents
(#FF8A3D, #F1731C), cool slate blue-greys (#55607A, #ABB4C6), soft indigo glow
(#9DA8F5), small green (#3DD68C) and red (#FF5C5C) ticker accents.
High contrast, no photorealism, no text, no letters, no numbers, no watermark.
```

---

## Tier 2 — item cards + empty state

### 4. Terminal Mk I — item card (1:1)

```
A single sturdy retro-futuristic trading terminal: chunky CRT-style monitor with a
soft orange chart glow on screen (abstract line only), thick mechanical keyboard,
scuffed metal casing with one fox-orange stripe. Three-quarter view, floating
centered on a plain dark ink background like a game item card. Sturdy, honest,
first-rig energy.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading, subtle neon glow. Palette: deep ink navy-black background
(#0B0E14), vivid fox-orange accents (#FF8A3D, #F1731C), cool slate blue-greys
(#55607A, #ABB4C6), soft indigo glow (#9DA8F5). High contrast, no photorealism,
no text, no letters, no numbers, no watermark.
```

### 5. Signal Booster — item card (1:1)

```
A single handheld signal booster device: compact matte-dark box with a short antenna,
glowing indigo signal waves rising off it, one fox-orange dial and a small green
status lamp. Three-quarter view, floating centered on a plain dark ink background
like a game item card. Precise, technical, clean-signal energy.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading, subtle neon glow. Palette: deep ink navy-black background
(#0B0E14), vivid fox-orange accents (#FF8A3D, #F1731C), cool slate blue-greys
(#55607A, #ABB4C6), soft indigo glow (#9DA8F5), small green (#3DD68C) accents.
High contrast, no photorealism, no text, no letters, no numbers, no watermark.
```

### 6. Empty state — the floor after hours (1:1)

```
An empty trading floor at night, rows of dark terminals with a few screens still
glowing faint orange and indigo, papers on the floor, one distant window with city
lights. Quiet, calm, waiting-for-the-bell mood. No people, no animals. Muted, low
light, mostly ink navy-black.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading, subtle neon glow. Palette: deep ink navy-black background
(#0B0E14), muted fox-orange accents (#F1731C), cool slate blue-greys (#55607A,
#ABB4C6), soft indigo glow (#9DA8F5). High contrast, no photorealism, no text,
no letters, no numbers, no watermark.
```

---

## Tier 3 — optional flavor

### 7. The Nicked state (1:1) — the enforcer stays OFF-SCREEN (its design is not canon yet)

```
A sly angular fox in a charcoal-navy trader's jacket frozen mid-step in a harsh cold
white-blue spotlight from above on a dark trading floor, caught, hands half-raised,
rueful grin. Everything outside the spotlight falls to near-black with faint red
ticker glow. The pursuer is not shown. Mood: caught by the referee, sporting
embarrassment — not arrest, not violence.

Flat 2D vector-style illustration, bold clean geometric shapes, sharp silhouettes,
minimal shading, subtle neon glow. Palette: deep ink navy-black background
(#0B0E14), fox-orange (#FF8A3D, #F1731C), cool slate blue-greys (#55607A, #ABB4C6),
faint red (#FF5C5C) accents. High contrast, no photorealism, no text, no letters,
no numbers, no watermark.
```

---

## Tier 4 — item set, currency marks, emblems (generated 2026-09-11, Grok Imagine)

Batch-generated headlessly (`grok -p`, one prompt per batch, N numbered subjects +
the shared style block below). Grok edit-chains from its first result, so a batch
comes out as one matching set; it also iterates on its own (18 files for 8 items),
so every raw was viewed and picked by content. Raws: `art/raw/2026-09-11-*/`
(gitignored). Curated 512² webp in `apps/web/public/art/`.

**Shared style block (append verbatim to every batch — this is what keeps the sets
consistent with the Tier 2 cards):**

```
Style for every image, identical across the whole set: flat 2D vector-style
illustration, bold clean geometric shapes, sharp silhouettes, minimal shading, subtle
neon glow. Plain flat deep ink navy-black background (#0B0E14), nothing else in the
background. Object bodies in cool slate blue-greys (#55607A, #ABB4C6) with one vivid
fox-orange accent (#FF8A3D, #F1731C), a thin soft indigo glow outline (#9DA8F5) around
the object, a few tiny green (#3DD68C) and red (#FF5C5C) pixel ticker specks floating
beside it, a soft dark shadow beneath. High contrast, no photorealism, no text, no
letters, no numbers, no logos, no watermark, no people, no animals.
```

Batch framing lines: items = "single object, three-quarter view, floating centered
like a game item card, filling about 70 percent of the canvas"; coins = "single object
centered, face-on with a slight tilt, filling about 65 percent, readable at 48 px";
emblems = "flat circular badge: slate disc, thin indigo glow ring, ONE bold fox-orange
symbol, disc filling about 85 percent of the square, readable at 48 px. Generate
directly at that framing; do not crop, resize or post-process with code." (Without the
last sentence grok tried to crop "in code", was denied the tool, and quit after one
image.)

### 8. Item set (1:1) — `item-<proposed kind>.webp`

Kinds marked *staged* do not exist in `ITEM_KINDS` yet; the file name is the proposed
slug, so wiring is adding the kind. Subjects, in prompt order:

| File | Subject | Fiction slot |
|---|---|---|
| `item-terminal_mk2` | two sleek flat monitors on one stand, orange charts, two orange stripes | upgraded rig (*staged*) |
| `item-tape_reel` | chunky reel of paper ticker tape, orange rim, tape unspooling | Run the Tape gig tool (*staged*) |
| `item-rumor_pager` | matte pager, orange waveform screen, green lamp, belt clip | Front the Rumor tool (*staged*) |
| `item-thin_book` | slim dark ledger, orange page edges, slate clasp | Squeeze the Basket tool (*staged*) |
| `item-focus_flask` | brushed-steel thermos, orange band, tiny green gauge | Focus refill consumable (*staged*) |
| `item-exchange_seat` | dark leather stool on slate pedestal, blank orange plaque | Seat on the Exchange (*staged*) |
| `item-prop_desk` | slate desk, three screens orange + indigo, chair tucked | Desk (*staged*) |
| `item-trader_jacket` | charcoal-navy jacket on a hanger, orange lining, sleeves pushed up | cosmetic line thumb (*staged*) |

Rejections in the raws: rig v1 rendered number-like glyphs beside the screens (the
ticker specks drifted into text); jacket v1 lacked the pushed sleeves; pager v1 showed
a chart instead of a waveform; seat v2 lost the glow outline.

### 9. Currency marks (1:1) — `coin-*.webp`

Reference art for the brand-semantic glyphs (DESIGN-SYSTEM-WEB §6: the in-app Scrip and
$ALPHA marks are SVG; these rasters are the marketing/reference forms, and
`coin-alpha` is the candidate token logo for the mint metadata).

| File | Subject |
|---|---|
| `coin-scrip-settled` | slate coin, green (#3DD68C) rim glow, embossed ticker-ribbon emblem with an orange tail |
| `coin-scrip-unsettled` | same coin as a hazy indigo (#9DA8F5, the `--haze` token) ghost with a dashed outline |
| `coin-alpha` | fox-orange coin, embossed geometric fox head (angular ears, sly eyes) |
| `coin-scrip-stack` | short stack of the green-rimmed coins, low three-quarter angle (grok could not hold "five"; the stack is ~8) |
| `coin-scrip-roll` | rolled pale scrip notes, orange band, green wax seal |

### 10. Emblems (1:1) — `emblem-<slug>.webp`

Place and faction badges: slate disc, indigo ring, one fox-orange symbol. Reference
art for section marks, empty states and the SVG sprite (in-app icons stay inline SVG
per DESIGN-SYSTEM-WEB §6; these are not to be dropped into `ListRow`s as rasters).
Grok needed two runs (see the framing note above) and 26 raws for 16 keepers.

| File | Symbol | Slot |
|---|---|---|
| `emblem-floor` | opening hand bell | The Floor |
| `emblem-options_alley` | forked arrow sign | Options Alley |
| `emblem-pit` | concentric stepped rings | The Pit |
| `emblem-dark_pool` | still pool with one ripple under a crescent, indigo | The Dark Pool |
| `emblem-vault` | round vault door with spoked wheel | The Vault |
| `emblem-after_hours` | crescent over a lit window | After Hours |
| `emblem-hollow` | burrow under tree roots, warm light inside | The Hollow |
| `emblem-houses` | bloated monolithic tower on columns | The Houses |
| `emblem-sheriff` | cold white-blue star badge in a spotlight | The Sheriff |
| `emblem-skulk` | three fox tails in a ring | Skulks |
| `emblem-commons` | open hand holding a coin | The Commons |
| `emblem-clearinghouse` | stamped seal with checkmark and ribbon | The Clearinghouse |
| `emblem-tape` | curling ribbon of ticker tape | The Tape |
| `emblem-open_market` | stall awning over a ledger book | The Open Market |
| `emblem-gigs` | wrench crossed with screwdriver | Gigs |
| `emblem-index` | rising jagged chart line with arrow head | The Index |

Rejections in the raws: a bell grok pasted onto a white canvas while trying to
"enlarge" it; a generic bank-temple for the Houses (too Wall-Street-real, the bloated
tower reads as the fictional mega-fund); a film-strip reading of the tape; a burrow
without roots; a six-point ice crystal for the Sheriff (the star-in-spotlight kept).
