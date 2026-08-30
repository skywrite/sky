---
created: 2026-08-29
updated: 2026-08-29
---

# Markdown models

Design notes for `src/_shared-ts/models/Markdown/`. Only reference links are
written up so far. Extend this file as other parts of the family need a
mental model.

## Reference links: two maps, one key

A reference link has a text and a label. In `Review [the deck][deck]` the
text is `the deck` and the label is `deck`; the definition line
`[deck]: https://…` turns the label into a URL. The collapsed form `[deck][]`
uses one word for both. Sky's own writers (`day:todo:add`, schedule and
recurring extraction) emit the collapsed form; the full form appears in
hand-written items.

Two link maps exist, and both are keyed by the **label**:

| Map | Built by | Scope |
|---|---|---|
| `Document.links` | `fetchLinksFromTokensList` from marked's definition table | the whole file |
| `ItemList.links` | `fetchLinksFromTokens` from each item's inline link tokens | one list |

`Document.extractReferenceLabels(item)` reads the labels off an item's text
(`match[2] || match[1]`). `ItemList.filter` and `ItemList.remove` use those
labels to carry the right definitions with a subset of items, and
`ListDocument.replaceList` / `addList` merge a list's map back into the
document's. A label with no definition — a dangling reference — has no
entry in either map and is skipped, never stored as `undefined`.

**Moving an item between lists.** `replaceList` drops a definition from the
document once no item in the list references it, and `addItem` cannot restore
an href it was never given. So `removeItem` + `addItem` loses the link unless
the caller carries it: `doc.referenceLinks(item)` before the remove, passed
to `addItem` as `opts.links` (`ItemList.remove` returns the same map). This
holds for both link forms. The full form used to survive that sequence by
accident; see the narrative.

Shortcut references (`[site]` alone) are outside both collectors on purpose;
neither `fetchLinksFromTokens` nor `extractReferenceLabels` matches a single
bracket pair.

## Import graph: siblings import each other directly, never the barrel

`Markdown/mod.ts` is the barrel for callers outside the family. It re-exports
`MarkdownStore`, whose stores reach `Day`, and `DayDocument extends
ListDocument`. A module inside the family that imports the barrel at runtime
therefore closes a cycle, and the cycle bites whenever a process enters the
graph from `ListDocument` — a `bun test` subset, a command whose first
import is a list document — with "Cannot access 'ListDocument' before
initialization". `ItemList` and `Store` import `Document/mod.ts` directly
for that reason; a `type` import of the barrel is erased and is fine.
`ListDocument/_regressions/import-cycle-tdz_test.ts` loads the failing
order in its own process.

Narratives: [2026-08-29 — list links keyed by text](2026-08-29-list-links-keyed-by-text.md),
[2026-08-29 — ListDocument import cycle](2026-08-29-listdocument-import-cycle.md).
