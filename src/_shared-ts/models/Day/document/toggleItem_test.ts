import { assert, test } from '#test'
import DayDocument from './mod.ts'

const DAY = `---
date: 2026-03-30
---

# **2026-03-30 - Mon**

## Professional Commitments

- 11:00 > Review [the deck][deck] with Jane

## Professional Todos

- Draft the Q2 roadmap
- File the expense report

## Reminders

- Water the plants

[deck]: https://example.com/atlas-deck
`

test({ name: 'DayDocument.toggleItem - strikes one line in place, every other byte untouched' }, () => {
  const struck = DayDocument.toggleItem(DAY, 'Professional Todos', 'File the expense report', true)

  assert({
    given: 'a todo checked in a blank-line-spelled day',
    should: 'strike exactly that line and keep the rest of the file byte for byte',
    actual: struck.kind === 'written' ? struck.content : struck.kind,
    expected: DAY.replace('- File the expense report', '- ~~File the expense report~~'),
  })
})

test({ name: "DayDocument.toggleItem - a timed item strikes in isItemDone's own timed form" }, () => {
  const struck = DayDocument.toggleItem(
    DAY,
    'Professional Commitments',
    '11:00 > Review [the deck][deck] with Jane',
    true,
  )
  const content = struck.kind === 'written' ? struck.content : ''

  assert({
    given: 'a timed commitment with a reference link, checked',
    should: 'keep the time outside the marks, satisfy isItemDone, and keep the link definition',
    actual: {
      line: content.includes('- 11:00 > ~~Review [the deck][deck] with Jane~~'),
      isDone: DayDocument.isItemDone('11:00 > ~~Review [the deck][deck] with Jane~~'),
      definition: content.includes('[deck]: https://example.com/atlas-deck'),
    },
    expected: { line: true, isDone: true, definition: true },
  })
})

test({ name: 'DayDocument.toggleItem - un-striking restores the original line, addressed by plain text' }, () => {
  const struck = DayDocument.toggleItem(DAY, 'Professional Todos', 'File the expense report', true)
  const content = struck.kind === 'written' ? struck.content : ''
  // Undo addresses the line by its text alone — strike marks in the stored line are ignored.
  const restored = DayDocument.toggleItem(content, 'Professional Todos', 'File the expense report', false)

  assert({
    given: 'the struck day un-checked by the original text',
    should: 'give back the original file exactly',
    actual: restored.kind === 'written' ? restored.content : restored.kind,
    expected: DAY,
  })
})

test({ name: 'DayDocument.toggleItem - unchanged and missing are named, never silent' }, () => {
  assert({
    given: 'a not-done item asked to be not done, and texts or lists that are not there',
    should: 'answer unchanged for the first and missing for the rest, writing nothing',
    actual: [
      DayDocument.toggleItem(DAY, 'Reminders', 'Water the plants', false).kind,
      DayDocument.toggleItem(DAY, 'Professional Todos', 'A line that is not there', true).kind,
      DayDocument.toggleItem(DAY, 'Personal Todos', 'Water the plants', true).kind,
    ],
    expected: ['unchanged', 'missing', 'missing'],
  })
})
