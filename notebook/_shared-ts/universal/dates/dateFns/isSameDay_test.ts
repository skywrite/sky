import { assert, test } from '#test'
import isSameDay from './isSameDay.ts'

test('isSameDay - returns true if the given dates have the same day', () => {
  assert({
    given: 'two dates on Sep 4, 2014 at different times',
    should: 'return true',
    actual: isSameDay(new Date(2014, 8, /* Sep */ 4, 6, 0), new Date(2014, 8, /* Sep */ 4, 18, 0)),
    expected: true,
  })
})

test('isSameDay - returns false if the given dates have different days', () => {
  assert({
    given: 'Sep 4 23:59 and Sep 5 00:00',
    should: 'return false',
    actual: isSameDay(new Date(2014, 8, /* Sep */ 4, 23, 59), new Date(2014, 8, /* Sep */ 5, 0, 0)),
    expected: false,
  })
})

test('isSameDay - returns false if the first date is `Invalid Date`', () => {
  assert({
    given: 'Invalid Date as first argument',
    should: 'return false',
    actual: isSameDay(new Date(NaN), new Date(1989, 6, /* Jul */ 10)),
    expected: false,
  })
})

test('isSameDay - returns false if the second date is `Invalid Date`', () => {
  assert({
    given: 'Invalid Date as second argument',
    should: 'return false',
    actual: isSameDay(new Date(1987, 1, /* Feb */ 11), new Date(NaN)),
    expected: false,
  })
})

test('isSameDay - returns false if the both dates are `Invalid Date`', () => {
  assert({
    given: 'both dates are Invalid Date',
    should: 'return false',
    actual: isSameDay(new Date(NaN), new Date(NaN)),
    expected: false,
  })
})
