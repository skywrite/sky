---
created: 2026-08-29
updated: 2026-09-20
---

# Day commands

Design notes for `src/commands/all/day/`. The carry-over of unfinished items
and the meeting check are written up so far. Extend this file as other parts
of the group need a mental model.

## Day files are created as needed

`day:start` ensures only its target day's file exists before running startup
commands. `lib/nbfs/ensureDay` creates the normal unstarted template at its
canonical path, creates parent directories, and preserves an existing file
byte for byte. Atomic publication also prevents concurrent creators from
overwriting a plan or producing `day-2.md`.

CLI adds, task moves, and reminder copies follow the date-routing rule below
and publish missing day files with the same atomic primitive. A prepared day is still unstarted: only `day:start` sets its start
time and reconciles active streaks. Moving a task must not run startup routines.
The web's destination-first moves use the same atomic publication primitive.

A week is a calendar range with optional documents, not a batch of files to
create. `week:plan` writes `week.md` and creates its directory as needed;
it works before any of the week's days exist. There is no `week:new` command.
Scheduled items continue to enter their day through the day-start flow.

## Task dates choose their destination

`lib/nbfs/taskDestination` is shared by CLI adds/carries, meeting action-item
acceptance, and web additions, Next pulls, date edits, bulk moves, and week-page
date picks. A date through the current week's Sunday goes to its day file,
created unstarted when needed. Later dates go to `schedule-professional.md` or
`schedule-personal.md` under `## YYYY-MM-DD`, even if a future day file already
exists. Existing future plans are preserved; this rule does not migrate them.
Historical edits still go to their day files.

The boundary is the calendar date in the notebook's timezone: a Sunday running
at 25:30 is already Monday for planning. A new notebook falls back to system
time. Use the full Monday–Sunday range, not a week-directory identity: the
range can cross New Year while the directories are split by year. Web date
pickers receive this calendar date separately from the last started day.

Legacy schedule items infer Todos versus Commitments from their clock prefix.
When that would lose the original list, an item carries a first-line annotation
such as `<!-- sky-list: Reminders -->` or
`<!-- sky-list: Professional Commitments -->`. Reminders use the personal
schedule; the annotation preserves their category-independent destination.
`day:schedule:update` removes the annotation, restores the original list, and
moves the complete block with its notes and rebased links. It saves the day
before draining schedules. It accepts the target day forwarded by `day:start`.
No startup routines run merely because a task is assigned a date.

Moves and imports use shared Markdown-block and destination-first transaction
helpers in `lib/nbfs`. Failed multi-file writes roll back only bytes still owned
by that operation. Schedule writers share one lock across dates and categories;
when a source/day lock is also needed, take it before the schedule lock.

## The meeting check

`day:meeting:check <day>` cross-references the day's Google Calendar
meetings against the notebook's meeting records and warns about the ones
with no record, plus records whose `when:` states no end time. Its rules:

- **Warn, never fail.** The command always succeeds; an unreachable
  calendar or service degrades to a warning line. Call sites run it bare.
- **The notebook side is the service** — `meetings(where: {date})` over
  GraphQL, never a file walk.
- **A record is a start-time match** within 15 minutes. Notebook meetings
  the calendar never saw are ignored, not flagged.
- **Civil-day calendar windows.** The calendar is asked for the civil day
  in the system zone; the check does no absolute-time math of its own.

The check lives in `meeting/lib/meetingCheck.ts` — a pure comparison over
already-fetched sources, the fetches, and a model-facing render — and
surfaces in four places: `day:end` (the ending day), `day:start` (the day
before), and the ambient context of every chat and voice session, where
the render also judges each meeting against the notebook clock (upcoming,
in progress, not logged). See
[2026-08-30 — the meeting check reaches the chat and the voice](2026-08-30-meeting-check-in-chat-and-voice.md).

## The day's lists as tools — day:items

`day:items`, `day:items:add`, and `day:items:done` read, extend, and
strike the day's lists — the voice assistant's "what's on my
commitments", "add X", "mark X done", and chat tools of the same names.
One add door for todos/commitments/reminders, substring matching that
refuses ambiguity, strike-in-place with links preserved. Design and the
two `ListDocument` facts they lean on:
[2026-08-30 — day:items](2026-08-30-day-items-voice-trio.md).

## Writing a day file — one writer at a time

A day write reads the whole file, changes it in memory, and writes the
whole file back. Two writers that overlap both start from the same bytes,
and the later write erases the earlier one. No call fails, so nothing
reports the loss.

A chat model asked for several items sends its tool calls at once, so the
`day:items` tools hit this every time. They take `withDayWrite` from
`lib/nbfs` around the read-to-write section. It is the same lock the web
day page takes around its item writes, so a command and the page queue on
each other too. `day:todo:add` takes `withScheduleWrite` when it files
into the schedule, whose two files hold every future date.

The lock does not nest: a writer that holds it must not run another day
writer inside it. Moves and scheduled imports also take the relevant day and schedule locks.
Legacy `writeDayItems` callers and standalone sweep commands do not take them yet. A new command that reads a day file in
order to write it takes `withDayWrite` around both.
[2026-09-19 — adds sent at once all land](2026-09-19-adds-sent-at-once-all-land.md).

## Carrying unfinished items to another day

Three list families on a day file hold planned work. Each has its own
carry-over commands:

| List | Done marker | Sweep | Move |
|---|---|---|---|
| `Professional/Personal Todos` | `~~item~~` | `day:todo:incomplete` | `day:todo:move-next`, `day:todo:move-future` |
| `Professional/Personal Commitments` | `~~item~~` or `HH:MM > ~~item~~` | `day:commitments:incomplete` | `day:commitments:move-next`, `day:commitments:move-future` |
| `Reminders` | `~~item~~` | — | `day:reminders:move-next`, `day:reminders:move-future`, `copy-*` |

Todos and commitments share one shape:

1. **Sweep** (`*:incomplete`). Done items stay in the list. Unfinished items
   move to the category's `Incomplete` section. `Professional Todos` and
   `Professional Commitments` both feed `Professional Incomplete`: that section
   is the day's record of "planned, didn't happen", and `summary:day` reads it.
   `--clean-only` drops the items instead of recording them.
2. **Move** (`*:move-future`). Carries complete unfinished blocks through the
   shared date-routing rule, saving the destination before changing the source.
   Todos and commitments leave the original blocks under `Incomplete` unless
   `--no-incomplete` is set. Reminders leave no incomplete record; copies leave
   the source intact. `*:move-next` is `move-future` with `new = old + 1`.

An empty move or reminder copy creates no destination. Failure to create a
destination leaves the source untouched. Reminder moves save the destination
before removing the source items.

`day:end` runs `day:todo:incomplete` by default (`commands.day.end` in config).
Add `day:commitments:incomplete` there to sweep both lists at close.

### Where commitments differ from todos

- **One `Incomplete` section per category.** The todo sweep usually runs first
  (`day:end`), so the commitments sweep appends to an existing
  `Professional Incomplete` instead of adding a second heading with the same
  title. Two same-titled lists break every title lookup on the document.
- **Commitments stay in time order.** Shared block ordering sorts commitments
  by their `HH:MM > …` prefix unless the destination uses manual order. Todo
  and commitment moves create missing lists and preserve complete task blocks.
- **Moved items keep their time.** `10:00 > Call with Jane` lands on the next
  day as the same item: a reschedule to the same slot. Retime it by hand.

Standalone commitment sweeps use `commitments/lib/moveCommitments.ts`.
Moves and copies compose the shared helpers in `_carryItems.ts`.

Narratives: [2026-08-29 — commitments carry-over](2026-08-29-commitments-carry-over.md),
[2026-08-29 — todo move checks the target first](2026-08-29-todo-move-checks-target-first.md).
