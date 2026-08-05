import ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, test } from '#test'

// Collapsed reference links [label][] lose their definitions when moved between
// sections via removeItem + addItem. This is because replaceList's link cleanup
// deletes the document-level link when the ItemList-level link key matches.
// Full reference links [text][label] survive by accident (key mismatch).
//
// Fix: extract links via Document.referenceLinks() before removeItem,
// then pass them to addItem via opts.links.

const markdownCollapsedRef = `---
tags: Test
---

# **2026-02-05 - Wed**

## Professional Todos
- Review [design_doc][]
- Fix auth bug

## Professional Dropped
-

## Professional Complete
-

[design_doc]: https://docs.example.com/design
`

const markdownCollapsedRefNoDropped = `---
tags: Test
---

# **2026-02-05 - Wed**

## Professional Todos
- Review [design_doc][]
- Fix auth bug

## Professional Complete
-

[design_doc]: https://docs.example.com/design
`

test('collapsed ref: removeItem + addItem WITHOUT links loses reference definition', function () {
  const doc = ListDocument.fromMarkdown(markdownCollapsedRef)

  // Bug: removeItem deletes the link from the document, addItem doesn't restore it
  const newDoc = doc.removeItem('Professional Todos', 0).addItem('Professional Dropped', 'Review [design_doc][]')

  assert({
    given: 'collapsed ref moved without preserving links (the bug)',
    should: 'lose the reference link definition',
    expected: false,
    actual: newDoc.toMarkdown().includes('[design_doc]: https://docs.example.com/design'),
  })
})

test('collapsed ref: removeItem + addItem WITH referenceLinks preserves definition', function () {
  const doc = ListDocument.fromMarkdown(markdownCollapsedRef)

  // Fix: extract links from the document before removing
  const itemLinks = doc.referenceLinks('Review [design_doc][]')

  const newDoc = doc
    .removeItem('Professional Todos', 0)
    .addItem('Professional Dropped', 'Review [design_doc][]', { links: itemLinks })

  const output = newDoc.toMarkdown()

  assert({
    given: 'collapsed ref moved with referenceLinks (the fix)',
    should: 'preserve the reference link definition',
    expected: true,
    actual: output.includes('[design_doc]: https://docs.example.com/design'),
  })

  assert({
    given: 'collapsed ref moved with referenceLinks (the fix)',
    should: 'have the item in the target list',
    expected: true,
    actual: output.includes('- Review [design_doc][]'),
  })
})

test('collapsed ref: new section via empty addList + addItem WITH links preserves definition', function () {
  const doc = ListDocument.fromMarkdown(markdownCollapsedRefNoDropped)

  const itemLinks = doc.referenceLinks('Review [design_doc][]')

  let newDoc = doc.removeItem('Professional Todos', 0)

  const emptyDroppedList = ItemList.fromArray({ title: 'Professional Dropped' }, [])
  newDoc = newDoc.addList(emptyDroppedList)
  newDoc = newDoc.addItem('Professional Dropped', 'Review [design_doc][]', { links: itemLinks })

  const output = newDoc.toMarkdown()

  assert({
    given: 'collapsed ref moved to new section with referenceLinks',
    should: 'preserve the reference link definition',
    expected: true,
    actual: output.includes('[design_doc]: https://docs.example.com/design'),
  })
})

test('full ref: removeItem + addItem preserves link without explicit links', function () {
  // Full reference links [text][label] survive by accident (key mismatch between
  // ItemList._links and Document._links), so no explicit link passing needed.
  // This test documents the current behavior.
  const markdownFullRef = `---
tags: Test
---

# **2026-02-05 - Wed**

## Professional Todos
- Review [design doc][design_doc]
- Fix auth bug

## Professional Dropped
-

## Professional Complete
-

[design_doc]: https://docs.example.com/design
`
  const doc = ListDocument.fromMarkdown(markdownFullRef)

  const newDoc = doc
    .removeItem('Professional Todos', 0)
    .addItem('Professional Dropped', 'Review [design doc][design_doc]')

  assert({
    given: 'full ref [text][label] moved without explicit links',
    should: 'preserve reference definition (survives due to key mismatch)',
    expected: true,
    actual: newDoc.toMarkdown().includes('[design_doc]: https://docs.example.com/design'),
  })
})
