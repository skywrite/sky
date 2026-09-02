---
created: 2026-09-01
updated: 2026-09-01
---

# One score per person

## What was seen

The front matter panel's who field ranks its suggestions by interaction score
and says how long ago the last one was. For a person whose profile lists three
spellings it named a date days older than the last interaction on disk, and
ranked by a fraction of what the notebook held.

## Why

`ScoringStore` keyed interactions by the name as a file wrote it. A profile
whose `name:` lists `Jane Doe`, `jane doe` and `Janie` accrued three separate
entries, each with its own last date. The panel lowercased names when it built
its lookup, so the two casings collided, and whichever the scan had reached
last won — an arbitrary slice of the person.

## What changed

- `ScoringStore.getPeopleWithScores` reports one entry per person: entries whose
  names match case-insensitively are added up, and so are the entries for the
  other spellings the caller gives. A reported name that is another's casing
  reports once.
- `Store` remembers each person file's `name:` list (`rememberPersonNames`) and
  answers `spellingsOf(name)`: the list of the single file listing that name,
  minus any name another file lists too. A shared bare name stands for itself,
  so the score-dominance rule for bare names is unchanged by this.
- `readFileAndUpdatePeople` feeds the list; `replaceFrom` carries it across an
  entity rebuild.

## Verified

Unit: `ScoringStore` (spellings and casings add up, a casing reports once),
`Store` (a shared bare name credits neither profile), scanner (a meeting under
a nickname and a message under a lowercased name report as one person). Live:
`peopleWithScores` reports one total under each listed spelling of a person,
and the panel's hint moved to that person's true last interaction.
