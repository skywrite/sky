---
created: 2026-08-30
updated: 2026-08-30
---

# nbfs commands

Design notes for `src/commands/all/nbfs/`. The layouts themselves — the
pattern strings, the invariant ladder, the parsers — live in
`src/_shared-ts/nbfs/` and are documented in `docs/nbfs.md`. This is about
the command that moves a tree between them.

## nbfs:migrate

Re-files `time/` into the layout `nbfs.layout` names. Dry-run by default;
`--execute` moves.

Five phases, in order:

1. **Plan.** Walk `time/`. Every directory `lib/dayDirDate.ts` reads as a
   day directory — in any layout the notebook has ever written — gets a
   target at `configured.dayDir(date)`. A day directory is one whose name
   is day-shaped and whose probe path `<dir>/day.md` reduces to exactly
   `YYYY-MM-DD/day.md` through `toTimeRef`. Whether a `day.md` exists there
   does not matter (see the 2026-08-30 note). Each moving day's week
   directory maps to `configured.weekDir` of the week's first in-year day,
   so a boundary week's files land in one place no matter which of its days
   the walk saw first.
2. **Refuse ambiguity.** Two sources for one target (two historical paths
   encoding the same date), or a target that already exists on disk, stops
   the run before anything moves. A partial or repeated run is therefore
   safe: done days are skipped, half-done states refuse.
3. **Move days.** One `rename` per day directory, contents included.
4. **Move week-level entries.** Everything in an old week directory that is
   not a day directory — `_tracking/`, `week.md`, `summary.md`, a stray
   `.DS_Store` — follows to the new week directory.
5. **Clean up.** Empty directories are removed bottom-up.

The leftover report lists markdown files that will sit outside the
configured layout after the moves: not under a moving day or week
directory, not at the `time/` root (reminders and friends live there by
design), and not classifiable by the configured layout. It is computed from
the plan, so dry-run, execute, and a no-op rerun report the same files.

Parse errors are reported, never guessed around: a `day.md` whose path no
layout can read is data damage to surface.

## Rehearsing on a copy

The layout comes from config, and config comes from `$HOME/.sky/config.jsonc`,
so a copy can run under a different layout without touching the real
notebook: copy the notebook (with its `.git`) somewhere scratch, write a
scratch home with a `.sky/config.jsonc` whose `dir` and `userDataDir` point
at the copy and whose `nbfs.layout` is the target, and run every command
with `HOME=<scratch home>`. `SKY_DIR` alone cannot do this — it overrides
the directory, not the layout.

Checks worth running on the copy before a live run: the plan's counts; a
content checksum multiset before and after (identical); every `day.md` at
its planned path; no directories left in the old shape; `git add -A`
showing renames only; a second `nbfs:migrate` reporting nothing to do;
`util:now` and `week:new --when <next Monday>` working; and a full store
build classifying every time document.
