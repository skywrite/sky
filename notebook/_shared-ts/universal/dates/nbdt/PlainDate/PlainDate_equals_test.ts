import { assert, test } from '#test'
import PlainDate from './mod.ts'

const fixtures = [
  {
    description: 'same dates are equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate('2025-08-27'),
    expected: true,
  },
  {
    description: 'different dates are not equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate('2025-08-28'),
    expected: false,
  },
  {
    description: 'same date from different constructors are equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate(2025, 8, 27),
    expected: true,
  },
  {
    description: 'same date from Date object and string are equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate(new Date(2025, 7, 27)), // August is month 7 in 0-indexed
    expected: true,
  },
  {
    description: 'different years are not equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate('2024-08-27'),
    expected: false,
  },
  {
    description: 'different months are not equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate('2025-09-27'),
    expected: false,
  },
  {
    description: 'different days are not equal',
    date1: new PlainDate('2025-08-27'),
    date2: new PlainDate('2025-08-26'),
    expected: false,
  },
  {
    description: 'leap year date equals itself',
    date1: new PlainDate('2020-02-29'),
    date2: new PlainDate('2020-02-29'),
    expected: true,
  },
]

fixtures.forEach((fixture) => {
  test(`PlainDate.equals() - ${fixture.description}`, () => {
    assert({
      given: fixture.description,
      should: `return ${fixture.expected}`,
      actual: fixture.date1.equals(fixture.date2),
      expected: fixture.expected,
    })
  })
})

test('PlainDate.equals() is reflexive', () => {
  const date = new PlainDate('2025-08-27')

  assert({
    given: 'a PlainDate instance',
    should: 'equal itself',
    actual: date.equals(date),
    expected: true,
  })
})

test('PlainDate.equals() is symmetric', () => {
  const date1 = new PlainDate('2025-08-27')
  const date2 = new PlainDate('2025-08-27')

  assert({
    given: 'two equal PlainDate instances',
    should: 'have symmetric equality',
    actual: date1.equals(date2) === date2.equals(date1),
    expected: true,
  })
})
