---
created: 2026-08-30
updated: 2026-08-30
---

# Tracking commands

Design notes for `src/commands/all/track/`. The mental model needed before
changing the capture loop.

## Definitions and storage

A tracking definition is a markdown file under `tracking/active/` (or
`tracking/archived/`) with a `question:`, an `ask:` window
(`morning` / `anytime` / `evening`), `schedule:`, `category:`, and its
`columns:` (types: `time`, `number`, `duration`, `range`, `word`, `text`).

Rows are written **exactly as a hand edit would write them**, to the file a
hand edit would open:

- `storage: weekly` (default) — `time/YYYY/MM/<week>/_tracking/<category>/<slug>.csv`,
  one row per entry, first field the day letter (`M T W R F SA SU`).
- `storage: yearly` — `data/tracking/<year>/<slug>.csv`, first field the full date.

Both carry the quoted header style (`"day", "time", "lbs (lbs)", "notes"`).
Prose-ish values (`range`, `word`, `text`) are quoted, numbers and times
bare, trailing empty fields dropped. Always append; multiplicity is a
query-time concern. Helpers: `lib/records.ts`.

## The capture loop (`track:ask`)

1. Load active definitions with a question; skip ones already answered
   today; ask in the day's rhythm (morning → anytime → evening).
   A named invocation (`track:ask weight`) asks that one definition even if
   today already has a row.
2. A bare value against a single-value definition (`182`) writes without
   any model call. Anything richer (`3 mile run in the park at 6:30 am`) goes
   through one fast-model call (`prompts/parse-entry.prompt.md`,
   `lib/parse.ts`) that maps the sentence onto the declared columns, then a
   one-keystroke confirm of the exact row.
3. Parse failure falls back to per-column prompts. Empty answer skips.
   Ctrl-C / Esc cancels the session; rows already written stay.
4. A `time` column the answer didn't state is stamped with the current time.

## Which day a row belongs to

The row is keyed to the **calendar day on the clock**, in the notebook's
timezone — `lib/moment.ts`. Not `fetchNow()`.

`fetchNow()` answers a different question: which notebook day is *open*. A
day stays open until the next one is started with `day:start`, so on a
morning before `day:start` it reads "yesterday, 30:12". That is right for
attributing late-night actions to the day still in progress; it is wrong
for a weigh-in taken after waking, which a hand edit keys to the new day.
Narrative: `2026-08-30-calendar-day-not-open-day.md`.

Consequence to know: an entry typed after midnight but before bed lands on
the new calendar day (`SU, 1:15`), where a hand edit sometimes writes the
previous day in extended hours (`SA, 25:15`). Saying which day the entry
belongs to is not understood yet — the parser has no date output.
