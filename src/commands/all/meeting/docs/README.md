---
created: 2026-09-03
updated: 2026-09-24
---

# meeting:new — the action items

Calendar invitations use [`calendar:schedule`](../../../../lib/calendarScheduler/docs/README.md).
This command creates notebook meeting documents.

`meeting:new` files a meeting from a transcript, a voice memo, or a text
file (the pipeline itself is `commands/all/audio/transcript/docs/README.md`).
Once the meeting is on disk it offers its action items for review,
including an empty list where the person can add the first item. This page is about that step: what is offered, where an accepted
item goes, and how the terminal and the web page ask.

Profile curation uses the corrected transcript; its evidence and write rules
live in [Person profiles](../../../../_shared-ts/models/Person/docs/README.md).

## What is offered

Every item the summary found, the person's own preselected. The extract
call returns them structured (`lib/notebook/actionItems.ts`): the text,
whether it is the owner's (`## Action Items (me)`), and the day and clock
time the words named, resolved to absolute dates. A misattributed owner is
one tick from rescue rather than lost, which is why the others' items are
shown too.

Each item arrives with a proposed **when**:

- the day and time the words named, when that day is still ahead;
- otherwise **tomorrow**. Nothing is proposed for the Next list: it is
  where items go to be forgotten, so it is a choice, never a default.

## Where an accepted item goes

The routes live in `lib/actionItemRoutes.ts` and are decided from the
answer, so the ledger can say each one in words.

| The when | Lands in | As |
| --- | --- | --- |
| A date within this week, with a time | that day's `## Professional Commitments` | `HH:MM > item` |
| A date within this week, no time | that day's `## Professional Todos` | `item` |
| A date beyond this week | `schedule-professional.md` under `## YYYY-MM-DD`, the time kept | the morning's `day:schedule:update` files it under Commitments or Todos by the same split |
| No day | `next-professional.md` `## Next` | `item` |

A past date cannot be scheduled; it is treated as no day. Dated items use the shared
[date-routing rule](../../day/docs/README.md#task-dates-choose-their-destination),
through `day:items:add` for commitments and `day:todo:add` for todos. Undated
items run `next:add`; each route specifies its destination explicitly. The
ledger prints one line per item — `✓ item → Tomorrow · Todos`,
`✓ item → Fri 13 Mar · Commitments`, `✓ item → Mon 16 Mar · schedule`,
`✓ item → Next` — or `✗ item — reason`, and ticks the count.

## How the question is asked

The step is one `place` question on the prompt seam
(`commands/lib/prompt/Prompter.ts`): the items with their proposed whens,
today's date, the current week's Sunday, the fallback, and how many items
already wait on Next.

- **The terminal** keeps the multiselect it has always had. Space ticks,
  Enter confirms; the hint beside each item says where it goes
  (`me · → Tomorrow`). A ticked item takes the when it arrived with.
- **The web page** (`service/handler/theme/client/import.tsx`) shows a
  link to the source meeting with its title, date/time and attendees,
  an editable description and a chip on every row — Today, Tomorrow, the rest of this week by name,
  another day, a time, Next — and one chip in the lead sentence that moves
  every row not set on its own. A time given by hand makes the item a
  Commitment; clearing it makes it a Todo again. After Accept the page
  shows where each item went, grouped by day, with a link to open the day.
- **Headless** runs skip the step; nothing is written without a person.

Prompts advertise `editable: true` before the web answer carries every row,
with `accepted: false` for unchecked items. A review already waiting on an
older server still sends only accepted values; the terminal's older
value/when pairs also still mean accepted. Text edits
and additions save to the meeting notes before any tasks route, even when
none are accepted. `lib/actionItemReview.ts` reads the filed notes on fresh
runs and resumes, preserves unrelated prose and frontmatter, and uses the
document API's version check to avoid overwriting concurrent edits. A failed
note save leaves the import unfinished and creates no tasks. Accepted tasks
include a notebook-root link bearing the meeting's title and date, so their
source survives moves between days, the schedule, and Next.

## Words in one place

"Today", "Tomorrow", "Fri 13 Mar · 09:30", "Next", and which list takes an
item, come from `universal/dates/whenLabel/mod.ts`, so the terminal's hint,
the ledger, and the page's chips say the same thing.

## Routes override the meeting category

A composed command inherits its caller's arguments before its own defaults
apply (`commands/lib/core/resolveCommandArgs.ts`). `meeting:new` carries a
`category` — `Professional Complete`, the list the meeting is filed under —
and `next:add` and `day:todo:add` have a `category` of their own with a
different meaning. Left to inheritance, `next:add` looked for a list called
"Professional Complete" in the Next file and failed, and every accepted
undated item was lost. The routes override the category on each call:
`category: 'Next'` selects the Next list, while `category: 'Professional'`
lets `day:todo:add` choose `Professional Todos`.
`lib/actionItemRoutes_test.ts` pins both the inheritance and the cure.

## A few questions after the check

Once the names are settled and the write-up checked, `meeting:new` may ask
up to three questions, so the notes say what was said and what was meant.
Voice memos only: a memo is the person's own words, which they can
clarify; a transcript is everyone's, which they cannot.
Each is about one thing the write-up could not tell: decided or thought
aloud, which reading was meant, what a referent was, something missed.
Never what happens next, never who should own something or by when, never
the clock. Every question quotes the words it is about.

Each question is drafted knowing the answers before it, so a "decided" can
call for its scope and a "still a thought" closes that thread. Every
question can be skipped; Esc in the terminal, or Skip the rest on the page,
ends them. What was answered is folded into the write-up where the fact
belongs, marked "Clarified after the meeting"; what was skipped stays as
heard. When the fold fails, the answers go under a heading of their own,
never lost. The exchange is kept in the run record (`questions`), so a run
picked up again never asks twice. The action items come from the
extraction before the questions.

The step is `audio/transcript/lib/clarify.ts`; the prompts are
`audio/transcript/prompts/transcript-question.prompt.md` and
`transcript-fold.prompt.md`. Unattended runs ask nothing.

## Narrative

- `2026-09-24-a-few-questions-to-get-the-notes-right.md` — why the
  questions are about the meeting as it happened, never what comes next.
- `2026-09-03-a-nested-command-inherits-its-callers-flags.md` — the lost
  action items, and why the routes name their lists.
- `2026-09-03-action-items-land-on-days.md` — from "everything goes to
  Next" to a when on every row.
