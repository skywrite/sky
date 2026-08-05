import DayDocument from '#shared/models/Day/mod.ts'
import { assert, test } from '#test'

test('removeEmptyLists removes all empty lists', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
-

## Personal Complete
-

## Professional Commitments
-

## Professional Complete
-
`)

  const result = day.removeEmptyLists()

  assert({
    given: 'a day where all lists are empty',
    should: 'remove all lists',
    actual: result.lists.length,
    expected: 0,
  })
})

test('removeEmptyLists keeps non-empty lists', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Professional Commitments
- Important task

## Professional Complete
- 09:00 > ~~Morning standup~~
`)

  const result = day.removeEmptyLists()

  assert({
    given: 'a day where all lists have items',
    should: 'keep all lists',
    actual: result.lists.map((l) => l.title),
    expected: ['Professional Commitments', 'Professional Complete'],
  })
})

test('removeEmptyLists removes only empty lists from a mix', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
-

## Personal Todos
-

## Professional Complete
- 09:00 > ~~Morning standup~~
- 10:00 > ~~Code review~~

## Personal Complete
-
`)

  const result = day.removeEmptyLists()

  assert({
    given: 'a day with a mix of empty and non-empty lists',
    should: 'keep only non-empty lists',
    actual: result.lists.map((l) => l.title),
    expected: ['Professional Complete'],
  })
})

test('removeEmptyLists returns same document when no empty lists', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Professional Commitments
- Task 1

## Professional Complete
- 09:00 > ~~Done~~
`)

  const result = day.removeEmptyLists()

  assert({
    given: 'a day with no empty lists',
    should: 'return document with same lists',
    actual: result.lists.map((l) => l.title),
    expected: ['Professional Commitments', 'Professional Complete'],
  })
})
