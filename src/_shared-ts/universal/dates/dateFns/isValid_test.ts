import { assert, test } from '#test'
import isValid from './isValid.ts'

test('isValid - returns true if the given date is valid', () => {
  assert({
    given: 'a valid date',
    should: 'return true',
    actual: isValid(new Date()),
    expected: true,
  })
})

test('isValid - returns false if the given date is invalid', () => {
  assert({
    given: 'an invalid date string',
    should: 'return false',
    actual: isValid(new Date('')),
    expected: false,
  })
})

test('isValid - treats null as an invalid date', () => {
  assert({
    given: 'null',
    should: 'return false',
    actual: isValid(null),
    expected: false,
  })
})
