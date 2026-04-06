import { assert, test } from '#test'
import nextSunday from './nextSunday.ts'

test('nextSunday - returns the following Sunday given various dates before the same', () => {
  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 23)),
    expected: new Date(2020, 4, /* May */ 24),
  })

  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 22)),
    expected: new Date(2020, 4, /* May */ 24),
  })

  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 21)),
    expected: new Date(2020, 4, /* May */ 24),
  })

  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 20)),
    expected: new Date(2020, 4, /* May */ 24),
  })

  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 19)),
    expected: new Date(2020, 4, /* May */ 24),
  })

  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 18)),
    expected: new Date(2020, 4, /* May */ 24),
  })

  assert({
    actual: nextSunday(new Date(2020, 4, /* May */ 17)),
    expected: new Date(2020, 4, /* May */ 24),
  })
})

test('nextSunday - returns `Invalid Date` if the given date is invalid', () => {
  assert({
    given: 'an Invalid Date',
    should: 'return a Date instance',
    actual: nextSunday(new Date(NaN)) instanceof Date,
    expected: true,
  })
})
