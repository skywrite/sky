import * as path from 'node:path'
import readTextFileSync from '#shared/fs/readTextFileSync.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

const __dirname = new URL('.', import.meta.url).pathname
const DIR_FIXTURES = path.join(__dirname, 'fixtures')

const loadFixture = (name: string): string => readTextFileSync(path.join(DIR_FIXTURES, name))

// =============================================================================
// addCompleteItem
// =============================================================================

test('DayDocument.addCompleteItem() adds item to existing Complete list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-full-structure.md'))
  const result = day.addCompleteItem('New complete item', { time: '10:00' })

  const completeList = result.lists.find((l) => l.title === 'Professional Complete')

  assert({
    given: 'a day with existing Professional Complete list',
    should: 'add item to existing list',
    actual: completeList?.items.includes('10:00 > New complete item'),
    expected: true,
  })
})

test('DayDocument.addCompleteItem() creates list after Reminders when list does not exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-full-structure.md'))
  // Remove the Complete lists to test creation
  const dayWithoutComplete = DayDocument.fromMarkdown(
    day
      .toMarkdown()
      .replace(/## Professional Complete[\s\S]*?(?=##|$)/, '')
      .replace(/## Personal Complete[\s\S]*?(?=##|$)/, ''),
  )
  const result = dayWithoutComplete.addCompleteItem('New complete item', { time: '11:00' })

  const remindersIndex = result.lists.findIndex((l) => l.title === 'Reminders')
  const completeIndex = result.lists.findIndex((l) => l.title === 'Professional Complete')

  assert({
    given: 'a day with Reminders but no Complete list',
    should: 'create Complete list after Reminders',
    actual: completeIndex === remindersIndex + 1,
    expected: true,
  })
})

test('DayDocument.addCompleteItem() creates list at end when no Reminders exist', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-todos-no-reminders.md'))
  // Remove Complete lists if any
  const dayWithoutComplete = DayDocument.fromMarkdown(day.toMarkdown().replace(/## .*Complete[\s\S]*?(?=##|$)/g, ''))
  const result = dayWithoutComplete.addCompleteItem('New complete item', { time: '12:00' })

  const completeIndex = result.lists.findIndex((l) => l.title === 'Professional Complete')

  assert({
    given: 'a day without Reminders or Complete lists',
    should: 'create Complete list at the end',
    actual: completeIndex === result.lists.length - 1,
    expected: true,
  })
})

test('DayDocument.addCompleteItem() respects category parameter', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-only-complete.md'))
  const result = day.addCompleteItem('Personal complete', { time: '13:00', category: 'Personal' })

  const personalComplete = result.lists.find((l) => l.title === 'Personal Complete')

  assert({
    given: 'category "Personal"',
    should: 'add to Personal Complete list',
    actual: personalComplete?.items.includes('13:00 > Personal complete'),
    expected: true,
  })
})

test('DayDocument.addCompleteItem() prepends time to item', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-full-structure.md'))
  const result = day.addCompleteItem('Meeting with team', { time: '14:30' })

  const completeList = result.lists.find((l) => l.title === 'Professional Complete')

  assert({
    given: 'a time in options',
    should: 'prepend time to the item',
    actual: completeList?.items.includes('14:30 > Meeting with team'),
    expected: true,
  })
})

test('DayDocument.addCompleteItem() adds item with link to existing list', () => {
  const day = DayDocument.fromMarkdown(loadFixture('day-with-links.md'))
  const links = new Map([['complete-link', { href: 'https://example.com/done', label: 'complete-link' }]])
  const result = day.addCompleteItem('Finished task [complete-link][]', { time: '15:00', links })

  assert({
    given: 'an item with a reference link',
    should: 'add the link to the document',
    actual: result.links.has('complete-link'),
    expected: true,
  })
})
