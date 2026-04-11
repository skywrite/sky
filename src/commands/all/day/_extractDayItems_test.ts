import { assert, test } from '#test'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'
import extractDayItems from './_extractDayItems.ts'

test('extractDayItems - legacy EVERY DAY pattern', () => {
  const markdown = `# Recurring Tasks

## EVERY DAY
- Daily task 1
- Daily task 2

## Monday
- Monday task

## WEEKDAYS
- Weekday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const date = new PlainDate(2025, 1, 15) // Wednesday
  const items = extractDayItems(doc, date)

  assert({
    given: 'a Wednesday with EVERY DAY and WEEKDAYS patterns',
    should: 'extract EVERY DAY and WEEKDAYS items',
    actual: items,
    expected: ['Daily task 1', 'Daily task 2', 'Weekday task'],
  })
})

test('extractDayItems - legacy weekday matching', () => {
  const markdown = `# Recurring Tasks

## Monday
- Monday task 1
- Monday task 2

## Tuesday
- Tuesday task

## Wednesday
- Wednesday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const mondayDate = new PlainDate(2025, 1, 13) // Monday
  const items = extractDayItems(doc, mondayDate)

  assert({
    given: 'a Monday with weekday-specific patterns',
    should: 'extract only Monday items',
    actual: items,
    expected: ['Monday task 1', 'Monday task 2'],
  })
})

test('extractDayItems - legacy WEEKEND pattern', () => {
  const markdown = `# Recurring Tasks

## WEEKEND
- Weekend task 1
- Weekend task 2

## Saturday
- Saturday task

## Sunday
- Sunday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const saturdayDate = new PlainDate(2025, 1, 18) // Saturday
  const items = extractDayItems(doc, saturdayDate)

  assert({
    given: 'a Saturday with WEEKEND and Saturday patterns',
    should: 'extract both WEEKEND and Saturday items',
    actual: items,
    expected: ['Weekend task 1', 'Weekend task 2', 'Saturday task'],
  })
})

test('extractDayItems - new EVERY-DAY pattern', () => {
  const markdown = `# Recurring Tasks

## EVERY-DAY
- New daily task 1
- New daily task 2

## EVERY-WEEKDAY
- New weekday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const date = new PlainDate(2025, 1, 15) // Wednesday
  const items = extractDayItems(doc, date)

  assert({
    given: 'a Wednesday with new EVERY-DAY and EVERY-WEEKDAY patterns',
    should: 'extract matching items',
    actual: items,
    expected: ['New daily task 1', 'New daily task 2', 'New weekday task'],
  })
})

test('extractDayItems - new MONTHLY patterns', () => {
  const markdown = `# Recurring Tasks

## MONTHLY-15
- Mid-month task 1
- Mid-month task 2

## MONTHLY-LAST
- End of month task

## MONTHLY-1
- Start of month task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const midMonthDate = new PlainDate(2025, 1, 15) // 15th of January
  const items = extractDayItems(doc, midMonthDate)

  assert({
    given: 'the 15th of the month with MONTHLY patterns',
    should: 'extract only MONTHLY-15 items',
    actual: items,
    expected: ['Mid-month task 1', 'Mid-month task 2'],
  })
})

test('extractDayItems - new MONTHLY-FIRST-MON pattern', () => {
  const markdown = `# Recurring Tasks

## MONTHLY-FIRST-MON
- First Monday task

## MONTHLY-SECOND-MON
- Second Monday task

## MONTHLY-LAST-FRI
- Last Friday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const firstMondayDate = new PlainDate(2025, 1, 6) // First Monday of January 2025
  const items = extractDayItems(doc, firstMondayDate)

  assert({
    given: 'the first Monday of the month',
    should: 'extract only MONTHLY-FIRST-MON items',
    actual: items,
    expected: ['First Monday task'],
  })
})

test('extractDayItems - mixed legacy and new patterns', () => {
  const markdown = `# Recurring Tasks

## EVERY DAY
- Legacy daily task

## EVERY-DAY
- New daily task

## Monday
- Legacy Monday task

## EVERY-MON
- New Monday task

## MONTHLY-FIRST-MON
- First Monday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const firstMondayDate = new PlainDate(2025, 1, 6) // First Monday of January 2025
  const items = extractDayItems(doc, firstMondayDate)

  assert({
    given: 'the first Monday with mixed legacy and new patterns',
    should: 'extract all matching items from both systems',
    actual: items.sort(),
    expected: [
      'First Monday task',
      'Legacy Monday task',
      'Legacy daily task',
      'New Monday task',
      'New daily task',
    ].sort(),
  })
})

test('extractDayItems - no matching patterns', () => {
  const markdown = `# Recurring Tasks

## Tuesday
- Tuesday task

## MONTHLY-15
- Mid-month task
`

  const doc = ListDocument.fromMarkdown(markdown)
  const date = new PlainDate(2025, 1, 13) // Monday the 13th
  const items = extractDayItems(doc, date)

  assert({
    given: 'a Monday the 13th with no matching patterns',
    should: 'return empty array',
    actual: items,
    expected: [],
  })
})

test('extractDayItems - QUARTERLY patterns', () => {
  const markdown = `# Recurring Tasks

## QUARTERLY-1
- First day of quarter

## QUARTERLY-LAST
- Last day of quarter

## QUARTERLY-FIRST-MON
- First Monday of quarter
`

  const doc = ListDocument.fromMarkdown(markdown)
  const firstDayQ1 = new PlainDate(2025, 1, 1) // January 1st
  const items = extractDayItems(doc, firstDayQ1)

  assert({
    given: 'January 1st with QUARTERLY patterns',
    should: 'extract QUARTERLY-1 items',
    actual: items,
    expected: ['First day of quarter'],
  })
})

test('extractDayItems - ALTERNATE patterns', () => {
  const markdown = `# Recurring Tasks

## ALTERNATE-MON
- Bi-weekly Monday task

## EVERY-MON
- Every Monday task
`

  const doc = ListDocument.fromMarkdown(markdown)
  // First Monday of 2025 is January 6
  const firstMonday = new PlainDate(2025, 1, 6)
  const secondMonday = new PlainDate(2025, 1, 13)
  const thirdMonday = new PlainDate(2025, 1, 20)

  const firstItems = extractDayItems(doc, firstMonday)
  assert({
    given: 'the first Monday of the year',
    should: 'extract both ALTERNATE-MON and EVERY-MON',
    actual: firstItems.sort(),
    expected: ['Bi-weekly Monday task', 'Every Monday task'].sort(),
  })

  const secondItems = extractDayItems(doc, secondMonday)
  assert({
    given: 'the second Monday of the year',
    should: 'extract only EVERY-MON (not ALTERNATE)',
    actual: secondItems,
    expected: ['Every Monday task'],
  })

  const thirdItems = extractDayItems(doc, thirdMonday)
  assert({
    given: 'the third Monday of the year',
    should: 'extract both ALTERNATE-MON and EVERY-MON again',
    actual: thirdItems.sort(),
    expected: ['Bi-weekly Monday task', 'Every Monday task'].sort(),
  })
})
