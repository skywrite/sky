---
created: 2026-09-19
updated: 2026-09-19
---

# The run count leaves the day file

A streak's run was always counted from the day files. A struck item in a
day's `## Streaks` list is a completion, and `computeStreakStats` walks the
days to find the current and best runs. No rule document ever held a
counter.

One number was still written down. Each morning `day:start` stamped the
run after every unstruck title: `- Eat clean — 12d`. Striking the item
froze that text into the day's record: `- ~~Eat clean — 12d~~`.

## What was wrong

- The number was a day behind. It was the run through yesterday, so the
  struck `— 12d` sat on the day the run reached 13.
- The number went stale. Marking a missed day later changes every run
  after it. Struck items are never rewritten, so every later frozen number
  stayed wrong.
- Two writers disagreed. The app inserts the bare title on a check-in.
  `day:start` wrote the title with a count. Day files ended up mixed.
- The day file was rewritten every morning to refresh a number nobody had
  typed.

A derived number does not belong in the record. The record is the strike.

## What changed

`stampStreaksList` adds a missing item as the bare title and never
rewrites an existing one. `day:start` no longer computes counts.
`StreakDocument.formatDayItem` is gone. The run is shown where it is
computed: the Streaks page, the day page, `streaks:list`, and the line
`streaks:done` prints.

Older day files keep their stamped counts. They are history, and nothing
sweeps them. `parseDayItemTitle` still strips a trailing ` — Nd`, so those
items keep matching their rule. For the same reason a new title may not end
in a count: the app refuses it, and the format prompt steers away from it.
If the old files are ever swept, the strip and the title rule can go
together.

## What was rejected

**A counter kept somewhere else.** A number that goes up on each check-in
has the same fault as the stamped one, only hidden. Striking the line by
hand in an editor is a first-class way to check in. A counter never sees
that edit, so it drifts from the files.

**A cache of the day files.** Not needed yet. The walk reads one small
`day.md` per day and its cost grows with the number of days. If a report
gets slow, keep each day's parsed Streaks items in the state dir, keyed by
the day file's modification time. That is a memo of what the files say. It
can be deleted at any time and rebuilt from the files. The current run
alone needs no cache at all: walk back from today and stop at the first
missed day.
