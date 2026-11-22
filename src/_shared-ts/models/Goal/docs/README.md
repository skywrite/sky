---
created: 2026-11-21
updated: 2026-11-22
---

# Goals — one file per goal

A goal is one Markdown file: what the person is going after, and why.
It belongs to no single day, so it lives outside the time tree, beside decisions, ideas and streaks.

```
goals/
  active/Launch-Atlas.md            a goal being pursued
  archived/2025/Learn-Spanish.md    a goal that was reached or dropped
  personal.md                       an older notebook's whole-category file
```

## What the path says, and the file does not

The folder is the status and the file name is the name.
Neither is written inside the file.
A person edits these files by hand and moves them in Finder, so a `status:` or `name:` field would be a second
source of truth that can silently disagree with where the file sits.
Moving a goal to `archived/<year>/` is the whole act of finishing it, and its name stays the same, so every
`goals/<name>` reference keeps resolving.

`Goal/paths.ts` is the one module that spells the folder names.
The store, the GraphQL resolver, and the direct readers (chat context gathers, to-do priority, voice) all ask it.

## What a file holds

Frontmatter is `title`, `category` (Personal or Professional), `created`, `updated`, `rel` and `tags`.
The body is free prose.
`title` falls back to the first heading, so a file with no frontmatter still reads correctly.

A goal that can be measured adds what the Future screen reads:

| Key | What it says |
| --- | --- |
| `due` | The date the goal is for. |
| `start` | The day work began. Pace and progress count from here, not from `created`. |
| `track` | The tracker whose number measures the goal, by name. |
| `target` | The value that number should reach. |
| `checkpoints` | The same number at earlier dates, one line each: `- 20 by 2026-08-01`. |
| `serves` | The bigger goal this one serves: `goals/<name>`. |

`start` is its own key because a goal is often written long before anyone works on it.
Counting from `created` would call the months it sat untouched a slow pace.

## How a goal breaks down

A yearly goal breaks down in two ways, and they are stored differently on purpose.

- **The same number at an earlier date** is a checkpoint: a line inside the goal's file.
  It has nothing of its own to say, so a file for it would hold a title and nothing else.
- **A different outcome that helps** is a goal of its own, in its own file, with a `serves` line.
  It has its own reason, its own number and its own date.

Weekly actions are neither.
They are to-dos on a day, picked with the goal in view.

## Who reads goals

- **Chat** pins the active goals in every session: `{ goals(where: { status: "active" }) { path } }`.
  A reached or dropped goal stops riding along but stays searchable.
- **GraphQL** exposes `name`, `title`, `status` and `category`, with `name`, `nameContains`, `titleContains` and
  `status` filters. Name and status are derived from the path there too.
- **References** use `goals/<name>`, matched without regard to case, wherever the file sits.
- **Most Important, journal questions, the week plan and check-in** read active goals through `readGoals()`.
  To-do priority and voice read the same folder directly.
- **The Future screen** (`service/handler/future`, `web/client/future`) shows each active goal, where its number
  stands, and the decisions, habits and ideas whose `rel:` names it.
  It writes only the keys in the table above, and a new goal's file.

## Older notebooks

Before this, a notebook kept every goal of a category in one file: `goals/personal.md` and `goals/professional.md`.
Those files still load as active goals, and `goals/personal` still resolves, because a notebook is never rewritten
behind its owner's back.
`GoalDocument.goals` and the store's area helpers read the `## Area` blocks written inside such a file.
A one-goal file has none.

Voice reports a missing category file only when the notebook has no one-goal files either.
Once a notebook is split, the old files are not expected.

## Rejected

- **A `status:` field.** The location already says it, and a field can be wrong without anything looking wrong.
- **A `name:` field repeating the file name**, as streaks and ideas carry. It is a duplicate a rename breaks.
- **Converting older files automatically.** Splitting one prose file into several goals is a judgment about the
  person's own words, so it is theirs to make or to ask for.
