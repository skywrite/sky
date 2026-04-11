import { assert, test } from '#test'
import getDaysInMonth from './getDaysInMonth.ts'

// from: https://github.com/date-fns/date-fns/blob/fadbd4eb7920bf932c25f734f3949027b2fe4887/src/getDaysInMonth/test.ts

test('getDaysInMonth - returns the number of days in the month of the given date', () => {
  assert({
    given: 'Feb 2100 (non-leap year)',
    should: 'return 28',
    actual: getDaysInMonth(new Date(2100, 1, /* Feb */ 11)),
    expected: 28,
  })
})

test('getDaysInMonth - works for the February of a leap year', () => {
  assert({
    given: 'Feb 2000 (leap year)',
    should: 'return 29',
    actual: getDaysInMonth(new Date(2000, 1, /* Feb */ 11)),
    expected: 29,
  })
})

test('getDaysInMonth - handles dates before 100 AD', () => {
  const date = new Date(0)
  date.setFullYear(0, 1, /* Feb */ 15)
  date.setHours(0, 0, 0, 0)
  assert({
    given: 'Feb in year 0 (leap year)',
    should: 'return 29',
    actual: getDaysInMonth(date),
    expected: 29,
  })
})

test('getDaysInMonth - returns NaN if the given date is invalid', () => {
  assert({
    given: 'an Invalid Date',
    should: 'return NaN',
    actual: isNaN(getDaysInMonth(new Date(NaN))),
    expected: true,
  })
})
