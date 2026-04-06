import { assert, test } from '#test'
import nextMonday from './nextMonday.ts'

test('nextMonday - returns the following Monday given various dates before the same', () => {
  assert({
    actual: nextMonday(new Date(2020, 2, /* Mar */ 23)),
    expected: new Date(2020, 2, /* Mar */ 30),
  })

  assert({
    actual: nextMonday(new Date(2020, 2, /* Mar */ 22)),
    expected: new Date(2020, 2, /* Mar */ 23),
  })

  assert({
    actual: nextMonday(new Date(2020, 3, /* Apr */ 11)),
    expected: new Date(2020, 3, /* Apr */ 13),
  })

  assert({
    actual: nextMonday(new Date(2020, 2, /* Mar */ 20)),
    expected: new Date(2020, 2, /* Mar */ 23),
  })

  assert({
    actual: nextMonday(new Date(2020, 2, /* Mar */ 19)),
    expected: new Date(2020, 2, /* Mar */ 23),
  })

  assert({
    actual: nextMonday(new Date(2020, 2, /* Mar */ 18)),
    expected: new Date(2020, 2, /* Mar */ 23),
  })

  assert({
    actual: nextMonday(new Date(2020, 2, /* Mar */ 17)),
    expected: new Date(2020, 2, /* Mar */ 23),
  })
})

test('nextMonday - returns `Invalid Date` if the given date is invalid', () => {
  assert({
    given: 'an Invalid Date',
    should: 'return a Date instance',
    actual: nextMonday(new Date(NaN)) instanceof Date,
    expected: true,
  })
})
