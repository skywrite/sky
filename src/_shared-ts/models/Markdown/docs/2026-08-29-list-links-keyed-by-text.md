---
created: 2026-08-29
updated: 2026-08-29
---

# List links keyed by text

## Symptom

Moving an unfinished todo written as `Review [the deck][deck] with Jane` to
another day (`day:todo:move-future`) left that day with

```
[deck]: undefined
```

at the bottom. The source day stayed correct. Items written the way Sky
writes them, `[deck][]`, never showed it.

## Cause

`fetchLinksFromTokens` keyed the list-level map by the first bracket — the
link text (`the deck`) — while `Document.extractReferenceLabels`, which
`ItemList.filter` and `remove` use to pick the links for a subset of items,
returns the second bracket — the label (`deck`). The lookup missed, and an
`as Link` cast let `undefined` into the map. `replaceList` then merged it
into the target document, which rendered it as a definition line.

The document-level map never had the problem: marked's definition table is
keyed by label.

The same mismatch had a second, opposite effect. `replaceList` cleans up
definitions the replaced list no longer references, keyed by the list map.
For a full-form link the cleanup looked for the wrong key and missed, so a
`[text][label]` item moved with `removeItem` + `addItem` and no links kept
its definition "by accident" — a regression test in
`ListDocument/_regressions/move-item-preserves-links_test.ts` documented it
as such. A collapsed `[label][]` item lost its definition in the same
sequence, which is why callers that move items (`day:todo:pull`) pass the
links along.

## What was rejected

- **Re-keying per caller.** `day:reminders:move-future` already rebuilds the
  moved items' links from the document by hand, and the first cut of the
  commitments move did the same (`relink` + an `ItemList.withLinks`). Every
  new caller would have to know to do it. Rejected: fix the collector.

## Fix

`fetchLinksFromTokens` prefers the second bracket when it is non-empty,
mirroring `extractReferenceLabels`, so both maps agree on the key.
`filter` and `remove` skip a label with no definition instead of storing
`undefined`, which also covers a dangling reference in the source. The
commitments move dropped its workaround; the reminders copy is now
redundant but was left as is.

Consequence: the accidental survival is gone. A full-form link now needs the
same `referenceLinks()` hand-off as a collapsed one when an item is moved
with `removeItem` + `addItem`. The regression test was updated to state that
contract for both forms. `DayDocument.setCompleteItem` is the one in-tree
`removeItem` + `addItem` without links; its items carry inline
`[title](path)` links, which are not definitions, so it is unaffected in
practice.
