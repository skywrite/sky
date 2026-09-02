---
created: 2026-09-01
updated: 2026-09-01
---

# Ghost rows in the who field

## What was seen

Typing a name into the who field showed the notebook's most-interacted people
above the person typed, several of them twice, and the person typed four or
five times. The server's answer for the same letters was six rows, the right
one first.

## Why

Three things, stacked:

- The vocabulary built one row per indexed name. The entity stores key by
  every name a document answers to, so a person with an `alt:` or a `name:`
  list came back once per name, each row showing the same display name.
- `ChipsInput` keyed its rows by the option's value. Two rows with one key
  leave React unable to tell them apart when the list changes; it warns
  ("Encountered two children with the same key") and keeps a row of the
  earlier answer in the DOM. Mantine's Combobox keeps the dropdown mounted for
  the row's whole life, so those rows outlived every answer and piled up.
- The dropdown opened on the first keystroke with whatever the last fetch had
  returned — the empty search's answer, everyone by score — until the first
  letter's answer landed. Its duplicate rows were the ghosts pinned at the top.

## What changed

- `vocabulary/mod.ts` builds one row per document (`profilesOf`), answering to
  every name the store indexes for it plus `alt:`/`names:` as written; tag and
  key counts count a document once too.
- `ChipsInput` keys each row by document path and value, and shows an option
  once.
- `useCompletions` returns the answer to the current search, or, while the next
  is on its way, the answer to a search this one extends or shortens — never
  the empty search's (`serves` in `complete.ts`).

## Verified

Unit: vocabulary (a person with three names completes once under each and
counts her tag once), `serves`. Live, headless against the running service
with writes blocked: typing the same letters, the who dropdown holds exactly
the server's rows, React logs no key warning, and no row of an earlier answer
remains.
