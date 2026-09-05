---
created: 2026-09-04
updated: 2026-09-04
---

# The week page

Design notes for `src/service/handler/week/` and the page that drives it,
`theme/client/week.tsx`. The week is the notebook's unit of planning: the
week directory, the seven day files, `week.md`, `checkins.md`. This page
shows it, and moves the two things a week needs moving: a day that is
waiting to start, and what is waiting for the week after.

## Getting there

The sidebar's Days list has a Week list under it with two entries, This
week and Next week. This week's stamp is the week's number, or, when a day
is waiting to be started, that day's name and "not started" with a dot; on
a phone the menu button carries the dot. The page is `/week`, or
`/week/2026-W36` for any week by its id; the header steps back to Last week
from this week, and back to This week from any other.

## What time it is

The page asks the notebook clock, never the machine's date. The clock runs
in the started day's own zone with hours past 24 until the next day starts,
so 30:52 on Thursday means Friday has come and has not been started: Friday
is due. Flying east does not trip this — Berlin 01:15 on Friday is Thursday
18:15 in Chicago, and the clock says so — because the zone is the day
file's, not the machine's. This week is the week of that calendar day, so
on a Monday morning with Sunday still open, this week is the new one and
Sunday's End is one step back.

## The blocks

- **Days.** Monday to Sunday, each in a word or two: the hours it ran and
  green "perfect"; "today · started 6:20"; amber "not ended" with an End
  button hugging it; "not started yet" with the page's one primary button,
  Start; dim "upcoming". A day with a file is a link to its page.
- **Plan.** `week.md` read by heading: the priorities as a numbered list,
  the goals under their category, a goal struck by hand shown as done. Each
  goal carries a chip with what the latest check-in said about it — done,
  on track, at risk, no motion, dropped — matched by the words the two
  share, since the entry compresses each goal to a phrase; a goal the entry
  never named gets no chip. A week without a plan says so.
- **Check-in.** The latest entry of `checkins.md`: the grade and its
  verdict line, the suggested edits, and the way into the file.
- **For next week**, **Scheduled**, **Next** — on a week still ahead only.
  See below.

## Next week

A week that has not begun has no plan and usually no files, but things are
already waiting for it, in the standing files at the top of `time/`:

- `next-professional.md` and `next-personal.md` hold `## Week-Next`, the
  queue week:plan appends deferrals to and reads back when it drafts, then
  `## Next`, the person's backlog, and `## Content`. **For next week** is
  the queue; its add row appends through the same helper week:plan uses,
  stamped `(pushed 2026-W36)` with the week that pushed it. **Next** is the
  backlog, folded, each line one "Next week ›" from the queue.
- `schedule-professional.md` and `schedule-personal.md` hold `## YYYY-MM-DD`
  lists; day:schedule:update pulls a day's list into the day file when the
  day starts. **Scheduled** shows them by date: the week's own dates, later
  ones, and in amber the dates that came and went without the day starting,
  which the terminal only ever warned about. The add row's day pick files an
  item under that date, the way day:todo:add files a to-do for a day that
  has no file yet.

The × on any of these lines is the person's hand: the line leaves, and a
list it leaves empty leaves with it. Nothing else empties the queue —
week:plan reads it and drafts from it. Planning itself stays in the terminal
for now (`sky week:plan 37`); the page says so in one line.

`Create the week` runs week:new for a week whose directory does not exist:
the Sunday or Monday step, as a button. The current week needs none, since
day:start creates the week when the day file is missing.

## The morning check-in

day:start now ends by grading the week: week:checkin runs when the week has
a `week.md`, with the editor kept closed, and its failure never holds up the
day. The entry lands in `checkins.md` and the week page shows it. Starting
the day from the web runs the same day:start, so the Start button waits for
the check-in too.

## Routes

All under `/week/_api`, mounted when the service has a notebook.

| Route | Does |
| --- | --- |
| `GET /` | This week's view |
| `GET /:id` | The week's view, `2026-W36` |
| `POST /:id/create` | week:new for the week; answers the view |
| `POST /:id/day/:ymd/start` | day:start for the day; answers the view |
| `POST /:id/day/:ymd/end` | day:end for the day; answers the view |
| `POST /:id/queue` | `{text, category, day?}` → Week-Next, or the schedule file under the day |
| `POST /:id/queue/remove` | `{file, list, raw}` → the line leaves |
| `POST /:id/queue/promote` | `{file, list, raw}` → the line moves from its list into Week-Next |

A command that fails answers 502 with its message; without a command host
the three command routes answer 501. `mod.ts` holds the view and the
routes, `plan.ts` and `checkins.ts` the two file readers, `queue.ts` the
standing files, `createWeekHost.ts` the in-process command runs. Tests run
against a temp notebook with a scripted clock and scripted commands.

Narrative: [2026-09-04 — the week page](2026-09-04-the-week-page.md).
