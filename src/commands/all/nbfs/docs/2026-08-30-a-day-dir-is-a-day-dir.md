---
created: 2026-08-30
updated: 2026-08-30
---

# A day dir is a day dir

## What was wrong

`nbfs:migrate` planned its moves by walking for `day.md` files: find one,
take its directory, compute the target. A day directory without a day file
was invisible to the plan.

Such directories exist. Capturing into a day creates its directory — a
message filed on a Saturday nobody started, a meeting note saved for a date
`week:new` had not minted yet — and the day file only appears when the day
is started. Rehearsing the v2 flip on a copy of a real notebook turned up a
handful: a few single-document days from the early years, and one recent
day holding a journal entry, meetings, events, and messages, but no
`day.md`.

Under the old plan those directories stayed where they were, and stayed
quiet:

- not moved as a day — no `day.md`, no plan entry;
- not moved as a week-level entry — the week phase filters out anything
  day-shaped, on the assumption the day phase already took it;
- not in the leftover report when the week had other days — the report
  treats everything under a moving week directory as claimed.

After the flip the old week directory would survive with that one day
inside it, and under the new layout's parser those documents would carry no
date at all.

## The fix

The walk keys on directories. `lib/dayDirDate.ts` decides whether a
directory is a day directory, in any layout the notebook has ever written,
by probing the day file it *would* hold: `toTimeRef(<dir>/day.md)` reads a
date exactly when the surrounding path has a layout's shape, and the ref it
returns is `YYYY-MM-DD/day.md` exactly when the directory sits at day
depth. Name shape alone is not enough — a v1.1 month directory (`08`) and a
one-day week range (`01-01`) look like legacy day directories, and a
digit-named directory nested inside a real day parses to that day with a
longer subpath. Both come back null.

A `day.md` whose own path cannot be parsed is still reported as an error,
as before.

## Why not the alternatives

- *Move the stragglers by hand after the run.* Works once. The class
  recurs with every capture into an un-started day, so the next layout flip
  would strand them again.
- *Report them as leftovers and stop.* Better than silence, but the
  migration knows exactly where they go. Refusing to move a day because it
  lacks a day file makes the day file the unit — and the day is the unit.
