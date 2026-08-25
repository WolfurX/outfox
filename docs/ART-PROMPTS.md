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
