---
created: 2026-08-31
---

# replaceList locates its list by region, and a miss is an error

## The defect

`ListDocument.replaceList` swapped a list by string replacement:

```ts
this.toMarkdown().replace(list.toMarkdown(), newList.toMarkdown())
```

`ItemList.toMarkdown()` renders `## Heading` with the first bullet directly
beneath it. A file that spells its lists the ordinary hand-written way — a
blank line after the heading — therefore never contains that rendering, the
`.replace` found nothing, and the method returned the document **unchanged
with no error**. Every item mutation funnels through `replaceList`
(`addItem`, `insertItem`, `removeItem`), so adds, strikes, and moves all
no-opped on such files while their commands reported success. The worst
case was `day:items:done` by voice: "Done: …" spoken back, file unwritten.

Machine-written day files matched the rendering exactly, which is why
everything appeared to work. The web day view's checkbox hit the miss on
its first ordinary-markdown test fixture and shipped as a line edit
instead; this fix brings the model itself up to the same standard.

## Wasn't the no-op a design choice?

An old `removeList` test said so — "BY DESIGN: requires no blank lines" —
so the question deserves a straight answer. A real design choice leaves
footprints: the method would refuse loudly, the docs would state the
limit, callers would check the format before trusting the result. None of
that existed; the only place the "choice" lived was that one test comment,
and its own justification was circular — "designed for the compact format
because `ItemList.toMarkdown()` produces the compact format" is a
limitation wearing the word design. The concrete behavior settles it.
Given this file and "mark Buy milk done":

```markdown
## Todos

- Buy milk
- Call mom
```

the old code searched for `## Todos\n- Buy milk\n- Call mom` — no blank
line — found nothing, changed nothing, and the command still answered
`Done: Buy milk`. Saying done over an unchanged file is a bug whatever a
comment calls it; that test's expectation flipped with the fix.

## The fix

`replaceList` now splices by structure. The Nth heading-whose-next-content-
is-a-bullet region in the rendered document is the Nth parsed list; the
target's region — heading line through last bullet, blank runs included
only while more bullets follow, so a loose list swaps whole — is replaced
by the new list's rendering, reassembled with the file's own spelling
between heading and first bullet. Everything outside the region is
untouched, so canonical files round-trip byte for byte and the existing
suite passes unchanged.

Two loud failures replace the silent one: a list that cannot be located by
structure throws, and after the swap the rebuilt document is checked to
actually hold the new list (title and items) — with one carve-out: an
emptied list re-renders as the model's own bare `-` slot and passes.

## Verified

- `ListDocument/_regressions/blank-line-list-spelling_test.ts` — the
  blank-line strike round-trip, the loose-list swap, byte-for-byte
  canonical round-trip, and the emptied-list slot.
- The full unit suite unchanged.
- Live: `day:items:done` run against a scratch notebook (`SKY_DIR`
  override) whose day file used blank-line spelling — the strike now
  lands in the file.

## The rest of the family, same day

`removeList` had the same string-match miss and now removes by the shared
`locateList` (taking one adjacent blank line so neighbours keep a single
separator, and throwing unless the list count actually dropped).

`insertList` was worse than a no-op: it rebuilt the document as
header-plus-lists, dropping prose between and after lists — and on a
blank-line file its header derivation string-matched the first list,
missed, and threw the whole header away (`day:items:add` creating a
missing list would have eaten the day's H1). It now splices the new list
into the document's own text at the right region boundary and throws
unless the list count grew.

`strikeDayItem` (the voice trio's lib) also struck timed items as
`~~HH:MM > task~~`; it now writes `Day.isItemDone`'s own timed form,
`HH:MM > ~~task~~`, the time staying readable — matching the web
checkbox's toggle.

Live, against a scratch notebook with blank-line spelling:
`day:items:done` on a timed item writes the canonical strike, and
`day:items:add commitments` creates the missing list in canonical position
with the header and every other byte intact.
