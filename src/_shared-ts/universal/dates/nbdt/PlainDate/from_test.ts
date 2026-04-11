import { assert, test } from '#test'
import PlainDate from './mod.ts'

const fixtures = [
  {
    description: 'from object with year, month, day',
    input: { year: 2025, month: 10, day: 1 },
    expected: '2025-10-01',
  },
  {
    description: 'from YMD string',
    input: '2025-10-01',
    expected: '2025-10-01',
  },
  {
    description: 'from partial date string (MM-DD)',
    input: '10-01',
    expected: new Date().getFullYear() + '-10-01',
  },
  {
    description: 'from JavaScript Date object',
    input: new Date(2025, 9, 1), // Month is 0-indexed in Date
    expected: '2025-10-01',
  },
  {
    description: 'from PlainDate instance (copy)',
    input: new PlainDate(2025, 10, 1),
    expected: '2025-10-01',
  },
  {
    description: 'from object with leading zeros',
    input: { year: 2025, month: 1, day: 5 },
    expected: '2025-01-05',
  },
  {
    description: 'from object with last day of month',
    input: { year: 2025, month: 12, day: 31 },
    expected: '2025-12-31',
  },
  {
    description: 'from object with leap day',
    input: { year: 2024, month: 2, day: 29 },
    expected: '2024-02-29',
  },
  {
    description: 'from object with string values',
    input: { year: '2025', month: '10', day: '15' },
    expected: '2025-10-15',
  },
  {
    description: 'from object with padded string values',
    input: { year: '2025', month: '01', day: '05' },
    expected: '2025-01-05',
  },
  {
    description: 'from object with mixed string and number values',
    input: { year: 2025, month: '03', day: 21 },
    expected: '2025-03-21',
  },
]

fixtures.forEach((fixture) => {
  test(`PlainDate.from() - ${fixture.description}`, () => {
    const date = PlainDate.from(fixture.input as any)

    assert({
      given: fixture.description,
      should: `return ${fixture.expected}`,
      actual: date.ymd,
      expected: fixture.expected,
    })
  })
})

test('PlainDate.from() - copy is different instance', () => {
  const original = new PlainDate(2025, 10, 1)
  const copy = PlainDate.from(original)

  assert({
    given: 'PlainDate instance',
    should: 'create a new instance',
    actual: copy !== original,
    expected: true,
  })

  assert({
    given: 'copy of PlainDate',
    should: 'be equal to original',
    actual: copy.equals(original),
    expected: true,
  })
})

const errorFixtures = [
  {
    description: 'invalid input type (number)',
    input: 123,
    errorMessage: 'should throw an error',
  },
  {
    description: 'object with invalid date (Feb 30)',
    input: { year: 2025, month: 2, day: 30 },
    errorMessage: 'should throw an error for non-existent date',
  },
  {
    description: 'object with month 0',
    input: { year: 2025, month: 0, day: 15 },
    errorMessage: 'should throw an error for month 0',
  },
  {
    description: 'object with month 13',
    input: { year: 2025, month: 13, day: 15 },
    errorMessage: 'should throw an error for month 13',
  },
  {
    description: 'object with day 0',
    input: { year: 2025, month: 10, day: 0 },
    errorMessage: 'should throw an error for day 0',
  },
  {
    description: 'object with day 32',
    input: { year: 2025, month: 10, day: 32 },
    errorMessage: 'should throw an error for day 32',
  },
  {
    description: 'non-leap year Feb 29',
    input: { year: 2025, month: 2, day: 29 },
    errorMessage: 'should throw an error for Feb 29 in non-leap year',
  },
]

errorFixtures.forEach((fixture) => {
  test(`PlainDate.from() error - ${fixture.description}`, () => {
    let threwError = false

    try {
      PlainDate.from(fixture.input as any)
    } catch (e) {
      threwError = true
    }

    assert({
      given: fixture.description,
      should: fixture.errorMessage,
      actual: threwError,
      expected: true,
    })
  })
})
