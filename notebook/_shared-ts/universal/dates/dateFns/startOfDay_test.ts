import { assert, test } from '#test'
import startOfDay from './startOfDay.ts'

test('startOfDay - returns the date with the time set to 00:00:00', () => {
  assert({
    given: 'Sep 2, 2014 at 11:55',
    should: 'return Sep 2, 2014 at 00:00:00',
    actual: startOfDay(new Date(2014, 8, /* Sep */ 2, 11, 55, 0)),
    expected: new Date(2014, 8, /* Sep */ 2, 0, 0, 0, 0),
  })
})

test('startOfDay - does not mutate the original date', () => {
  const date = new Date(2014, 8, /* Sep */ 2, 11, 55, 0)
  startOfDay(date)
  assert({
    given: 'the original date after startOfDay',
    should: 'not be mutated',
    actual: date,
    expected: new Date(2014, 8, /* Sep */ 2, 11, 55, 0),
  })
})

test('startOfDay - returns `Invalid Date` if the given date is invalid', () => {
  const result = startOfDay(new Date(NaN))
  assert({
    given: 'an Invalid Date',
    should: 'return Invalid Date',
    actual: result instanceof Date && isNaN(result.getTime()),
    expected: true,
  })
})
