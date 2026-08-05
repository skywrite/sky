import { assert, test } from '#test'
import PlainDate from '../PlainDate/mod.ts'
import PlainYearMonth from './mod.ts'

// ============================================================================
// Constructor tests
// ============================================================================

const constructorFixtures: Array<{
  description: string
  input: unknown[]
  expected?: { year: number; month: number; str?: string }
  shouldThrow?: boolean
  errorPattern?: RegExp
}> = [
  {
    description: 'no arguments returns current month',
    input: [],
    expected: (() => {
      const now = new Date()
      return { year: now.getFullYear(), month: now.getMonth() + 1 }
    })(),
  },
  {
    description: 'YYYY-MM string',
    input: ['2025-08'],
    expected: { year: 2025, month: 8, str: '2025-08' },
  },
  {
    description: 'YYYY-MM-DD string (ignores day)',
    input: ['2025-08-27'],
    expected: { year: 2025, month: 8, str: '2025-08' },
  },
  {
    description: 'single-digit month string',
    input: ['2025-1'],
    expected: { year: 2025, month: 1, str: '2025-01' },
  },
  {
    description: 'from Date object',
    input: [new Date(2025, 7, 15)], // August 2025
    expected: { year: 2025, month: 8, str: '2025-08' },
  },
  {
    description: 'from year and month numbers',
    input: [2025, 8],
    expected: { year: 2025, month: 8, str: '2025-08' },
  },
  {
    description: 'from PlainDate',
    input: [new PlainDate(2025, 8, 27)],
    expected: { year: 2025, month: 8, str: '2025-08' },
  },
  {
    description: 'January',
    input: [2025, 1],
    expected: { year: 2025, month: 1, str: '2025-01' },
  },
  {
    description: 'December',
    input: [2025, 12],
    expected: { year: 2025, month: 12, str: '2025-12' },
  },
  {
    description: 'invalid month 0 throws',
    input: [2025, 0],
    shouldThrow: true,
    errorPattern: /Invalid month/,
  },
  {
    description: 'invalid month 13 throws',
    input: [2025, 13],
    shouldThrow: true,
    errorPattern: /Invalid month/,
  },
  {
    description: 'invalid string format throws',
    input: ['2025'],
    shouldThrow: true,
    errorPattern: /Invalid year-month string/,
  },
  {
    description: 'invalid string with bad month throws',
    input: ['2025-13'],
    shouldThrow: true,
    errorPattern: /Invalid month/,
  },
]

constructorFixtures.forEach((fixture) => {
  test(`PlainYearMonth constructor - ${fixture.description}`, () => {
    if (fixture.shouldThrow) {
      assert({
        given: fixture.description,
        should: 'throw an error',
        actual: (() => {
          try {
            // @ts-ignore - intentionally testing various input combinations
            new PlainYearMonth(...fixture.input)
            return false
          } catch (error) {
            return fixture.errorPattern ? fixture.errorPattern.test((error as Error).message) : true
          }
        })(),
        expected: true,
      })
    } else {
      // @ts-ignore - intentionally testing various input combinations
      const ym = new PlainYearMonth(...fixture.input)
      const expected = fixture.expected!

      assert({
        given: fixture.description,
        should: `have year ${expected.year}`,
        actual: ym.year,
        expected: expected.year,
      })

      assert({
        given: fixture.description,
        should: `have month ${expected.month}`,
        actual: ym.month,
        expected: expected.month,
      })

      if (expected.str) {
        assert({
          given: fixture.description,
          should: `have toString ${expected.str}`,
          actual: ym.toString(),
          expected: expected.str,
        })
      }
    }
  })
})

// ============================================================================
// Static from() tests
// ============================================================================

test('PlainYearMonth.from() - from PlainYearMonth', () => {
  const original = new PlainYearMonth(2025, 8)
  const copy = PlainYearMonth.from(original)

  assert({
    given: 'PlainYearMonth.from(PlainYearMonth)',
    should: 'create a copy',
    actual: copy.toString(),
    expected: '2025-08',
  })
})

test('PlainYearMonth.from() - from PlainDate', () => {
  const date = new PlainDate(2025, 8, 27)
  const ym = PlainYearMonth.from(date)

  assert({
    given: 'PlainYearMonth.from(PlainDate)',
    should: 'extract year and month',
    actual: ym.toString(),
    expected: '2025-08',
  })
})

test('PlainYearMonth.from() - from object with year/month', () => {
  const ym = PlainYearMonth.from({ year: 2025, month: 8 })

  assert({
    given: 'PlainYearMonth.from({ year, month })',
    should: 'create PlainYearMonth',
    actual: ym.toString(),
    expected: '2025-08',
  })
})

test('PlainYearMonth.from() - from object with string values', () => {
  const ym = PlainYearMonth.from({ year: '2025', month: '08' })

  assert({
    given: 'PlainYearMonth.from({ year: string, month: string })',
    should: 'parse string values',
    actual: ym.toString(),
    expected: '2025-08',
  })
})

// ============================================================================
// Compare tests
// ============================================================================

const compareFixtures = [
  { a: '2024-01', b: '2024-01', expected: 0 as const, description: 'same month' },
  { a: '2024-01', b: '2024-02', expected: -1 as const, description: 'a is one month before b' },
  { a: '2024-02', b: '2024-01', expected: 1 as const, description: 'a is one month after b' },
  { a: '2023-12', b: '2024-01', expected: -1 as const, description: 'a is in previous year' },
  { a: '2024-01', b: '2023-12', expected: 1 as const, description: 'a is in next year' },
  { a: '2024-06', b: '2025-06', expected: -1 as const, description: 'same month different year' },
]

compareFixtures.forEach((fixture) => {
  test(`PlainYearMonth.compare - ${fixture.description}`, () => {
    const a = new PlainYearMonth(fixture.a)
    const b = new PlainYearMonth(fixture.b)

    assert({
      given: `comparing ${fixture.a} to ${fixture.b}`,
      should: `return ${fixture.expected}`,
      actual: PlainYearMonth.compare(a, b),
      expected: fixture.expected,
    })
  })
})

test('PlainYearMonth.compare - works as Array.sort comparator', () => {
  const months = [
    new PlainYearMonth('2024-06'),
    new PlainYearMonth('2024-01'),
    new PlainYearMonth('2023-12'),
    new PlainYearMonth('2024-03'),
  ]

  const sorted = [...months].sort(PlainYearMonth.compare)

  assert({
    given: 'an unsorted array of PlainYearMonths',
    should: 'sort them in ascending order',
    actual: sorted.map((m) => m.toString()),
    expected: ['2023-12', '2024-01', '2024-03', '2024-06'],
  })
})

// ============================================================================
// Property tests
// ============================================================================

test('PlainYearMonth.yearPadded - pads year to 4 digits', () => {
  assert({
    given: 'year 2025',
    should: 'return "2025"',
    actual: new PlainYearMonth(2025, 1).yearPadded,
    expected: '2025',
  })
})

test('PlainYearMonth.monthPadded - pads month to 2 digits', () => {
  assert({
    given: 'month 1',
    should: 'return "01"',
    actual: new PlainYearMonth(2025, 1).monthPadded,
    expected: '01',
  })

  assert({
    given: 'month 12',
    should: 'return "12"',
    actual: new PlainYearMonth(2025, 12).monthPadded,
    expected: '12',
  })
})

const daysInMonthFixtures = [
  { year: 2025, month: 1, expected: 31, description: 'January' },
  { year: 2025, month: 2, expected: 28, description: 'February (non-leap)' },
  { year: 2024, month: 2, expected: 29, description: 'February (leap year)' },
  { year: 2025, month: 4, expected: 30, description: 'April' },
  { year: 2025, month: 12, expected: 31, description: 'December' },
]

daysInMonthFixtures.forEach((fixture) => {
  test(`PlainYearMonth.daysInMonth - ${fixture.description}`, () => {
    const ym = new PlainYearMonth(fixture.year, fixture.month)

    assert({
      given: `${fixture.year}-${fixture.month}`,
      should: `have ${fixture.expected} days`,
      actual: ym.daysInMonth,
      expected: fixture.expected,
    })
  })
})

const leapYearFixtures = [
  { year: 2024, expected: true, description: 'divisible by 4' },
  { year: 2025, expected: false, description: 'not divisible by 4' },
  { year: 2000, expected: true, description: 'divisible by 400' },
  { year: 1900, expected: false, description: 'divisible by 100 but not 400' },
]

leapYearFixtures.forEach((fixture) => {
  test(`PlainYearMonth.inLeapYear - ${fixture.description}`, () => {
    const ym = new PlainYearMonth(fixture.year, 1)

    assert({
      given: `year ${fixture.year}`,
      should: `${fixture.expected ? 'be' : 'not be'} a leap year`,
      actual: ym.inLeapYear,
      expected: fixture.expected,
    })
  })
})

// ============================================================================
// Method tests
// ============================================================================

test('PlainYearMonth.equals - same month returns true', () => {
  const a = new PlainYearMonth(2025, 8)
  const b = new PlainYearMonth(2025, 8)

  assert({
    given: 'two PlainYearMonths with same year and month',
    should: 'return true',
    actual: a.equals(b),
    expected: true,
  })
})

test('PlainYearMonth.equals - different month returns false', () => {
  const a = new PlainYearMonth(2025, 8)
  const b = new PlainYearMonth(2025, 9)

  assert({
    given: 'two PlainYearMonths with different months',
    should: 'return false',
    actual: a.equals(b),
    expected: false,
  })
})

test('PlainYearMonth.toPlainDate - default day is 1', () => {
  const ym = new PlainYearMonth(2025, 8)
  const date = ym.toPlainDate()

  assert({
    given: 'toPlainDate() with no argument',
    should: 'return first day of month',
    actual: date.toString(),
    expected: '2025-08-01',
  })
})

test('PlainYearMonth.toPlainDate - with specific day', () => {
  const ym = new PlainYearMonth(2025, 8)
  const date = ym.toPlainDate(15)

  assert({
    given: 'toPlainDate(15)',
    should: 'return 15th of month',
    actual: date.toString(),
    expected: '2025-08-15',
  })
})

const addFixtures = [
  { start: '2025-01', add: 1, expected: '2025-02', description: 'add 1 month' },
  { start: '2025-12', add: 1, expected: '2026-01', description: 'add 1 month crossing year' },
  { start: '2025-06', add: 6, expected: '2025-12', description: 'add 6 months' },
  { start: '2025-06', add: 12, expected: '2026-06', description: 'add 12 months' },
  { start: '2025-01', add: 25, expected: '2027-02', description: 'add 25 months' },
]

addFixtures.forEach((fixture) => {
  test(`PlainYearMonth.add - ${fixture.description}`, () => {
    const ym = new PlainYearMonth(fixture.start)
    const result = ym.add(fixture.add)

    assert({
      given: `${fixture.start} + ${fixture.add} months`,
      should: `equal ${fixture.expected}`,
      actual: result.toString(),
      expected: fixture.expected,
    })
  })
})

const subtractFixtures = [
  { start: '2025-02', subtract: 1, expected: '2025-01', description: 'subtract 1 month' },
  { start: '2025-01', subtract: 1, expected: '2024-12', description: 'subtract 1 month crossing year' },
  { start: '2025-06', subtract: 6, expected: '2024-12', description: 'subtract 6 months' },
  { start: '2025-06', subtract: 12, expected: '2024-06', description: 'subtract 12 months' },
  { start: '2025-01', subtract: 25, expected: '2022-12', description: 'subtract 25 months' },
]

subtractFixtures.forEach((fixture) => {
  test(`PlainYearMonth.subtract - ${fixture.description}`, () => {
    const ym = new PlainYearMonth(fixture.start)
    const result = ym.subtract(fixture.subtract)

    assert({
      given: `${fixture.start} - ${fixture.subtract} months`,
      should: `equal ${fixture.expected}`,
      actual: result.toString(),
      expected: fixture.expected,
    })
  })
})
