import { assert, test } from '#test'
import addDays from './addDays.ts'

test(addDays.name, () => {
  const given = 'a valid date and number of days'
  const should = 'return a date + number of days'

  // from: https://github.com/date-fns/date-fns/blob/main/src/addDays/test.ts
  const actual = addDays(new Date(2014, 8, /* Sep */ 1), 10)
  const expected = new Date(2014, 8, /* Sep */ 11)

  assert({ given, should, actual, expected })
})
