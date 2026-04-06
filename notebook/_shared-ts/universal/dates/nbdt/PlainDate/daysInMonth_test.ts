import { assert, test } from '#test'
import PlainDate from './mod.ts'

test('PlainDate.daysInMonth - all months', () => {
  const fixtures = [
    { date: new PlainDate(2025, 1, 15), expected: 31, month: 'January' },
    { date: new PlainDate(2025, 2, 10), expected: 28, month: 'February (non-leap)' },
    { date: new PlainDate(2025, 3, 20), expected: 31, month: 'March' },
    { date: new PlainDate(2025, 4, 1), expected: 30, month: 'April' },
    { date: new PlainDate(2025, 5, 31), expected: 31, month: 'May' },
    { date: new PlainDate(2025, 6, 15), expected: 30, month: 'June' },
    { date: new PlainDate(2025, 7, 4), expected: 31, month: 'July' },
    { date: new PlainDate(2025, 8, 15), expected: 31, month: 'August' },
    { date: new PlainDate(2025, 9, 30), expected: 30, month: 'September' },
    { date: new PlainDate(2025, 10, 31), expected: 31, month: 'October' },
    { date: new PlainDate(2025, 11, 11), expected: 30, month: 'November' },
    { date: new PlainDate(2025, 12, 25), expected: 31, month: 'December' },
  ]

  fixtures.forEach(({ date, expected, month }) => {
    assert({
      given: `PlainDate in ${month} ${date.year}`,
      should: `return ${expected} days`,
      actual: date.daysInMonth,
      expected,
    })
  })
})

test('PlainDate.daysInMonth - February leap years', () => {
  const fixtures = [
    { year: 2024, expected: 29, description: '2024 (leap year)' },
    { year: 2025, expected: 28, description: '2025 (non-leap)' },
    { year: 2000, expected: 29, description: '2000 (leap - divisible by 400)' },
    { year: 1900, expected: 28, description: '1900 (non-leap - divisible by 100)' },
    { year: 2028, expected: 29, description: '2028 (leap year)' },
    { year: 2100, expected: 28, description: '2100 (non-leap - divisible by 100)' },
  ]

  fixtures.forEach(({ year, expected, description }) => {
    const date = new PlainDate(year, 2, 1)
    assert({
      given: `PlainDate for February ${description}`,
      should: `return ${expected} days`,
      actual: date.daysInMonth,
      expected,
    })
  })
})

test('PlainDate.daysInMonth - last day detection', () => {
  // Test that we can detect if a date is the last day of the month
  const fixtures = [
    { date: new PlainDate(2025, 1, 31), isLast: true },
    { date: new PlainDate(2025, 1, 30), isLast: false },
    { date: new PlainDate(2025, 2, 28), isLast: true },
    { date: new PlainDate(2024, 2, 29), isLast: true },
    { date: new PlainDate(2024, 2, 28), isLast: false },
    { date: new PlainDate(2025, 4, 30), isLast: true },
    { date: new PlainDate(2025, 4, 29), isLast: false },
  ]

  fixtures.forEach(({ date, isLast }) => {
    assert({
      given: `PlainDate for ${date.toString()}`,
      should: `${isLast ? 'be' : 'not be'} the last day of the month`,
      actual: date.day === date.daysInMonth,
      expected: isLast,
    })
  })
})
