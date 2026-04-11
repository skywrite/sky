import { assert, test } from '#test'
import PlainDate from './mod.ts'

test('PlainDate.inLeapYear - common years', () => {
  const fixtures = [
    { year: 2024, expected: true, description: '2024 (divisible by 4)' },
    { year: 2025, expected: false, description: '2025 (not divisible by 4)' },
    { year: 2023, expected: false, description: '2023 (not divisible by 4)' },
    { year: 2020, expected: true, description: '2020 (divisible by 4)' },
    { year: 2028, expected: true, description: '2028 (divisible by 4)' },
    { year: 2030, expected: false, description: '2030 (not divisible by 4)' },
  ]

  fixtures.forEach(({ year, expected, description }) => {
    const date = new PlainDate(year, 6, 15) // Mid-year date
    assert({
      given: `PlainDate in ${description}`,
      should: `return ${expected} for inLeapYear`,
      actual: date.inLeapYear,
      expected,
    })
  })
})

test('PlainDate.inLeapYear - century years', () => {
  const fixtures = [
    { year: 1900, expected: false, description: '1900 (divisible by 100, not by 400)' },
    { year: 2000, expected: true, description: '2000 (divisible by 400)' },
    { year: 2100, expected: false, description: '2100 (divisible by 100, not by 400)' },
    { year: 2400, expected: true, description: '2400 (divisible by 400)' },
    { year: 1800, expected: false, description: '1800 (divisible by 100, not by 400)' },
    { year: 1600, expected: true, description: '1600 (divisible by 400)' },
  ]

  fixtures.forEach(({ year, expected, description }) => {
    const date = new PlainDate(year, 1, 1) // First day of year
    assert({
      given: `PlainDate in ${description}`,
      should: `return ${expected} for inLeapYear`,
      actual: date.inLeapYear,
      expected,
    })
  })
})

test('PlainDate.inLeapYear - consistent throughout year', () => {
  // Test that inLeapYear returns the same value for any date in the same year
  const leapYear = 2024
  const nonLeapYear = 2025

  const leapDates = [
    new PlainDate(leapYear, 1, 1), // First day
    new PlainDate(leapYear, 2, 29), // Leap day itself
    new PlainDate(leapYear, 6, 15), // Mid-year
    new PlainDate(leapYear, 12, 31), // Last day
  ]

  leapDates.forEach((date) => {
    assert({
      given: `PlainDate for ${date.toString()} in leap year`,
      should: 'return true',
      actual: date.inLeapYear,
      expected: true,
    })
  })

  const nonLeapDates = [
    new PlainDate(nonLeapYear, 1, 1), // First day
    new PlainDate(nonLeapYear, 6, 15), // Mid-year
    new PlainDate(nonLeapYear, 12, 31), // Last day
  ]

  nonLeapDates.forEach((date) => {
    assert({
      given: `PlainDate for ${date.toString()} in non-leap year`,
      should: 'return false',
      actual: date.inLeapYear,
      expected: false,
    })
  })
})

test('PlainDate.inLeapYear - relationship with daysInYear', () => {
  // Test that inLeapYear is consistent with daysInYear
  const fixtures = [
    new PlainDate(2024, 3, 15), // Leap year
    new PlainDate(2025, 3, 15), // Non-leap year
    new PlainDate(2000, 3, 15), // Century leap year
    new PlainDate(1900, 3, 15), // Century non-leap year
  ]

  fixtures.forEach((date) => {
    const expectedDays = date.inLeapYear ? 366 : 365
    assert({
      given: `PlainDate for ${date.toString()}`,
      should: `have daysInYear consistent with inLeapYear`,
      actual: date.daysInYear,
      expected: expectedDays,
    })
  })
})
