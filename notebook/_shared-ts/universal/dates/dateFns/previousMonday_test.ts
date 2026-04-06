import { assert, test } from '#test'
import previousMonday from './previousMonday.ts'

test('previousMonday - returns the previous Monday given various dates after the same', () => {
  assert({
    actual: previousMonday(new Date(2021, 5, /* Jun */ 5)),
    expected: new Date(2021, 4, /* May */ 31),
  })

  assert({
    actual: previousMonday(new Date(2021, 5, /* Jun */ 6)),
    expected: new Date(2021, 4, /* May */ 31),
  })

  assert({
    actual: previousMonday(new Date(2021, 5, /* Jun */ 7)),
    expected: new Date(2021, 4, /* May */ 31),
  })

  assert({
    actual: previousMonday(new Date(2021, 5, /* Jun */ 14)),
    expected: new Date(2021, 5, /* Jun */ 7),
  })

  assert({
    actual: previousMonday(new Date(2021, 5, /* Jun */ 15)),
    expected: new Date(2021, 5, /* Jun */ 14),
  })

  assert({
    actual: previousMonday(new Date(2021, 5, /* Jun */ 16)),
    expected: new Date(2021, 5, /* Jun */ 14),
  })
})

test('previousMonday - returns `Invalid Date` if the given date is invalid', () => {
  assert({
    given: 'an Invalid Date',
    should: 'return a Date instance',
    actual: previousMonday(new Date(NaN)) instanceof Date,
    expected: true,
  })
})
