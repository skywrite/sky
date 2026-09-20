---
created: 2026-08-30
updated: 2026-09-20
---

# Tracking commands

Design notes for `src/commands/all/track/`. The mental model needed before
changing the capture loop.

The [web tracking workflow](../../../../lib/tracking/docs/README.md) owns
browser capture, corrections, shared writer locks, and recoverable Undo.

## Definitions and storage

A tracking definition is a markdown file under `tracking/active/` (or
`tracking/archived/`) with a `question:`, an `ask:` window
(`morning` / `anytime` / `evening`), `schedule:`, `category:`, and its
`columns:` (types: `time`, `number`, `duration`, `range`, `word`, `text`).

Rows are written **exactly as a hand edit would write them**, to the file a
hand edit would open:

- `storage: yearly` (default) — `data/tracking/<year>/<slug>.csv`, first field the full date.
- `storage: weekly` (explicit legacy option) — `time/<week>/_tracking/<category>/<slug>.csv`,
  one row per entry, first field the day letter (`M T W R F SA SU`).

Both carry the quoted header style (`"day", "time", "lbs (lbs)", "notes"`).
Prose-ish values (`range`, `word`, `text`) are quoted, numbers and times
bare, trailing empty fields dropped. Always append; multiplicity is a
query-time concern. Helpers: `lib/records.ts`.

Capture creates a record file with its header on the first entry. Health
summaries and checkins read annual records filtered to their date range,
including both years at New Year. They fall back to legacy weekly files
only for years without an annual file for that metric. `data:tracking`
uses the same reader and keeps the established `date,lbs` weight export.

## Moving existing records (`track:migrate`)

Run `sky track:migrate` to inspect the plan, then `sky track:migrate --execute`
to apply it. All weekly CSV categories migrate, including historical metrics
without a definition. Definitions switch to explicit `storage: yearly`.

The converter resolves the true Monday through the historical NBFS layouts,
replaces day letters with calendar dates, and groups each row by its own
calendar year. It preserves times (including extended hours), placeholder
values, notes, and repeated entries. It aligns evolving headers by name,
using definition column order and units when available. Undeclared trailing
fields survive as `extra_1`, `extra_2`, etc., with a warning. Migrated CSVs
quote every field. Existing annual records cover matching legacy occurrences
one for one; additional identical observations remain additional rows.

Malformed interior quotes stop planning. Reviewed repairs can be supplied with
`--repairs <file.json>`: an array of `{ path, before, after }`, where `path` is
notebook-relative and each exact physical `before` line must occur once.
A missing terminal quote can be closed without discarding the line's contents;
this produces a warning. This follows tracking's one-entry-per-line contract,
not general CSV with multiline cells.

Execution checks source snapshots and backs up every original file under
`data/.tracking-migration-backups/<id>/`, with a manifest. It writes and verifies
annual files before removing weekly CSVs. Definition updates follow record
writes. Non-CSV files stay in place; only empty tracking directories are removed.
An unchanged rerun is a no-op. If execution is interrupted, originals remain in
the backup and a new plan reconciles already-written annual rows. Exact repair
files apply only to their original sources; omit completed repairs on a rerun.

## Notes

- [2026-09-05 — annual tracking migration](2026-09-05-annual-tracking.md)

## The capture loop (`track:ask`)

1. Load active definitions with a question; skip ones already answered
   today; ask in the day's rhythm (morning → anytime → evening).
   A named invocation (`track:ask weight`) asks that one definition even if
   today already has a row.
2. A bare value against a single-value definition (`182`) writes without
   any model call. Anything richer (`3 mile run in the park at 6:30 am`) goes
   through one fast-model call (`prompts/parse-entry.prompt.md`,
   `lib/parse.ts`) that resolves the entry date and maps the sentence onto
   the declared columns, then a one-keystroke confirm of the exact row.
3. Parse failure falls back to per-column and date prompts, then confirmation.
   An unclear or invalid date asks for a date while keeping parsed values.
   Empty answer to the tracking question skips.
   Ctrl-C / Esc cancels the session; rows already written stay.
4. A `time` column the answer didn't state is stamped with the current time.

## Which day a row belongs to

An explicitly stated date or relative day ("yesterday", "on Monday") keys
the row and selects its annual or weekly file. Month/day dates without a
year and unqualified weekdays resolve to their most recent occurrence on
or before today. The parser returns the date separately from column values;
invalid, unclear, or missing date output requires a date prompt before writing.
Only an explicit null in the parser response means the entry stated no date.

Without a stated date, the row defaults to the **calendar day on the clock**,
in the notebook's timezone — `lib/moment.ts`. Not `fetchNow()`.

`fetchNow()` answers a different question: which notebook day is *open*. A
day stays open until the next one is started with `day:start`, so on a
morning before `day:start` it reads "yesterday, 30:12". That is right for
attributing late-night actions to the day still in progress; it is wrong
for a weigh-in taken after waking, which a hand edit keys to the new day.
Narrative: `2026-08-30-calendar-day-not-open-day.md`.

An undated entry typed after midnight but before bed lands on the new
calendar day (`SU, 1:15`). An answer can explicitly name the previous date
and use extended hours (`SA, 25:15`); the stated date and time are preserved.
