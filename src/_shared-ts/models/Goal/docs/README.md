---
created: 2026-11-21
updated: 2026-11-21
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

Dates, a tracked number and a breakdown are deliberately absent.
They arrive with the screens that read them, not before.

## Who reads goals

- **Chat** pins the active goals in every session: `{ goals(where: { status: "active" }) { path } }`.
  A reached or dropped goal stops riding along but stays searchable.
- **GraphQL** exposes `name`, `title`, `status` and `category`, with `name`, `nameContains`, `titleContains` and
  `status` filters. Name and status are derived from the path there too.
- **References** use `goals/<name>`, matched without regard to case, wherever the file sits.
- **Most Important, journal questions, the week plan and check-in** read active goals through `readGoals()`.
  To-do priority and voice read the same folder directly.

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
