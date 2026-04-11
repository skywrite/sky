import { assert, test } from '#test'
import PlainDate from './mod.ts'

test('PlainDate.daysInYear - common years', () => {
  const fixtures = [
    { year: 2025, expected: 365, description: '2025 (non-leap)' },
    { year: 2024, expected: 366, description: '2024 (leap)' },
    { year: 2023, expected: 365, description: '2023 (non-leap)' },
    { year: 2020, expected: 366, description: '2020 (leap)' },
    { year: 2019, expected: 365, description: '2019 (non-leap)' },
  ]

  fixtures.forEach(({ year, expected, description }) => {
    const date = new PlainDate(year, 1, 1)
    assert({
      given: `PlainDate in ${description}`,
      should: `return ${expected} days`,
      actual: date.daysInYear,
      expected,
    })
  })
})

test('PlainDate.daysInYear - century years', () => {
  const fixtures = [
    { year: 1900, expected: 365, description: '1900 (divisible by 100, not by 400)' },
    { year: 2000, expected: 366, description: '2000 (divisible by 400)' },
    { year: 2100, expected: 365, description: '2100 (divisible by 100, not by 400)' },
    { year: 2400, expected: 366, description: '2400 (divisible by 400)' },
  ]

  fixtures.forEach(({ year, expected, description }) => {
    const date = new PlainDate(year, 6, 15) // Use mid-year date
    assert({
      given: `PlainDate in ${description}`,
      should: `return ${expected} days`,
      actual: date.daysInYear,
      expected,
    })
  })
})

test('PlainDate.daysInYear - consistent throughout year', () => {
  // Test that daysInYear returns the same value for any date in the same year
  const year = 2024
  const dates = [
    new PlainDate(year, 1, 1), // First day
    new PlainDate(year, 2, 29), // Leap day
    new PlainDate(year, 6, 15), // Mid-year
    new PlainDate(year, 12, 31), // Last day
  ]

  dates.forEach((date) => {
    assert({
      given: `PlainDate for ${date.toString()}`,
      should: 'return 366 (leap year)',
      actual: date.daysInYear,
      expected: 366,
    })
  })
})
