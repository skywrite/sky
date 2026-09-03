/**
 * A file that spells its lists with a blank line after the heading —
 * ordinary hand-written markdown — used to defeat every item mutation:
 * `replaceList` swapped lists by string-matching `ItemList.toMarkdown()`
 * (which renders no blank line), found nothing, and returned the document
 * UNCHANGED with no error. Callers wrote the unchanged text back and
 * reported success — `day:items:done` answered "Done" over an unwritten
 * file. The swap now locates the list region by structure; these pin it.
 */

import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { assert, test } from '#test'

const BLANK_LINE_DAY = `---
date: 2026-01-27
---

# **2026-01-27 - Tue**

## Professional Todos

- Reply to the vendor shortlist
- File the expense report

## Reminders

- Water the plants
`

test({ name: 'ListDocument.replaceList - a blank line after the heading no longer hides the list' }, () => {
  const doc = ListDocument.fromMarkdown(BLANK_LINE_DAY)
  const struck = doc
    .removeItem('Professional Todos', 1)
    .insertItem('Professional Todos', '~~File the expense report~~', 1)

  assert({
    given: 'a day spelled with blank lines after its list headings, one item struck via remove + insert',
    should: "hold the struck item — and keep the file's own spelling and every other byte",
    actual: struck.toMarkdown(),
    expected: BLANK_LINE_DAY.replace('- File the expense report', '- ~~File the expense report~~'),
  })
})

test({ name: 'ListDocument.replaceList - a hand-written loose list swaps whole' }, () => {
  const loose = `# Plans

## Errands

- Post office

- Hardware store

Closing prose stays put.
`
  const doc = ListDocument.fromMarkdown(loose)
  const updated = doc.removeItem('Errands', 1)

  assert({
    given: 'a list whose items are separated by blank lines, its second item removed',
    should: 'take the whole region — the removed item must not survive as a stray bullet',
    actual: {
      items: updated.lists[0].items,
      strayBullet: updated.toMarkdown().includes('- Hardware store'),
      prose: updated.toMarkdown().includes('Closing prose stays put.'),
    },
    expected: { items: ['Post office'], strayBullet: false, prose: true },
  })
})

test({ name: 'ListDocument.replaceList - canonical spelling round-trips byte for byte' }, () => {
  const canonical = `---
date: 2026-01-27
---

# **2026-01-27 - Tue**

## Professional Todos
- Reply to the vendor shortlist
- File the expense report

## Reminders
- Water the plants
`
  const doc = ListDocument.fromMarkdown(canonical)
  const there = doc.removeItem('Professional Todos', 1).insertItem('Professional Todos', 'File the expense report', 1)

  assert({
    given: 'a machine-written day, one item removed and re-inserted verbatim',
    should: 'reproduce the original document exactly',
    actual: there.toMarkdown(),
    expected: canonical,
  })
})

test({ name: 'ListDocument.replaceList - emptying a list leaves the bare slot, not an error' }, () => {
  const doc = ListDocument.fromMarkdown(BLANK_LINE_DAY)
  const emptied = doc.removeItem('Reminders', 0)

  assert({
    given: 'the only item of a blank-line-spelled list removed',
    should: "render the model's own bare `-` slot under the heading",
    actual: emptied.toMarkdown().includes('## Reminders\n\n-'),
    expected: true,
  })
})

test({ name: 'ListDocument.removeList - a blank-line-spelled list actually leaves' }, () => {
  const doc = ListDocument.fromMarkdown(BLANK_LINE_DAY)
  const without = doc.removeList(0)

  assert({
    given: 'a blank-line day with its first list removed',
    should: 'drop the whole region, one separator collapsed, everything else untouched',
    actual: without.toMarkdown(),
    expected: BLANK_LINE_DAY.replace(
      '## Professional Todos\n\n- Reply to the vendor shortlist\n- File the expense report\n\n',
      '',
    ),
  })
})

test({ name: 'ListDocument.insertList - the document is spliced, never rebuilt' }, () => {
  const withProse = `# Plans

Opening thoughts stay put.

## Errands

- Post office

Notes between the lists stay put.

## Calls

- Dentist

Closing prose stays put.
`
  const doc = ListDocument.fromMarkdown(withProse)
  const inserted = doc.insertList(1, 'Groceries').addItem('Groceries', 'Milk')

  assert({
    given: 'a prose-carrying, blank-line-spelled document with a list inserted between two others',
    should: 'hold the new list in place and keep every line of prose — the rebuild used to drop them all',
    actual: {
      titles: inserted.lists.map((l) => l.title),
      opening: inserted.toMarkdown().includes('Opening thoughts stay put.'),
      between: inserted.toMarkdown().includes('Notes between the lists stay put.'),
      closing: inserted.toMarkdown().includes('Closing prose stays put.'),
      spelling: inserted.toMarkdown().includes('## Errands\n\n- Post office'),
    },
    expected: {
      titles: ['Errands', 'Groceries', 'Calls'],
      opening: true,
      between: true,
      closing: true,
      spelling: true,
    },
  })
})
