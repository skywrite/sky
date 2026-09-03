---
created: 2026-08-29
updated: 2026-08-31
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

## replaceList finds its list by structure, never by string match

Every item mutation on a `ListDocument` — `addItem`, `insertItem`,
`removeItem` — lands in `replaceList`, which swaps one list's markdown for
its replacement. It used to do that with a substring replace of
`ItemList.toMarkdown()`, which renders no blank line after the heading — so
a file spelled the ordinary hand-written way made the replace find nothing
and return the document unchanged, with no error. Callers wrote the
unchanged text back and reported success; `day:items:done` answered "Done"
over an unwritten file.

The swap now locates the Nth heading-with-bullets region by line structure
(`locateList`), keeps the file's own spelling between heading and first
bullet, includes blank runs inside a loose list, and throws when the list
cannot be located or the reparse does not hold the new list — a failed
write is an error, never a silent no-op. `removeList` removes by the same
locator (one adjacent separator collapsed), and `insertList` splices into
the document's own text instead of rebuilding it as header-plus-lists — the
rebuild dropped prose between and after lists, and lost the whole header
whenever the first list could not be string-matched. Canonical
machine-written files round-trip byte for byte.
`ListDocument/_regressions/blank-line-list-spelling_test.ts` pins the
shapes.

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
[2026-08-29 — ListDocument import cycle](2026-08-29-listdocument-import-cycle.md),
[2026-08-31 — replaceList locates by region](2026-08-31-replacelist-locates-by-region.md).
