import { assert, test } from '#test'
import subDays from './subDays.ts'

test('subDays - subtracts the given number of days', () => {
  assert({
    given: 'Sep 1, 2014 minus 10 days',
    should: 'return Aug 22, 2014',
    actual: subDays(new Date(2014, 8, /* Sep */ 1), 10),
    expected: new Date(2014, 7, /* Aug */ 22),
  })
})

test('subDays - does not mutate the original date', () => {
  const date = new Date(2014, 8, /* Sep */ 1)
  subDays(date, 11)
  assert({
    given: 'the original date after subDays',
    should: 'not be mutated',
    actual: date,
    expected: new Date(2014, 8, /* Sep */ 1),
  })
})

test('subDays - returns `Invalid Date` if the given date is invalid', () => {
  const result = subDays(new Date(NaN), 10)
  assert({
    given: 'an Invalid Date',
    should: 'return Invalid Date',
    actual: result instanceof Date && isNaN(result.getTime()),
    expected: true,
  })
})

test('subDays - returns `Invalid Date` if the given amount is NaN', () => {
  const result = subDays(new Date(2014, 8, /* Sep */ 1), NaN)
  assert({
    given: 'NaN as amount',
    should: 'return Invalid Date',
    actual: result instanceof Date && isNaN(result.getTime()),
    expected: true,
  })
})
