# art/

Asset staging for the PWA's imagery (prompts: `docs/ART-PROMPTS.md`).

- **`raw/` — the dump zone (gitignored).** Drop AI generations here as-is, any
  amount, any names. Nothing in it enters git history, so dump freely.
- Curated picks get cleaned up, exported at real sizes (icon 512/192/48, etc.),
  and wired into the app tree (`apps/web/public/`) as a build task — those are
  committed, raws are not.

Naming hint for raws (optional, helps sorting): `01-mascot-a.png`,
`02-icon-b.png`, … matching the prompt numbers in `docs/ART-PROMPTS.md`.
