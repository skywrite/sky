---
created: 2026-11-22
updated: 2026-11-22
---

# Decisions — pending, in force, resolved

A decision is one Markdown file.
It moves through at most three states.

| State | What it means | Frontmatter | Folder |
| --- | --- | --- | --- |
| Pending | Not made yet | no `resolved` date | `decisions/<year>/pending/<month>/` |
| In force | Made, and still binding what the person does | `inForce: true` | `decisions/<year>/in-force/<month>/` |
| Resolved | Made, and carried out or retired: history | a `resolved` date, no flag | `decisions/<year>/resolved/<month>/` |

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
  they are. Then the flag comes off and the file moves to `resolved/`.

There is nothing to check off, daily or otherwise.
A habit that is checked each day is a streak, not a decision in force.

## The flag decides; the folder is where Sky files it

`inForce: true` is the truth everywhere in code: `DecisionDocument.inForce`, the store's `getInForce()`, the GraphQL
`inForce` field and filter, and `readInForceDecisions()`.
Decisions already work this way for the other boundary: the `resolved` date decides pending versus made, and the
folder follows it.

`decisions:create --in-force` sets the flag and files the document under `in-force/`.
A file moved into that folder by hand without the flag is not in force, and a flagged file sitting elsewhere is.
An in-force decision is never pending, even when a hand edit left it without a `resolved` date.

The flag is written only when set.
An ordinary decision carries no `inForce:` line to misread.

The flag is `inForce`, in the same camelCase as the notebook's other frontmatter keys.
The folder is `in-force`, hyphenated like other folder names, with no space.

## Who reads in-force decisions

- **Chat** pins them in every session, beside pending decisions and active goals:
  `{ decisions(where: { inForce: true }) { path } }`.
- **Most Important and journal questions** read them through `readInForceDecisions()`.
- **GraphQL** exposes `inForce` on `Decision` and as a filter. `pending` excludes them and `decided` includes them.

## Not here yet

- A command that ends one. Today the flag is removed and the file moved by hand.
- A field for what ends it. It lives in the decision's prose until a screen needs to show it apart.

## Rejected

- **"Ongoing"** as the name. "An ongoing decision" reads as one still being made, which is what pending means.
- **"Conditional"** as the name. It reads as "applies only if", the reverse of "holds until".
- **Splitting "forever" from "until something".** Both take keeping; only the ending differs, and the ending is
  optional.
- **A commitment kind of its own.** See above.
