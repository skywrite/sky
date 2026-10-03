---
created: 2026-10-03
updated: 2026-10-03
---

# Start moves onto the day

## What was wrong

The only way to start a day on the web was a row inside This week. The
sidebar showed a dot and "Friday not started", and the Start button sat
beside Friday in the week's Days block. On the morning after a late night,
Today still opened the day left open, the real date was listed as
"Tomorrow", and nothing on either page offered to start it. Finding Start
meant knowing it lived on the week page.

## What was considered

- Letting a day start and close by itself: the first act after hours away
  starts the new day, and a tidied-up day closes itself. Agreed as the
  direction for people who never learned the notebook's start and end, and
  parked. Manual start and end stay for now.
- Naming the days in the sidebar while the clock and the calendar disagree
  ("Thursday · still open", "Friday · not started"). Mocked and cut: the ask
  was the buttons only.
- Listing what stands between a past day and its end on that day's page,
  with each row's action. Mocked and cut for the same reason.
- Ending the previous day when the next one starts. Rejected: the previous
  day usually still needs its meeting notes and imports, so it stays open
  until End is pressed.

## Why the fix works

Start now shows wherever the waiting day is on screen: a whisper under the
open day's count at night, a block at the top of its column from 04:00, and
"Not started" with Start on the waiting day's own page. The week page keeps
a quiet Start. The day view names the waiting day (`due`) from the notebook
clock, so the pages do no clock arithmetic of their own, and 04:00 reuses
the boundary recap already assumes for a day with no start. A late night
and a morning differ only in how loudly the page speaks, and nothing starts
without a press. The button runs `day:start` for that day, as the week page
does. The shell then re-reads today, the week and the clock, and opens
Today, which is the started day.
