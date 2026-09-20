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

CLI task moves and reminder copies use the same helper when they have work
to carry. A prepared day is still unstarted: only `day:start` sets its start
time and reconciles active streaks. Moving a task must not run startup routines.
The web's destination-first moves use the same atomic publication primitive.

A week is a calendar range with optional documents, not a batch of files to
create. `week:plan` writes `week.md` and creates its directory as needed;
it works before any of the week's days exist. There is no `week:new` command.
Scheduled items continue to enter their day through the day-start flow.

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
writer inside it. Other day writers (`writeDayItems` callers, the move and
sweep commands) do not take it yet. A new command that reads a day file in
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
2. **Move** (`*:move-future`). Ensures the target day exists, runs the sweep on
   the source day, then appends the swept items to the same list on the
   target day. The order matters: the sweep writes the source, so a target
   failure after it would leave the items under `Incomplete` with nothing
   moved, and a rerun would find nothing left to move. `--no-incomplete`
   passes `--clean-only` through, so the source keeps no record.
   `*:move-next` is `move-future` with `new = old + 1`.

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
- **The target list is created when missing, and stays in time order.**
  Appending goes through `DayDocument.addCommitmentItem`. It inserts the list
  after `Most Important` when an ended day has had its empty lists removed,
  and it sorts, because commitments are `HH:MM > …` items. The todo move
  requires the list to exist and appends unsorted.
- **Moved items keep their time.** `10:00 > Call with Jane` lands on the next
  day as the same item: a reschedule to the same slot. Retime it by hand.

The document logic lives in `commitments/lib/moveCommitments.ts` and is tested
without a notebook. The commands add the file I/O and the output.

Narratives: [2026-08-29 — commitments carry-over](2026-08-29-commitments-carry-over.md),
[2026-08-29 — todo move checks the target first](2026-08-29-todo-move-checks-target-first.md).
