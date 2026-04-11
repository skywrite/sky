import { assert, test } from '#test'
import PlainDate from './mod.ts'

const fixtures = [
  {
    description: 'regular date',
    plainDate: new PlainDate('2025-08-27'),
    expected: '2025-08-27',
  },
  {
    description: 'single digit month and day',
    plainDate: new PlainDate('2025-01-05'),
    expected: '2025-01-05',
  },
  {
    description: 'leap year date',
    plainDate: new PlainDate('2020-02-29'),
    expected: '2020-02-29',
  },
  {
    description: 'end of year',
    plainDate: new PlainDate('2025-12-31'),
    expected: '2025-12-31',
  },
  {
    description: 'beginning of year',
    plainDate: new PlainDate('2025-01-01'),
    expected: '2025-01-01',
  },
  {
    description: 'from Date object maintains padding',
    plainDate: new PlainDate(new Date(2025, 0, 5)), // Jan 5, 2025
    expected: '2025-01-05',
  },
  {
    description: 'from components maintains padding',
    plainDate: new PlainDate(2025, 3, 9),
    expected: '2025-03-09',
  },
]

fixtures.forEach((fixture) => {
  test(`PlainDate.toString() - ${fixture.description}`, () => {
    assert({
      given: fixture.description,
      should: `return "${fixture.expected}"`,
      actual: fixture.plainDate.toString(),
      expected: fixture.expected,
    })
  })
})

test('PlainDate.toString() returns same as ymd property', () => {
  const plainDate = new PlainDate('2025-08-27')

  assert({
    given: 'a PlainDate instance',
    should: 'have toString() return same as ymd property',
    actual: plainDate.toString(),
    expected: plainDate.ymd,
  })
})
