import { assert, test } from '#test'
import PlainDate from './mod.ts'

test('PlainDate.weekOfYear - basic weeks', () => {
  // 2025 starts on Wednesday
  const fixtures = [
    { date: new PlainDate(2025, 1, 1), expected: 1, description: 'Jan 1, 2025 (Wednesday)' },
    { date: new PlainDate(2025, 1, 6), expected: 2, description: 'Jan 6, 2025 (Monday, week 2)' },
    { date: new PlainDate(2025, 1, 13), expected: 3, description: 'Jan 13, 2025 (Monday, week 3)' },
    { date: new PlainDate(2025, 1, 20), expected: 4, description: 'Jan 20, 2025 (Monday, week 4)' },
    { date: new PlainDate(2025, 1, 27), expected: 5, description: 'Jan 27, 2025 (Monday, week 5)' },
  ]

  fixtures.forEach(({ date, expected, description }) => {
    assert({
      given: `PlainDate for ${description}`,
      should: `return week ${expected}`,
      actual: date.weekOfYear,
      expected,
    })
  })
})

test('PlainDate.weekOfYear - year boundaries', () => {
  const fixtures = [
    // 2024/2025 boundary
    { date: new PlainDate(2024, 12, 30), expected: 1, description: 'Dec 30, 2024 (Monday, week 1 of 2025)' },
    { date: new PlainDate(2024, 12, 31), expected: 1, description: 'Dec 31, 2024 (Tuesday, week 1 of 2025)' },
    { date: new PlainDate(2025, 1, 1), expected: 1, description: 'Jan 1, 2025 (Wednesday, week 1)' },

    // 2025/2026 boundary
    { date: new PlainDate(2025, 12, 29), expected: 1, description: 'Dec 29, 2025 (Monday, week 1 of 2026)' },
    { date: new PlainDate(2025, 12, 31), expected: 1, description: 'Dec 31, 2025 (week 1 of 2026)' },
  ]

  fixtures.forEach(({ date, expected, description }) => {
    assert({
      given: `PlainDate for ${description}`,
      should: `return week ${expected}`,
      actual: date.weekOfYear,
      expected,
    })
  })
})

test('PlainDate.weekOfYear - ISO week rules', () => {
  // Test years with different starting days to verify ISO week rules
  // ISO 8601: Week 1 is the week containing January 4th
  const fixtures = [
    // 2015 starts on Thursday
    { date: new PlainDate(2015, 1, 1), expected: 1, description: 'Jan 1, 2015 (Thursday, week 1)' },
    { date: new PlainDate(2015, 1, 4), expected: 1, description: 'Jan 4, 2015 (Sunday, still week 1)' },
    { date: new PlainDate(2015, 1, 5), expected: 2, description: 'Jan 5, 2015 (Monday, week 2)' },

    // 2018 starts on Monday
    { date: new PlainDate(2018, 1, 1), expected: 1, description: 'Jan 1, 2018 (Monday, week 1)' },
    { date: new PlainDate(2018, 1, 7), expected: 1, description: 'Jan 7, 2018 (Sunday, week 1)' },
    { date: new PlainDate(2018, 1, 8), expected: 2, description: 'Jan 8, 2018 (Monday, week 2)' },

    // 2016 starts on Friday
    { date: new PlainDate(2016, 1, 1), expected: 53, description: 'Jan 1, 2016 (Friday, week 53 of 2015)' },
    { date: new PlainDate(2016, 1, 4), expected: 1, description: 'Jan 4, 2016 (Monday, week 1 of 2016)' },
  ]

  fixtures.forEach(({ date, expected, description }) => {
    assert({
      given: `PlainDate for ${description}`,
      should: `return week ${expected}`,
      actual: date.weekOfYear,
      expected,
    })
  })
})

test('PlainDate.weekOfYear - mid-year checks', () => {
  const fixtures = [
    { date: new PlainDate(2025, 7, 1), expected: 27, description: 'July 1, 2025' },
    { date: new PlainDate(2025, 7, 7), expected: 28, description: 'July 7, 2025 (Monday)' },
    { date: new PlainDate(2025, 10, 1), expected: 40, description: 'Oct 1, 2025' },
    { date: new PlainDate(2025, 12, 25), expected: 52, description: 'Dec 25, 2025 (Thursday)' },
  ]

  fixtures.forEach(({ date, expected, description }) => {
    assert({
      given: `PlainDate for ${description}`,
      should: `return week ${expected}`,
      actual: date.weekOfYear,
      expected,
    })
  })
})
