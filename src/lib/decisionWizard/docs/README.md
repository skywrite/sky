---
created: 2026-11-23
updated: 2026-11-23
---

# The decision wizard

The wizard is how a decision is added from the Future screen.
Sky thinks the decision through once, and the page then asks one question per step, answered by picking.

| Piece | Where |
| --- | --- |
| The plan, the answers, the steps, the record, Sky's thinking | `src/lib/decisionWizard/` |
| The prompts | `src/commands/all/decisions/prompts/decisions-{find,weigh,recall,weigh-option,weigh-want}.prompt.md` |
| Runs, routes, saving | `src/service/handler/future/wizard.ts`, `mod.ts`, `decisionCommands.ts` |
| The page | `src/web/client/future/wizard/` |

## Think once, then ask

One request to the reasoning role, at the highest effort the model offers, writes the whole plan (`think.ts`).
No step makes a model call after that, which is why every step is instant.
Only an option, a want or a wording the person types in sends Sky back to think.

The plan already holds Sky's own odds and Sky's own pick.
The page holds them back until the person has answered, because a read given first anchors the second one.
Keep that order when changing a step: the person's odds, then Sky's; the person's call, then Sky's.

The wait is the cost of this design, and effort is the lever on it.
Nearly all of the wait is the model reasoning before it writes, not the reading and not the writing.

## The plan is Sky's, the answers are the person's

`plan.ts` is what Sky wrote and never changes while the person answers.
`answers.ts` is what the person chose: places in the plan, or their own words.
`screens.ts` works the steps out from the two, so a step with nothing to ask is left out.
`record.ts` builds the record from the two, and both the page's preview and the server's save call it.
What is shown is what is saved; do not build the record in two places.

## The shape of the answer travels in the prompt

A provider's constrained structured output refused the plan's schema: "The compiled grammar is too large".
So the schema is printed into the prompt as JSON Schema, and the answer is read with `extractJson` and checked
against a lenient schema (`wire.ts`), which converts it into the plan the page uses.
The wire schema is plain strings and lists on purpose, with the model naming options and wants by key.
Do not move this back to `Output.object` without running the real prompts again.

## Why the thinking is functions, not commands

A command runs in-process only once the command manifest lists it, and the manifest is rebuilt per machine.
The thinking writes nothing to the notebook, so it is plain functions the Future handler calls.
Everything that does write goes through a command or the write core:

- A new decision: `decisions:create`.
- An open decision being settled: the write core's `settles`.
  `decisions:resolve` asks at a terminal prompt, so it cannot be run from the page.
- A check kept as a to-do, and a reminder on each day chosen to look back: `day:items:add`.

## A run is Sky's working state

A run is one JSON file under the user data dir, `future/decisions/runs/`, never in the notebook.
Its id is an opaque job id, not a content record, so it carries no date or title.
A run outlives the page, the tab and a service restart, and unfinished runs are listed on the Decisions tab.
The thinking holds the service from reloading while it runs.
A think that a restart cut short is reported as such and can be started again.

## The decision is in the notebook from the second step

A decision being made is written to the notebook as an open decision once the person moves past the first step.
It is rewritten each time they move to another step or leave the page, and settled when they save.
So it is a real record while it is worked on: listed under To decide, pinned in every chat like any open decision,
and there for a chat's `rel:` to point to.
The first version wrote nothing until the final save, and a chat opened on the decision had no record to pin.

The run remembers the file's text as it last wrote it (`openText`).
A file that reads differently was changed by hand, and the wizard leaves it alone from then on.
The file is created through `decisions:create --no-editor`, because the person is working in the page.
A decision already made is written once, when it is saved: it was never open.

## What Sky reads

Active goals, decisions in force, open decisions, a topical search on the decision's words, and the last 14 days
read directly: each day's summary or day file, its journals, and its chat titles.
The direct read exists because the topical search missed the journal entries where the decision first came up,
which are the evidence the plan most needs.

## Saved as open, then picked up

Choosing to check something first stops the wizard there: the open decision gets a day to decide by, and the
checks become to-dos.
The run stays, and coming back lands on the call.
The answers then carry `hinge: 'checked'`: the wizard does not know how the checks came out, and the record says
the belief was set aside to check, without claiming a result.

## Talking a decision through

"Talk it through" opens a Sky chat about the decision, in a new tab.
The chat is the thread `decision-<run id>` (`thread.ts`): the id is the tie, so no thread state has to remember it.

- Each turn the chat host asks `createDecisionChat` (`chat.ts`) for the decision as it stands and sends it as
  reference data: everything in the plan and every answer so far (`brief.ts`).
  It marks what the wizard has not shown yet, and tells the chat to hold Sky's odds and pick until asked.
- Each save asks for the decision's reference, so the saved chat's `rel:` carries `decisions/<Name>`.
  A chat filed before its decision was gets the reference added when the decision is written.
- The chat cannot change the wizard. A new option goes in through "Add an option".

The raw notes the long think read are not replayed into the chat; it finds notes the way every chat does.

## Notes

- 2026-11-23: on a small made-up notebook, the plan for an open decision took 650 s and for a made one 356 s;
  finding decisions in the last two weeks took 11 s at the role's normal effort.
  A real notebook with far more to read took about 14 minutes for an open decision.

## Not here yet

- Asking how the checks came out when a decision saved as open is picked up.
- Looking back: the reminder only reminds; nothing walks the person through what they expected against what happened.
- A decision's own page.
