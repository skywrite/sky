import { assert, test } from '#test'
import DayDocument from '#shared/models/Day/mod.ts'

test('DayDocument.perfect returns true when all lists are clear', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~
- ~~Task 2~~

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with all commitments completed',
    should: 'return true',
    actual: day.perfect,
    expected: true,
  })
})

test('DayDocument.perfect returns false when Commitments has incomplete items', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~
- Task 2

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with incomplete commitment',
    should: 'return false',
    actual: day.perfect,
    expected: false,
  })
})

test('DayDocument.perfect returns false when Todos has incomplete items', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~

## Personal Todos
- Incomplete todo item

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with incomplete todo item',
    should: 'return false',
    actual: day.perfect,
    expected: false,
  })
})

test('DayDocument.perfect returns false when Incomplete section exists', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~

## Personal Incomplete
- ~~Moved item~~

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with an Incomplete section',
    should: 'return false',
    actual: day.perfect,
    expected: false,
  })
})

test('DayDocument.perfect returns false when Reminders has incomplete items', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~

## Reminders
- Unfulfilled reminder

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with incomplete reminder',
    should: 'return false',
    actual: day.perfect,
    expected: false,
  })
})

test('DayDocument.perfect returns true when Reminders is empty', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~

## Reminders
-

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with empty Reminders list',
    should: 'return true',
    actual: day.perfect,
    expected: true,
  })
})

test('DayDocument.perfect returns true when Reminders items are all done', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Task 1~~

## Reminders
- ~~Completed reminder~~

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with all reminders completed',
    should: 'return true',
    actual: day.perfect,
    expected: true,
  })
})

test('DayDocument.perfect handles multiple commitment types (Personal, Professional)', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- ~~Personal task~~

## Professional Commitments
- Incomplete work task

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with incomplete Professional commitment',
    should: 'return false',
    actual: day.perfect,
    expected: false,
  })
})

test('DayDocument.perfect returns true with completed timed items', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Commitments
- 09:00 > ~~Morning meeting~~
- 14:00 > ~~Afternoon task~~

## Personal Complete
- ~~Done task~~
`)

  assert({
    given: 'a day with completed timed items',
    should: 'return true',
    actual: day.perfect,
    expected: true,
  })
})

test('DayDocument.perfect returns true for day with no Commitments or Todos lists', () => {
  const day = DayDocument.fromMarkdown(`
# **2024-01-15 - Mon**

## Personal Complete
- ~~Done task~~

## Notes
- Some notes
`)

  assert({
    given: 'a day with only Complete and Notes sections',
    should: 'return true',
    actual: day.perfect,
    expected: true,
  })
})
