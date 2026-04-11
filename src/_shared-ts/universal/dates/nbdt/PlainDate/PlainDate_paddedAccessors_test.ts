import { assert, test } from '#test'
import PlainDate from './mod.ts'

test('PlainDate padded accessors - yearPadded', () => {
  const date = new PlainDate('2025-08-27')

  assert({
    given: 'PlainDate with year 2025',
    should: 'return padded year string',
    actual: date.yearPadded,
    expected: '2025',
  })
})

test('PlainDate padded accessors - monthPadded with padding', () => {
  const date = new PlainDate('2025-08-27')

  assert({
    given: 'PlainDate with month 8',
    should: 'return zero-padded month string',
    actual: date.monthPadded,
    expected: '08',
  })
})

test('PlainDate padded accessors - monthPadded double digits', () => {
  const date = new PlainDate('2025-11-27')

  assert({
    given: 'PlainDate with month 11',
    should: 'return month string without extra padding',
    actual: date.monthPadded,
    expected: '11',
  })
})

test('PlainDate padded accessors - dayPadded with padding', () => {
  const date = new PlainDate('2025-08-07')

  assert({
    given: 'PlainDate with day 7',
    should: 'return zero-padded day string',
    actual: date.dayPadded,
    expected: '07',
  })
})

test('PlainDate padded accessors - dayPadded double digits', () => {
  const date = new PlainDate('2025-08-27')

  assert({
    given: 'PlainDate with day 27',
    should: 'return day string without extra padding',
    actual: date.dayPadded,
    expected: '27',
  })
})

test('PlainDate padded accessors - ymd uses padded accessors', () => {
  const date = new PlainDate('2025-03-05')

  assert({
    given: 'PlainDate 2025-03-05',
    should: 'use padded accessors to build ymd',
    actual: date.ymd,
    expected: '2025-03-05',
  })

  assert({
    given: 'PlainDate ymd',
    should: 'equal concatenated padded accessors',
    actual: date.ymd,
    expected: `${date.yearPadded}-${date.monthPadded}-${date.dayPadded}`,
  })
})

test('PlainDate padded accessors - single digit month and day', () => {
  const date = new PlainDate('2025-01-01')

  assert({
    given: 'PlainDate with month 1',
    should: 'pad month to 2 digits',
    actual: date.monthPadded,
    expected: '01',
  })

  assert({
    given: 'PlainDate with day 1',
    should: 'pad day to 2 digits',
    actual: date.dayPadded,
    expected: '01',
  })
})

test('PlainDate ymdParts - returns array of padded strings', () => {
  const date = new PlainDate('2025-03-05')

  assert({
    given: 'PlainDate 2025-03-05',
    should: 'return array of padded date parts',
    actual: date.ymdParts,
    expected: ['2025', '03', '05'],
  })
})

test('PlainDate ymdParts - destructuring', () => {
  const date = new PlainDate('2025-08-27')
  const [year, month, day] = date.ymdParts

  assert({
    given: 'PlainDate ymdParts destructured',
    should: 'provide year as first element',
    actual: year,
    expected: '2025',
  })

  assert({
    given: 'PlainDate ymdParts destructured',
    should: 'provide month as second element',
    actual: month,
    expected: '08',
  })

  assert({
    given: 'PlainDate ymdParts destructured',
    should: 'provide day as third element',
    actual: day,
    expected: '27',
  })
})

test('PlainDate ymdParts - matches ymd split', () => {
  const date = new PlainDate('2025-12-31')

  assert({
    given: 'PlainDate ymdParts',
    should: 'match ymd.split("-")',
    actual: date.ymdParts.join('-'),
    expected: date.ymd,
  })
})
