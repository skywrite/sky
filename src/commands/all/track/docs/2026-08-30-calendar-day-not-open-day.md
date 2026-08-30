---
created: 2026-08-30
updated: 2026-08-30
---

# A capture keys to the calendar day, not the open day

## What was wrong

Sunday, 6:12 in the morning, before `day:start`. The user runs
`track:ask sleep`, answers "10:45 pm to 6:20 am", and the confirm shows
(values synthetic):

```
Write: SA, "22:45-6:20", 7.4
```

Saturday's letter. Saturday's sleep was recorded Saturday morning; this is
Sunday's. The user cancels, tries again with "(sunday)" appended, gets the
same row, cancels again. Then `track:ask weight` — a bare number, so no
confirm — writes straight to the file:

```
SA, 30:12, 182
```

Wrong day letter, and a time nobody writes by hand for a morning weigh-in.

## Why

`track:ask` stamped its rows from `fetchNow()`. `fetchNow()` finds the last
day whose day file carries `started:` and expresses now relative to it —
extended hours, so 6:12 on a not-yet-started Sunday is "Saturday 30:12".
That is the notebook's open-day model and it is right for what it was built
for: a late-night action at 00:45 belongs to the day still in progress, and
`recap` / `summary:day` windows follow it.

A tracking row is a different thing. Every hand-kept row in the notebook is
keyed to the calendar day the author was awake in, with the wall-clock time:
morning weigh-ins at `4:35`, a rating at `6:50`, even a `3:45` weigh-in on
a short night. Extended hours appear in hand rows only for the rare
entry made after midnight *before* going to bed (`SA, 25:15`, a late
walk) — a handful of rows across years of data.

So the two models disagree exactly in the window where morning metrics are
captured: after waking, before `day:start`. And a user who never runs
`day:start` — the mainstream case — would get "last started day + N×24
hours" on every row.

## What was rejected

- **Keep `fetchNow`, run `day:start` first.** Not a rule anyone will
  remember at 6 in the morning, and unusable for a notebook without
  day files.
- **Branch on the definition's `ask:` window** — morning metrics use the
  calendar day, evening ones the open day. An `ask: evening` metric answered
  at 10:00 before `day:start` would still key to yesterday at 34:00; and a
  mode branch inside the date rule is the kind of thing that grows.
- **A fixed boundary hour** (04:00, as `recap`'s fallback uses when a day
  file has no `started:`). The data has a `3:45` weigh-in keyed to its own
  day and a `26:50` entry keyed to the day before — the same clock hour on
  both sides. Only "have I slept yet" separates them, and the tool cannot
  know that from the clock.

## Why the fix works

`lib/moment.ts`: the system clock, seen from the notebook's timezone
(`dayTimezone` of the day file for the clock's date), normalized across
midnight, hour unpadded. That is the row a hand edit writes at that moment,
for every morning and daytime entry. Pure core `captureMoment(now, tz)` is
tested for the same-zone case and both directions of a midnight crossing.

The one behavior that changes: an entry typed after midnight, before bed,
now lands on the new calendar day (`SU, 1:15`) instead of the old one in
extended hours (`SA, 25:15`). That is the rare case, and the honest one for
a tool that cannot know whether the user has slept. The natural next step —
letting the entry say which day it belongs to ("last night", "yesterday",
"on saturday"), which the user already tried by typing "(sunday)" — needs
a date output from the parser and is not built.
