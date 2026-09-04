---
created: 2026-09-03
updated: 2026-09-03
---

# meeting:new — the action items

`meeting:new` files a meeting from a transcript, a voice memo, or a text
file (the pipeline itself is `commands/all/audio/transcript/docs/README.md`).
Once the meeting is on disk it offers the summary's action items for
acceptance. This page is about that step: what is offered, where an accepted
item goes, and how the terminal and the web page ask.

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
| A day whose file exists, with a time | that day's `## Professional Commitments` | `HH:MM > item` |
| A day whose file exists, no time | that day's `## Professional Todos` | `item` |
| A day whose week is not made yet | `schedule-professional.md` under `## YYYY-MM-DD`, the time kept | the morning's `day:schedule:update` files it under Commitments or Todos by the same split |
| No day | `next-professional.md` `## Next` | `item` |

A past date cannot be scheduled; it is treated as no day. The Commitments
write goes straight to the day file (`writeDayItems`); the others run
`day:todo:add` and `next:add`, each told its list by name (see below). The
ledger prints one line per item — `✓ item → Tomorrow · Todos`,
`✓ item → Fri 13 Mar · Commitments`, `✓ item → Mon 16 Mar · schedule`,
`✓ item → Next` — or `✗ item — reason`, and ticks the count.

## How the question is asked

The step is one `place` question on the prompt seam
(`commands/lib/prompt/Prompter.ts`): the items with their proposed whens,
today's date, the last created day, the fallback, and how many items
already wait on Next.

- **The terminal** keeps the multiselect it has always had. Space ticks,
  Enter confirms; the hint beside each item says where it goes
  (`me · → Tomorrow`). A ticked item takes the when it arrived with.
- **The web page** (`service/handler/theme/client/import.tsx`) shows a
  chip on every row — Today, Tomorrow, the rest of this week by name,
  another day, a time, Next — and one chip in the lead sentence that moves
  every row not set on its own. A time given by hand makes the item a
  Commitment; clearing it makes it a Todo again. After Accept the page
  shows where each item went, grouped by day, with a link to open the day.
- **Headless** runs skip the step; nothing is written without a person.

## Words in one place

"Today", "Tomorrow", "Fri 13 Mar · 09:30", "Next", and which list takes an
item, come from `universal/dates/whenLabel/mod.ts`, so the terminal's hint,
the ledger, and the page's chips say the same thing.

## A list is named on every call

A composed command inherits its caller's arguments before its own defaults
apply (`commands/lib/core/resolveCommandArgs.ts`). `meeting:new` carries a
`category` — `Professional Complete`, the list the meeting is filed under —
and `next:add` and `day:todo:add` have a `category` of their own with a
different meaning. Left to inheritance, `next:add` looked for a list called
"Professional Complete" in the Next file and failed, and every accepted
undated item was lost. The routes now name the list on each call
(`category: 'Next'`, `category: 'Professional Todos'`);
`lib/actionItemRoutes_test.ts` pins both the inheritance and the cure.

## Narrative

- `2026-09-03-a-nested-command-inherits-its-callers-flags.md` — the lost
  action items, and why the routes name their lists.
- `2026-09-03-action-items-land-on-days.md` — from "everything goes to
  Next" to a when on every row.
