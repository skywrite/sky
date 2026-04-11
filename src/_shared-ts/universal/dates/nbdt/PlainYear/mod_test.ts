import { assert, test } from '#test'
import PlainYear from './mod.ts'
import PlainDate from '../PlainDate/mod.ts'
import PlainYearMonth from '../PlainYearMonth/mod.ts'

test('PlainYear constructor - no args uses current year', () => {
  const year = new PlainYear()
  const expected = new Date().getFullYear()

  assert({
    given: 'no arguments',
    should: 'use current year',
    actual: year.year,
    expected,
  })
})

test('PlainYear constructor - from number', () => {
  const year = new PlainYear(2024)

  assert({
    given: 'year as number',
    should: 'set year correctly',
    actual: year.year,
    expected: 2024,
  })
})

test('PlainYear constructor - from string YYYY', () => {
  const year = new PlainYear('2023')

  assert({
    given: 'year as YYYY string',
    should: 'parse year correctly',
    actual: year.year,
    expected: 2023,
  })
})

test('PlainYear constructor - from string YYYY-MM', () => {
  const year = new PlainYear('2022-06')

  assert({
    given: 'year as YYYY-MM string',
    should: 'extract year correctly',
    actual: year.year,
    expected: 2022,
  })
})

test('PlainYear constructor - from string YYYY-MM-DD', () => {
  const year = new PlainYear('2021-03-15')

  assert({
    given: 'year as YYYY-MM-DD string',
    should: 'extract year correctly',
    actual: year.year,
    expected: 2021,
  })
})

test('PlainYear constructor - from Date', () => {
  const date = new Date(2020, 5, 15) // June 15, 2020
  const year = new PlainYear(date)

  assert({
    given: 'Date object',
    should: 'extract year correctly',
    actual: year.year,
    expected: 2020,
  })
})

test('PlainYear constructor - from PlainDate', () => {
  const plainDate = new PlainDate(2019, 8, 20)
  const year = new PlainYear(plainDate)

  assert({
    given: 'PlainDate object',
    should: 'extract year correctly',
    actual: year.year,
    expected: 2019,
  })
})

test('PlainYear constructor - from PlainYearMonth', () => {
  const plainYearMonth = new PlainYearMonth(2018, 11)
  const year = new PlainYear(plainYearMonth)

  assert({
    given: 'PlainYearMonth object',
    should: 'extract year correctly',
    actual: year.year,
    expected: 2018,
  })
})

test('PlainYear.from - from PlainYear', () => {
  const original = new PlainYear(2024)
  const copy = PlainYear.from(original)

  assert({
    given: 'PlainYear object',
    should: 'create copy with same year',
    actual: copy.year,
    expected: 2024,
  })
})

test('PlainYear.from - from object with year property', () => {
  const year = PlainYear.from({ year: 2017 })

  assert({
    given: 'object with year property',
    should: 'extract year correctly',
    actual: year.year,
    expected: 2017,
  })
})

test('PlainYear.from - from object with year as string', () => {
  const year = PlainYear.from({ year: '2016' })

  assert({
    given: 'object with year as string',
    should: 'parse year correctly',
    actual: year.year,
    expected: 2016,
  })
})

test('PlainYear.compare - returns -1 when a < b', () => {
  const a = new PlainYear(2020)
  const b = new PlainYear(2021)

  assert({
    given: 'two PlainYear instances where a < b',
    should: 'return -1',
    actual: PlainYear.compare(a, b),
    expected: -1,
  })
})

test('PlainYear.compare - returns 0 when equal', () => {
  const a = new PlainYear(2020)
  const b = new PlainYear(2020)

  assert({
    given: 'two equal PlainYear instances',
    should: 'return 0',
    actual: PlainYear.compare(a, b),
    expected: 0,
  })
})

test('PlainYear.compare - returns 1 when a > b', () => {
  const a = new PlainYear(2021)
  const b = new PlainYear(2020)

  assert({
    given: 'two PlainYear instances where a > b',
    should: 'return 1',
    actual: PlainYear.compare(a, b),
    expected: 1,
  })
})

test('PlainYear.yearPadded - pads year to 4 digits', () => {
  assert({
    given: 'year 2024',
    should: 'return "2024"',
    actual: new PlainYear(2024).yearPadded,
    expected: '2024',
  })
})

test('PlainYear.inLeapYear - returns true for leap year', () => {
  assert({
    given: 'year 2024 (leap year)',
    should: 'return true',
    actual: new PlainYear(2024).inLeapYear,
    expected: true,
  })
})

test('PlainYear.inLeapYear - returns false for non-leap year', () => {
  assert({
    given: 'year 2023 (non-leap year)',
    should: 'return false',
    actual: new PlainYear(2023).inLeapYear,
    expected: false,
  })
})

test('PlainYear.inLeapYear - handles century rule', () => {
  assert({
    given: 'year 1900 (century, not leap)',
    should: 'return false',
    actual: new PlainYear(1900).inLeapYear,
    expected: false,
  })
})

test('PlainYear.inLeapYear - handles 400-year rule', () => {
  assert({
    given: 'year 2000 (divisible by 400, leap)',
    should: 'return true',
    actual: new PlainYear(2000).inLeapYear,
    expected: true,
  })
})

test('PlainYear.daysInYear - returns 366 for leap year', () => {
  assert({
    given: 'leap year 2024',
    should: 'return 366',
    actual: new PlainYear(2024).daysInYear,
    expected: 366,
  })
})

test('PlainYear.daysInYear - returns 365 for non-leap year', () => {
  assert({
    given: 'non-leap year 2023',
    should: 'return 365',
    actual: new PlainYear(2023).daysInYear,
    expected: 365,
  })
})

test('PlainYear.toString - returns YYYY format', () => {
  assert({
    given: 'year 2024',
    should: 'return "2024"',
    actual: new PlainYear(2024).toString(),
    expected: '2024',
  })
})

test('PlainYear.equals - returns true for equal years', () => {
  const a = new PlainYear(2024)
  const b = new PlainYear(2024)

  assert({
    given: 'two PlainYear with same year',
    should: 'return true',
    actual: a.equals(b),
    expected: true,
  })
})

test('PlainYear.equals - returns false for different years', () => {
  const a = new PlainYear(2024)
  const b = new PlainYear(2023)

  assert({
    given: 'two PlainYear with different years',
    should: 'return false',
    actual: a.equals(b),
    expected: false,
  })
})

test('PlainYear.toPlainYearMonth - defaults to January', () => {
  const year = new PlainYear(2024)
  const yearMonth = year.toPlainYearMonth()

  assert({
    given: 'PlainYear converted to PlainYearMonth with no args',
    should: 'default to month 1',
    actual: { year: yearMonth.year, month: yearMonth.month },
    expected: { year: 2024, month: 1 },
  })
})

test('PlainYear.toPlainYearMonth - accepts month argument', () => {
  const year = new PlainYear(2024)
  const yearMonth = year.toPlainYearMonth(6)

  assert({
    given: 'PlainYear converted to PlainYearMonth with month 6',
    should: 'use specified month',
    actual: { year: yearMonth.year, month: yearMonth.month },
    expected: { year: 2024, month: 6 },
  })
})

test('PlainYear.toPlainDate - defaults to January 1', () => {
  const year = new PlainYear(2024)
  const date = year.toPlainDate()

  assert({
    given: 'PlainYear converted to PlainDate with no args',
    should: 'default to Jan 1',
    actual: date.ymd,
    expected: '2024-01-01',
  })
})

test('PlainYear.toPlainDate - accepts month and day arguments', () => {
  const year = new PlainYear(2024)
  const date = year.toPlainDate(6, 15)

  assert({
    given: 'PlainYear converted to PlainDate with month 6 and day 15',
    should: 'use specified month and day',
    actual: date.ymd,
    expected: '2024-06-15',
  })
})

test('PlainYear.add - adds years', () => {
  const year = new PlainYear(2024)
  const result = year.add(3)

  assert({
    given: 'PlainYear 2024 adding 3 years',
    should: 'return 2027',
    actual: result.year,
    expected: 2027,
  })
})

test('PlainYear.add - handles negative values', () => {
  const year = new PlainYear(2024)
  const result = year.add(-5)

  assert({
    given: 'PlainYear 2024 adding -5 years',
    should: 'return 2019',
    actual: result.year,
    expected: 2019,
  })
})

test('PlainYear.subtract - subtracts years', () => {
  const year = new PlainYear(2024)
  const result = year.subtract(4)

  assert({
    given: 'PlainYear 2024 subtracting 4 years',
    should: 'return 2020',
    actual: result.year,
    expected: 2020,
  })
})
