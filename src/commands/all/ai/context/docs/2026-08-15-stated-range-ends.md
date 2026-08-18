---
status: shipped
created: 2026-08-15
updated: 2026-08-15
---

# "Mid-March through June 1" ran to now anyway

All examples synthetic — re-dated from the real prompt, a journals question
over a closed historical range.

## Symptom

A chat asked for journals "from mid-March through June 1", months in the
past. Extraction pulled both endpoints perfectly (`dates: 2026-03-15,
2026-06-01`) and the start-coverage guard widened the lookback correctly —
but the generated query said `recent: "153d"`, a window that by definition
closes at **now**. Everything between the stated end and today leaked in.

Worse, the two layers compound: the s3 recency prior ranks the leaked tail
*highest* (it is the newest), so under budget pressure the docs the user
explicitly excluded outrank the window they actually asked about.

## Root cause

The pipeline had no vocabulary for a closed range:

1. `ai:context:date`'s schema had `since` (a trailing lookback) and `dates`
   (points) — no slot for "the range stops here". The model extracted the
   end date and had nowhere to put it.
2. `sel.ts`'s hint spoke only `recent:`, which cannot express an end.

## Rejected designs

- **Infer the range from the dates in code.** Two extracted dates do not
  imply a range — "check the Feb 18 and Feb 24 threads" is two points, and
  closing the window at the later one would drop everything after it. The
  range/points distinction is linguistic, so the extraction model must make
  it; code cannot do so safely.
- **Keep `recent:` and let scoring handle the tail.** The leak is a
  correctness error, not a ranking error — the user excluded those dates.
  And the recency prior actively prefers the leaked docs, so ranking makes
  it worse, not better.

## What shipped

- `ai:context:date` gains `until`: the stated end in YYYY-MM-DD, "" when
  the range runs to now. Two point-dates are explicitly not a range; a
  future end is a planning horizon and is dropped (same rule as `since`).
- The coverage guard (`lib/widenSince.ts`, now `resolveWindow`) goes
  symmetric: the window is [today − since, until ‖ today] and every stated
  past date must lie inside it — the start widens (existing) and the end
  extends to the latest stated date when one falls beyond it. Still floors,
  never ceilings.
- `sel.ts` hint: with an end present, dated roots get a
  `dateGte`/`dateLte` pair instead of `recent:` — the pair filters and is
  cap-exempt as of the one-ended bounds fix, which this rides on. The hint
  explicitly bans `recent` in range mode, since it would re-open the window.
- End-only ranges ("everything before X") emit a lone `dateLte`, which
  filters correctly but keeps the default cap (open toward the corpus
  start); truncation is reported, not silent.

## Fine-tuning corpus

Extraction failures worth an eval case:

- 2026-08-15: closed range stated ("mid-X through Y") → old schema forced
  the end to be discarded; with `until` in the schema the shape needs
  eval coverage for "in <month> <year>" (a month alone ends on its last
  day) and "between X and Y".
- 2026-08-15 (live, post-ship): "<month> 1 through <month> 1 of this year"
  → the duration guess landed ~2.5 months short of the stated start; the
  guard widened it and the pair hint held the stated end. The range shape
  works end-to-end, but the model's duration arithmetic stays unreliable —
  the guard is load-bearing, not a safety net.
- 2026-08-15 (live): bare-year membership ("tell me something from
  <year>") → the model extracted BOTH boundary dates yet left `until`
  empty, so the window ran to now — "from <period>" pattern-matched the
  open-start reading. Fixed with the closed-period prompt rule plus an
  explicit `from` field (the start became statable, not re-derived); no
  code heuristic closes a window from a boundary-looking date pair — the
  "compare Jan 1 vs Dec 31 and how things changed since" shape wants it
  open, and a wrong ceiling loses context where a wrong floor only adds.
