# wiki/ — schema & conventions (the llm-wiki contract)

This is the **derived knowledge layer** of the repo, per the llm-wiki pattern (Karpathy):
LLM-maintained synthesis over the immutable source layer. It exists so that a fresh
session — human or model — orients in minutes instead of re-reading the full canon.

## The one hard rule: NON-NORMATIVE

Wiki pages are **derived, regenerable, and never authoritative**. The source layer wins
every conflict: `docs/ECONOMY.md` (priority #1), the other `docs/`, `sim/` artifacts,
code, and `PLAN.md`. Every substantive claim on a wiki page cites its canon source
(file + section, or sim artifact). If a page disagrees with canon, the page is wrong —
fix the page, log it in `log.md`.

## Conventions

- Every page ends with `as-of: <short commit>` — the repo state it was last verified
  against. A page older than the files it cites is suspect until re-linted.
- **Vocabulary:** the unified Outfox vocabulary ($ALPHA, Scrip, Outfox, the Book)
  everywhere; the retired dev-era names appear only when quoting immutable sim records,
  marked as such. (Unification: repo `CLAUDE.md`.)
- Pages are **pointers + synthesis, not copies**: link, summarize, connect — never
  paste canon paragraphs.
- `index.md` = catalog (every page, one line each). `log.md` = append-only record of
  ingests/lints/decisions, dated.

## Operations

- **Ingest (per round/commit that changes canon, docs, sim, or contracts):** update the
  touched pages + `state.md` + `index.md`; append one `log.md` line. This is part of the
  round-close discipline (see repo `CLAUDE.md`).
- **Query:** answer from wiki pages first, follow citations into canon for anything
  load-bearing. Valuable syntheses produced while answering get filed as pages.
- **Lint (on request, "wiki lint"):** check every page's claims against its cited canon
  at HEAD; flag contradictions, orphans (no inbound link from `index.md`), stale `as-of`
  markers, and gaps worth a page. Log the pass.
