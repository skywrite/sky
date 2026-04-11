import { assert, test } from '#test'
import isMonday from './isMonday.ts'

test('isMonday - returns true if the given date is Monday', () => {
  assert({
    given: 'a Monday (Sep 22, 2014)',
    should: 'return true',
    actual: isMonday(new Date(2014, 8, /* Sep */ 22)),
    expected: true,
  })
})

test('isMonday - returns false if the given date is not Monday', () => {
  assert({
    given: 'a non-Monday (Sep 25, 2014)',
    should: 'return false',
    actual: isMonday(new Date(2014, 8, /* Sep */ 25)),
    expected: false,
  })
})

test('isMonday - returns false if the given date is `Invalid Date`', () => {
  assert({
    given: 'an Invalid Date',
    should: 'return false',
    actual: isMonday(new Date(NaN)),
    expected: false,
  })
})
