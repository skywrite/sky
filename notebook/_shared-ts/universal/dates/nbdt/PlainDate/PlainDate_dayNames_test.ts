import { assert, test } from '#test'
import PlainDate from './mod.ts'

const dayNameFixtures = [
  {
    date: '2025-09-01', // Monday
    dayShort: 'Mon',
    dayLong: 'Monday',
  },
  {
    date: '2025-09-02', // Tuesday
    dayShort: 'Tue',
    dayLong: 'Tuesday',
  },
  {
    date: '2025-09-03', // Wednesday
    dayShort: 'Wed',
    dayLong: 'Wednesday',
  },
  {
    date: '2025-09-04', // Thursday
    dayShort: 'Thu',
    dayLong: 'Thursday',
  },
  {
    date: '2025-09-05', // Friday
    dayShort: 'Fri',
    dayLong: 'Friday',
  },
  {
    date: '2025-09-06', // Saturday
    dayShort: 'Sat',
    dayLong: 'Saturday',
  },
  {
    date: '2025-09-07', // Sunday
    dayShort: 'Sun',
    dayLong: 'Sunday',
  },
  {
    date: '2020-02-29', // Leap year Saturday
    dayShort: 'Sat',
    dayLong: 'Saturday',
  },
  {
    date: '2025-01-01', // New Year's Day - Wednesday
    dayShort: 'Wed',
    dayLong: 'Wednesday',
  },
  {
    date: '2025-12-31', // New Year's Eve - Wednesday
    dayShort: 'Wed',
    dayLong: 'Wednesday',
  },
]

dayNameFixtures.forEach((fixture) => {
  test(`PlainDate dayShort - ${fixture.date}`, () => {
    const plainDate = new PlainDate(fixture.date)

    assert({
      given: `date ${fixture.date}`,
      should: `have dayShort "${fixture.dayShort}"`,
      actual: plainDate.dayShort,
      expected: fixture.dayShort,
    })
  })

  test(`PlainDate dayLong - ${fixture.date}`, () => {
    const plainDate = new PlainDate(fixture.date)

    assert({
      given: `date ${fixture.date}`,
      should: `have dayLong "${fixture.dayLong}"`,
      actual: plainDate.dayLong,
      expected: fixture.dayLong,
    })
  })
})

test('PlainDate day names are consistent across constructors', () => {
  const date1 = new PlainDate('2025-09-01')
  const date2 = new PlainDate(2025, 9, 1)
  const date3 = new PlainDate(new Date(2025, 8, 1)) // September is month 8 in 0-indexed

  assert({
    given: 'same date from different constructors',
    should: 'have same dayShort',
    actual: date1.dayShort === date2.dayShort && date2.dayShort === date3.dayShort,
    expected: true,
  })

  assert({
    given: 'same date from different constructors',
    should: 'have same dayLong',
    actual: date1.dayLong === date2.dayLong && date2.dayLong === date3.dayLong,
    expected: true,
  })
})

test('PlainDate day names work with partial dates', () => {
  // This test will be date-dependent, so we calculate expected values
  const today = new Date()
  const plainDate = new PlainDate('27') // Just day 27 of current month/year

  // Create a reference date for day 27 of current month
  const refDate = new Date(today.getFullYear(), today.getMonth(), 27)
  const expectedShort = refDate.toLocaleDateString('en-us', { weekday: 'short' })
  const expectedLong = refDate.toLocaleDateString('en-us', { weekday: 'long' })

  assert({
    given: 'partial date "27"',
    should: 'calculate correct dayShort',
    actual: plainDate.dayShort,
    expected: expectedShort,
  })

  assert({
    given: 'partial date "27"',
    should: 'calculate correct dayLong',
    actual: plainDate.dayLong,
    expected: expectedLong,
  })
})
