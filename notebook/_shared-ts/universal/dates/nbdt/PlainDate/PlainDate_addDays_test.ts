import { assert, test } from '#test'
import PlainDate from './mod.ts'

const fixtures = [
  {
    description: 'adding positive days',
    date: '2025-08-27',
    daysToAdd: 5,
    expected: '2025-09-01',
  },
  {
    description: 'adding days across month boundary',
    date: '2025-08-30',
    daysToAdd: 3,
    expected: '2025-09-02',
  },
  {
    description: 'adding days across year boundary',
    date: '2025-12-30',
    daysToAdd: 3,
    expected: '2026-01-02',
  },
  {
    description: 'subtracting days (negative)',
    date: '2025-08-27',
    daysToAdd: -5,
    expected: '2025-08-22',
  },
  {
    description: 'subtracting days across month boundary',
    date: '2025-09-02',
    daysToAdd: -3,
    expected: '2025-08-30',
  },
  {
    description: 'subtracting days across year boundary',
    date: '2026-01-02',
    daysToAdd: -3,
    expected: '2025-12-30',
  },
  {
    description: 'adding zero days returns same date',
    date: '2025-08-27',
    daysToAdd: 0,
    expected: '2025-08-27',
  },
  {
    description: 'leap year - adding day to Feb 28',
    date: '2020-02-28',
    daysToAdd: 1,
    expected: '2020-02-29',
  },
  {
    description: 'leap year - adding days past Feb 29',
    date: '2020-02-28',
    daysToAdd: 2,
    expected: '2020-03-01',
  },
  {
    description: 'non-leap year - adding day to Feb 28',
    date: '2021-02-28',
    daysToAdd: 1,
    expected: '2021-03-01',
  },
  {
    description: 'adding many days',
    date: '2025-01-01',
    daysToAdd: 365,
    expected: '2026-01-01',
  },
  {
    description: 'subtracting many days',
    date: '2025-12-31',
    daysToAdd: -365,
    expected: '2024-12-31',
  },
  {
    description: 'month with 31 days to month with 30 days',
    date: '2025-01-31',
    daysToAdd: 31,
    expected: '2025-03-03', // Jan 31 + 31 days = March 3
  },
  {
    description: 'February to March in non-leap year',
    date: '2025-02-01',
    daysToAdd: 28,
    expected: '2025-03-01',
  },
]

fixtures.forEach((fixture) => {
  test(`PlainDate.addDays() - ${fixture.description}`, () => {
    const plainDate = new PlainDate(fixture.date)
    const result = plainDate.addDays(fixture.daysToAdd)

    assert({
      given: `${fixture.date} + ${fixture.daysToAdd} days`,
      should: `return ${fixture.expected}`,
      actual: result.ymd,
      expected: fixture.expected,
    })
  })
})

test('PlainDate.addDays() returns new instance', () => {
  const original = new PlainDate('2025-08-27')
  const result = original.addDays(5)

  assert({
    given: 'calling addDays()',
    should: 'return a different instance',
    actual: original === result,
    expected: false,
  })

  assert({
    given: 'calling addDays()',
    should: 'not modify the original',
    actual: original.ymd,
    expected: '2025-08-27',
  })
})

test('PlainDate.addDays() is chainable', () => {
  const plainDate = new PlainDate('2025-08-27')
  const result = plainDate.addDays(5).addDays(3).addDays(-2)

  assert({
    given: 'chaining addDays(5).addDays(3).addDays(-2)',
    should: 'return correct result',
    actual: result.ymd,
    expected: '2025-09-02', // 27 + 5 + 3 - 2 = 33 days from start of August = Sept 2
  })
})
