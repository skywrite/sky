import { assert, test } from '#test'
import PlainDate from './mod.ts'

type ExpectedResult = {
  year: number
  month: number
  day: number
  ymd?: string
}

const fixtures: Array<{
  description: string
  input: any[]
  expected?: ExpectedResult | (() => ExpectedResult)
  shouldThrow?: boolean
  errorPattern?: RegExp
}> = [
  {
    description: 'no arguments returns today',
    input: [],
    expected: () => {
      const today = new Date()
      return {
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: today.getDate(),
      }
    },
  },
  {
    description: 'full YMD string',
    input: ['2025-08-27'],
    expected: { year: 2025, month: 8, day: 27, ymd: '2025-08-27' },
  },
  {
    description: 'partial date - day only (27)',
    input: ['27'],
    expected: () => {
      const today = new Date()
      return {
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: 27,
      }
    },
  },
  {
    description: 'partial date - month and day (8-27)',
    input: ['8-27'],
    expected: () => {
      const today = new Date()
      return {
        year: today.getFullYear(),
        month: 8,
        day: 27,
      }
    },
  },
  {
    description: 'from Date object',
    input: [new Date(2025, 7, 27)], // August 27, 2025 (month is 0-indexed in Date)
    expected: { year: 2025, month: 8, day: 27, ymd: '2025-08-27' },
  },
  {
    description: 'from components (year, month, day)',
    input: [2025, 8, 27],
    expected: { year: 2025, month: 8, day: 27, ymd: '2025-08-27' },
  },
  {
    description: 'leap year date',
    input: ['2020-02-29'],
    expected: { year: 2020, month: 2, day: 29, ymd: '2020-02-29' },
  },
  {
    description: 'end of year',
    input: ['2025-12-31'],
    expected: { year: 2025, month: 12, day: 31, ymd: '2025-12-31' },
  },
  {
    description: 'beginning of year',
    input: ['2025-01-01'],
    expected: { year: 2025, month: 1, day: 1, ymd: '2025-01-01' },
  },
  {
    description: 'invalid date string throws (Feb 30)',
    input: ['2025-02-30'],
    shouldThrow: true,
    errorPattern: /Invalid date/,
  },
  {
    description: 'invalid date components throws (Feb 30)',
    input: [2025, 2, 30],
    shouldThrow: true,
    errorPattern: /Invalid date/,
  },
  {
    description: 'invalid date components throws (month 13)',
    input: [2025, 13, 1],
    shouldThrow: true,
    errorPattern: /Invalid date/,
  },
  {
    description: 'invalid date components throws (day 32)',
    input: [2025, 1, 32],
    shouldThrow: true,
    errorPattern: /Invalid date/,
  },
  {
    description: 'non-leap year Feb 29 throws',
    input: ['2021-02-29'],
    shouldThrow: true,
    errorPattern: /Invalid date/,
  },
]

fixtures.forEach((fixture) => {
  test(`PlainDate constructor - ${fixture.description}`, () => {
    if (fixture.shouldThrow) {
      assert({
        given: fixture.description,
        should: 'throw an error',
        actual: (() => {
          try {
            // @ts-ignore - intentionally testing various input combinations
            new PlainDate(...fixture.input)
            return false
          } catch (error) {
            return fixture.errorPattern ? fixture.errorPattern.test((error as Error).message) : true
          }
        })(),
        expected: true,
      })
    } else {
      // @ts-ignore - intentionally testing various input combinations
      const plainDate = new PlainDate(...fixture.input)
      const expected = typeof fixture.expected === 'function' ? fixture.expected() : fixture.expected

      if (expected) {
        assert({
          given: fixture.description,
          should: `have year ${expected.year}`,
          actual: plainDate.year,
          expected: expected.year,
        })

        assert({
          given: fixture.description,
          should: `have month ${expected.month}`,
          actual: plainDate.month,
          expected: expected.month,
        })

        assert({
          given: fixture.description,
          should: `have day ${expected.day}`,
          actual: plainDate.day,
          expected: expected.day,
        })

        if (expected.ymd) {
          assert({
            given: fixture.description,
            should: `have ymd ${expected.ymd}`,
            actual: plainDate.ymd,
            expected: expected.ymd,
          })
        }
      }
    }
  })
})

// Test static factory methods
test('PlainDate.fromString() creates PlainDate from string', () => {
  const plainDate = PlainDate.fromString('2025-08-27')

  assert({
    given: 'PlainDate.fromString("2025-08-27")',
    should: 'create a PlainDate with correct date',
    actual: plainDate.ymd,
    expected: '2025-08-27',
  })
})

test('PlainDate.today() creates PlainDate for today', () => {
  const plainDate = PlainDate.today()
  const today = new Date()

  assert({
    given: 'PlainDate.today()',
    should: 'create a PlainDate for today',
    actual: plainDate.ymd,
    expected: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
      today.getDate(),
    ).padStart(2, '0')}`,
  })
})
