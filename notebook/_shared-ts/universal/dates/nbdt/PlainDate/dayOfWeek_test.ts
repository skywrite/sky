import { assert, test } from '#test'
import PlainDate from './mod.ts'

test('PlainDate.dayOfWeek', () => {
  // Testing ISO/Temporal convention: 1=Monday, 2=Tuesday, ..., 7=Sunday
  const fixtures = [
    { date: new PlainDate(2025, 1, 26), expected: 7, day: 'Sunday' },
    { date: new PlainDate(2025, 1, 27), expected: 1, day: 'Monday' },
    { date: new PlainDate(2025, 1, 28), expected: 2, day: 'Tuesday' },
    { date: new PlainDate(2025, 1, 29), expected: 3, day: 'Wednesday' },
    { date: new PlainDate(2025, 1, 30), expected: 4, day: 'Thursday' },
    { date: new PlainDate(2025, 1, 31), expected: 5, day: 'Friday' },
    { date: new PlainDate(2025, 2, 1), expected: 6, day: 'Saturday' },
  ]

  fixtures.forEach(({ date, expected, day }) => {
    assert({
      given: `PlainDate for ${date.toString()} (${day})`,
      should: `return ${expected} for dayOfWeek`,
      actual: date.dayOfWeek,
      expected,
    })
  })
})

test('PlainDate.dayOfWeek - edge cases', () => {
  // Test leap year day (Feb 29, 2024 is a Thursday)
  const leapDay = new PlainDate(2024, 2, 29)
  assert({
    given: 'PlainDate for Feb 29, 2024 (leap year)',
    should: 'return 4 (Thursday) in ISO/Temporal convention',
    actual: leapDay.dayOfWeek,
    expected: 4,
  })

  // Test year boundaries (Dec 31, 2024 is a Tuesday)
  const lastDayOf2024 = new PlainDate(2024, 12, 31)
  assert({
    given: 'PlainDate for Dec 31, 2024',
    should: 'return 2 (Tuesday) in ISO/Temporal convention',
    actual: lastDayOf2024.dayOfWeek,
    expected: 2,
  })

  // Jan 1, 2025 is a Wednesday
  const firstDayOf2025 = new PlainDate(2025, 1, 1)
  assert({
    given: 'PlainDate for Jan 1, 2025',
    should: 'return 3 (Wednesday) in ISO/Temporal convention',
    actual: firstDayOf2025.dayOfWeek,
    expected: 3,
  })
})
