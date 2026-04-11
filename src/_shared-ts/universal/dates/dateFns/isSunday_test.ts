import { assert, test } from '#test'
import isSunday from './isSunday.ts'

test('isSunday - returns true if the given date is Sunday', () => {
  assert({
    given: 'a Sunday (Sep 21, 2014)',
    should: 'return true',
    actual: isSunday(new Date(2014, 8, /* Sep */ 21)),
    expected: true,
  })
})

test('isSunday - returns false if the given date is not Sunday', () => {
  assert({
    given: 'a non-Sunday (Sep 25, 2014)',
    should: 'return false',
    actual: isSunday(new Date(2014, 8, /* Sep */ 25)),
    expected: false,
  })
})

test('isSunday - returns false if the given date is `Invalid Date`', () => {
  assert({
    given: 'an Invalid Date',
    should: 'return false',
    actual: isSunday(new Date(NaN)),
    expected: false,
  })
})
