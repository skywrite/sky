---
created: 2026-08-29
updated: 2026-08-30
---

# Day commands

Design notes for `src/commands/all/day/`. The carry-over of unfinished items
and the meeting check are written up so far. Extend this file as other parts
of the group need a mental model.

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
2. **Move** (`*:move-future`). Checks the target day first, runs the sweep on
   the source day, then appends the swept items to the same list on the
   target day. The order matters: the sweep writes the source, so a target
   failure after it would leave the items under `Incomplete` with nothing
   moved, and a rerun would find nothing left to move. `--no-incomplete`
   passes `--clean-only` through, so the source keeps no record.
   `*:move-next` is `move-future` with `new = old + 1`.

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
