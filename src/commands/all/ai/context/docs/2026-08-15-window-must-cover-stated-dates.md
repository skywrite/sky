---
status: shipped
created: 2026-08-15
updated: 2026-08-15
---

# "Since March 1 of 2025" became a one-year window

All examples synthetic — re-named and re-dated from the real prompt, which
named a person and an explicit start date more than a year back.

## Symptom

A chat opened with "look at all docs since March 1 of 2025 until now".
Context gathering printed `since: 1y` next to `dates: 2025-03-01`, the
generated query put `recent: "1y"` on every dated root, and everything
between the stated start and the 1y cutoff was silently excluded — the
oldest third of exactly the span the user spelled out. No error, no
truncation warning: the window itself was wrong.

## Root cause — three stages, one failure

1. `ai:context:date` (fast model) extracted the date perfectly but was also
   asked to do the calendar arithmetic — turn the gap (~17.5mo) into a
   covering duration — and rounded to a familiar bucket, `1y`. Fast-model
   date arithmetic is exactly the operation not to trust; the prompt's
   "choose the tightest window that covers the range" cannot make
   subtraction reliable.
2. `files.ts` consumed only `.since` and discarded `.dates` — the pipeline
   held the correct date the whole time and never looked at it.
3. `sel.ts`'s since-hint speaks only `recent:` durations, so the short
   window flowed into every dated root unchecked.

The sibling defect was fixed earlier in 8dfbd07 (user-stated sweeps must
not be volume-capped); this incident is the same failure on the window
itself rather than the limit.

## Rejected designs

- **Pass the stated date through as `dateGte`.** A lone `dateGte` is inert —
  `resolvers/shared.ts` applies the `dateGte`/`dateLte` pair only — and
  absolute-bound queries don't get the cap exemption `recent:` earns.
  Fixing both was a wider blast radius than the incident needed; recorded
  as the open landmine in the README.
- **Derive the window from the dates when `since` is unparseable.** Dates
  are a floor, not a ceiling: "my conversation with Jane on Friday" (asked
  Saturday) mentions Friday but doesn't mean look back one day. Garbage
  durations drop to all-history instead, which covers every stated date by
  definition.
- **Prompt-only fix.** Reduces the error rate but can't bound it; the
  arithmetic is exact and the code has both operands, so the guarantee
  belongs in code. The prompt example still shipped alongside to cut how
  often the guard fires.

## What shipped

- `lib/widenSince.ts` — deterministic coverage guard inside
  `ai:context:date`: `since := max(model since, gap to earliest stated past
  date + 1d)`. One-directional by design — it only ever widens, so the
  worst misfire (model hallucinates a date) over-fetches and can never lose
  context. Unparseable durations drop to all-history (they'd otherwise
  throw inside `matchesRecent` mid-query); future dates are planning
  horizons and are ignored. Day gaps use clock-free civil-calendar
  arithmetic (JS `Date` is banned repo-wide).
- One prompt rule + example for the explicit-start-date shape
  (`context-date.prompt.md`), which the examples never covered.
- Observability: every firing prints
  `widened: 1y → 533d (covers stated 2025-03-01)` in the gather transcript,
  the same place the bug was originally spotted.

## Fine-tuning corpus

Extraction failures worth an eval case:

- 2026-08-15: explicit start date ~17.5mo back → model said `1y`
  (should have been ≥`18mo`). Shape: "since <month> <day> of <year>" where
  the year is not the current one.
