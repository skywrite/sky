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
- Book the venue

## Reminders

- Water the plants

## Personal Complete
-

[deck]: https://example.com/atlas-deck
`

test({ name: 'DayDocument.deleteItem - takes one line out, every other byte untouched, and says where it was' }, () => {
  const deleted = DayDocument.deleteItem(DAY, 'Professional Todos', 'File the expense report')

  assert({
    given: 'the middle todo deleted by its list and text',
    should: 'drop exactly that line, keep the rest of the file byte for byte, and report it was second',
    actual: deleted.kind === 'written' ? { content: deleted.content, at: deleted.at } : deleted.kind,
    expected: { content: DAY.replace('- File the expense report\n', ''), at: 1 },
  })
})

test({ name: "DayDocument.deleteItem - a list's last item leaves a bare slot, so the list stays a list" }, () => {
  const deleted = DayDocument.deleteItem(DAY, 'Reminders', 'Water the plants')
  const content = deleted.kind === 'written' ? deleted.content : ''

  assert({
    given: 'the only reminder deleted',
    should:
      'leave the heading with a bare `-` under it — the empty list the template writes — which still parses as a list',
    actual: {
      content,
      lists: DayDocument.fromMarkdown(content).lists.map((l) => `${l.title}(${l.size})`),
    },
    expected: {
      content: DAY.replace('- Water the plants', '-'),
      lists: ['Professional Commitments(1)', 'Professional Todos(3)', 'Reminders(0)', 'Personal Complete(0)'],
    },
  })
})

test({ name: 'DayDocument.deleteItem - a struck item is found by its text, marks ignored' }, () => {
  const struck = DayDocument.toggleItem(
    DAY,
    'Professional Commitments',
    '11:00 > Review [the deck][deck] with Jane',
    true,
  )
  const content = struck.kind === 'written' ? struck.content : ''
  const deleted = DayDocument.deleteItem(
    content,
    'Professional Commitments',
    '11:00 > Review [the deck][deck] with Jane',
  )

  assert({
    given: 'a commitment struck, then deleted by its plain text',
    should: 'take the struck line out and keep the link definition',
    actual: deleted.kind === 'written' ? deleted.content : deleted.kind,
    expected: DAY.replace('- 11:00 > Review [the deck][deck] with Jane', '-'),
  })
})

test({ name: 'DayDocument.deleteItem - a miss is named, never a neighbour struck' }, () => {
  assert({
    given: 'a text that is not there, and a list that is not there',
    should: 'answer missing for both, writing nothing',
    actual: [
      DayDocument.deleteItem(DAY, 'Professional Todos', 'A line that is not there').kind,
      DayDocument.deleteItem(DAY, 'Personal Todos', 'Water the plants').kind,
    ],
    expected: ['missing', 'missing'],
  })
})

test({ name: 'DayDocument.restoreItem - undoes a delete byte for byte, at the place reported' }, () => {
  const deleted = DayDocument.deleteItem(DAY, 'Professional Todos', 'File the expense report')
  const content = deleted.kind === 'written' ? deleted.content : ''
  const at = deleted.kind === 'written' ? deleted.at : -1
  const restored = DayDocument.restoreItem(content, 'Professional Todos', 'File the expense report', at)

  assert({
    given: 'the deleted todo put back where it was',
    should: 'give back the original file exactly',
    actual: restored.kind === 'written' ? restored.content : restored.kind,
    expected: DAY,
  })
})

test({ name: 'DayDocument.restoreItem - the bare slot gives way to the item coming back' }, () => {
  const deleted = DayDocument.deleteItem(DAY, 'Reminders', 'Water the plants')
  const content = deleted.kind === 'written' ? deleted.content : ''
  const restored = DayDocument.restoreItem(content, 'Reminders', 'Water the plants', 0)

  assert({
    given: 'the only reminder deleted and then restored',
    should: 'replace the slot with the item — the original file exactly',
    actual: restored.kind === 'written' ? restored.content : restored.kind,
    expected: DAY,
  })
})

test(
  { name: 'DayDocument.restoreItem - past the end lands last; already there is unchanged; no list is missing' },
  () => {
    const shorter = DAY.replace('- Book the venue\n', '')
    const pastEnd = DayDocument.restoreItem(shorter, 'Professional Todos', 'Book the venue', 7)

    assert({
      given: 'a place beyond the list, an item still in its list, and a list that is not there',
      should: 'append for the first, write nothing for the second, and name the missing list',
      actual: [
        pastEnd.kind === 'written' ? pastEnd.content : pastEnd.kind,
        DayDocument.restoreItem(DAY, 'Professional Todos', 'Book the venue', 2).kind,
        DayDocument.restoreItem(DAY, 'Personal Todos', 'Book the venue', 0).kind,
      ],
      expected: [DAY, 'unchanged', 'missing'],
    })
  },
)
