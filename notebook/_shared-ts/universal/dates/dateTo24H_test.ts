import { assert, test } from '#test'
import dateTo24H from './dateTo24H.ts'

test(dateTo24H.name, () => {
  const given = 'a date with a time before 12'
  const should = 'return time formatted for 24 hours'
  const fixture = new Date(2022, 0, 10, 9, 30) // 9:30 AM

  const expected = '09:30'
  const actual = dateTo24H(fixture)

  assert({ given, should, expected, actual })
})

test(dateTo24H.name, () => {
  const given = 'a date with a time after 12'
  const should = 'return time formatted w/ 24 hours'
  const fixture = new Date(2022, 0, 10, 15, 30) // 3:30 PM

  const expected = '15:30'
  const actual = dateTo24H(fixture)

  assert({ given, should, expected, actual })
})

test(dateTo24H.name, () => {
  const given = 'a date with time midnight'
  const should = 'return time formatted w/ 00 hours'
  const fixture = new Date(2023, 1, 13, 0, 30) // 12:30 AM

  const expected = '00:30'
  const actual = dateTo24H(fixture)

  assert({ given, should, expected, actual })
})

test(dateTo24H.name, () => {
  const given = 'a date with time midnight'
  const should = 'return time formatted w/ 00 hours'
  const fixture = new Date(2023, 1, 13, 0, 30) // 12:30 AM

  const expected = '00:30'
  const actual = dateTo24H(fixture)

  assert({ given, should, expected, actual })
})

test(dateTo24H.name, () => {
  const given = 'a reference date'
  const should = 'return time formatted w/ time greater than 24 hours if reference date is the day before'
  const fixture = new Date(2023, 1, 13, 1, 30) // 1:30 AM
  const refDate = new Date(2023, 1, 12, 0, 0)

  const expected = '25:30'
  const actual = dateTo24H(fixture, refDate)

  assert({ given, should, expected, actual })
})

test(dateTo24H.name, () => {
  const given = 'a reference date that is the same day'
  const should = 'return time formatted'
  const fixture = new Date(2023, 1, 13, 1, 30) // 1:30 AM
  const refDate = new Date(2023, 1, 13, 0, 0)

  const expected = '01:30'
  const actual = dateTo24H(fixture, refDate)

  assert({ given, should, expected, actual })
})
