---
created: 2026-11-22
updated: 2026-11-26
---

# Decisions — pending, in force, decided

A decision is one Markdown file.
It moves through at most three states.

| State | What it means | Frontmatter | Folder |
| --- | --- | --- | --- |
| Pending | Not made yet | no `decided` date | `decisions/<year>/pending/<month>/` |
| In force | Made, and still binding what the person does | `inForce: true` | `decisions/<year>/in-force/<month>/` |
| Decided | Made, and carried out or retired: history | a `decided` date, no flag | `decisions/<year>/decided/<month>/` |

## One word for a made call

Every call is logged on its day as `-> Decided |`, whether it settles an open decision or was written down already made.
Until 2026-11-26 the folder, the date and the command said "resolved", and the day line used both words for the same event:
`Resolved` for a call that settled an open decision, `Decided` for one written down already made.
"Resolved" was picked in January 2026, most likely because `decisions:decide` read awkwardly as a command.
Keep one word; a second one for the same event makes summaries and searches read as two different things.

## A made call stays in view for 30 days

Chats, the day's Most Important, journal questions and the decision wizard read the open decisions and those in force.
They also read every decision made in the last `DecisionDocument.RECENTLY_DECIDED_DAYS` (30) days that is not in
force or archived.
A call that needs carrying out is easy to drop once it is made; keeping it in front of Sky for a month lets the day's
priority pick up its next step, and lets a chat that touches it check that it is under way.
The four prompts say "30 days" in words, so keep them in step with the constant.
Readers: `readRecentlyDecided` in `commands/lib/notebookContext.ts`, and the `decidedGte` filter that chats query.

## Why "in force" exists

Some decisions are carried out once.
Shipping a feature in a given release is done the day it ships, and nothing is left to keep.

Others keep binding what the person does: a spending freeze, "no releases on Fridays until the on-call rota is
staffed", quitting coffee.
That is a commitment, and it is the same record as the decision that created it.
A separate "commitment" kind would hold the same words twice.

A decision is in force while it still takes keeping.

- It may name what ends it ("until the rota is staffed"), in the decision's own prose.
- It may have no end. Quitting something belongs here for the first years, when a plan can still cut against it.
- It leaves when the person retires it: the ending arrived, the decision was reversed, or it has simply become who
  they are. Then the flag comes off and the file moves to `decided/`.

There is nothing to check off, daily or otherwise.
A habit that is checked each day is a streak, not a decision in force.

## The flag decides; the folder is where Sky files it

`inForce: true` is the truth everywhere in code: `DecisionDocument.inForce`, the store's `getInForce()`, the GraphQL
`inForce` field and filter, and `readInForceDecisions()`.
Decisions already work this way for the other boundary: the `decided` date decides pending versus made, and the
folder follows it.

`decisions:create --in-force` sets the flag and files the document under `in-force/`.
A file moved into that folder by hand without the flag is not in force, and a flagged file sitting elsewhere is.
An in-force decision is never pending, even when a hand edit left it without a `decided` date.

The flag is written only when set.
An ordinary decision carries no `inForce:` line to misread.

The flag is `inForce`, in the same camelCase as the notebook's other frontmatter keys.
The folder is `in-force`, hyphenated like other folder names, with no space.

## A decision recorded after the fact

A decision is dated by when it was made, not by when it was written down.
`decisions:create --when "2025-03-10 15:00"` stamps `identified`, `decided` and `created` with that moment, files the
document under that year and month, and puts the day line on that day.
`updated` alone carries the day the file was written.

The moment takes the timezone of its own day file, as `decisions:decide --when` does.
A day with no file takes today's.
A bare date reads as noon, for a decision whose hour the notebook does not show.
A moment that has not happened yet is refused.

The option exists because the first decision recorded this way was stamped with the day it was typed, a year after
it was made.
The notebook already held the real moment, in a journal entry.
The tool description therefore tells chat to find that moment in the notebook before creating, and to pass it.

## More of the record, tags and rel

`decisions:create --record` takes more of the record as Markdown sections starting at `## `: options weighed, what
is expected, rules set ahead of time.
They are written between Desired Outcomes and Decision, and a section the document model does not know survives an
edit.

The write core can settle an open decision in place (`settles`): the made call takes the open file's place and
keeps the day the decision came up.
`decisions:decide` does the same from a terminal prompt; the wizard cannot answer a prompt, so it uses the core.
An open decision can also be rewritten in place while it is worked on (`updateOpenDecision`): its name, the day it
came up, its tags and its references are kept, and a file changed by hand since the last write is left alone.
`decisions:create --no-editor` writes the file without opening it, for a caller that is not a terminal.

`decisions:create` tags the decision and adds rel with the enrichment other captures get
(`commands/all/decisions/lib/enrich.ts`).
Rel keeps every substantive tie, because a decision's record names the people and organizations it turns on.
Sky is passed as the other party to the record.
A record worked out with Sky quotes Sky, and without that the bare name was matched to a contact who shares it.

## Who reads in-force decisions

- **Chat** pins them in every session, beside pending decisions and active goals:
  `{ decisions(where: { inForce: true }) { path } }`.
- **Most Important and journal questions** read them through `readInForceDecisions()`.
- **GraphQL** exposes `inForce` on `Decision` and as a filter. `pending` excludes them and `decided` includes them.
- **The Future screen** (`service/handler/future`) lists every decision as open, in force or made, with the goals
  whose `goals/<name>` its `rel:` holds. Its "Add a decision" page is the decision wizard, which saves through
  `decisions:create` (see [the wizard's note](../../../../lib/decisionWizard/docs/README.md)).

## Not here yet

- A command that ends one. Today the flag is removed and the file moved by hand.
- A field for what ends it. It lives in the decision's prose until a screen needs to show it apart.

## Rejected

- **"Ongoing"** as the name. "An ongoing decision" reads as one still being made, which is what pending means.
- **"Conditional"** as the name. It reads as "applies only if", the reverse of "holds until".
- **Splitting "forever" from "until something".** Both take keeping; only the ending differs, and the ending is
  optional.
- **A commitment kind of its own.** See above.
