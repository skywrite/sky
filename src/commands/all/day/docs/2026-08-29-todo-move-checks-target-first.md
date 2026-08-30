---
created: 2026-08-29
updated: 2026-08-29
---

# Todo move checks the target first

## What was wrong

`sky day:todo:move-future -o 29 -n 31` with no day file for the 31st failed
with "Day file does not exist … create it first with 'sky day:new'". Two
things were wrong with that. `day:new` does not exist; days are made by
`week:new`. And by the time the error printed, the source day had already
been rewritten: the sweep (`day:todo:incomplete`, which writes) ran before
the target checks, so the unfinished todos now sat under
`Professional Incomplete` with nothing moved, and a rerun after creating
the week reported "No incomplete items". The same happened when the target
day existed but had no Todos list (an ended day drops its empty lists).

## What was rejected

- **Create the missing target list**, as the commitments move does through
  `addCommitmentItem`. Rejected for this fix: it changes the command's
  contract, and the bug is the order, not the contract. The move still
  refuses a day without the list; it now refuses before writing anything.
- **Create the missing day file.** Days come from `week:new`, which stamps
  streaks and the week plan. The hint points there instead.

## Why the fix holds

Both target checks run before the sweep. After the sweep the target is read
again rather than reused from the check, because `old` and `new` may be the
same day and the sweep has just written that file; appending to the stale
copy would drop the sweep's changes.
