---
created: 2026-09-26
updated: 2026-09-26
---

# One entry per person

## What was seen

A profile lists two names: `Jane Doe` first, and `Jane Doh`, a misspelling
kept so old references still find her.
The people list the model is given showed her twice:
`Jane Doh` and `Jane Doe`, each with her whole score.
Asked who was in a meeting, the model could pick either,
so new captures kept writing the misspelling.

## Why

`getPeopleWithScores` reported every name any person file listed.
Scores were already combined across a profile's spellings,
so each spelling carried the same full total.

## What changed

A person is reported once, under the name their file lists first.
Their other names are spellings of that person, not people.
A name two profiles share, or no profile lists, still stands alone,
as the bare-name rule needs.
Name lookups that add up a person's names now count the score once,
not once per spelling.
