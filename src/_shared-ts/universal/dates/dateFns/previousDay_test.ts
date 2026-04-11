import { assert, test } from '#test'
import previousDay from './previousDay.ts'

test('previousDay - returns the previous Monday given various dates after the same', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 18), 1),
    expected: new Date(2021, 5, /* Jun */ 14),
  })

  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 17), 1),
    expected: new Date(2021, 5, /* Jun */ 14),
  })

  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 14), 1),
    expected: new Date(2021, 5, /* Jun */ 7),
  })

  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 9), 1),
    expected: new Date(2021, 5, /* Jun */ 7),
  })

  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 8), 1),
    expected: new Date(2021, 5, /* Jun */ 7),
  })

  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 7), 1),
    expected: new Date(2021, 4, /* May */ 31),
  })
})

test('previousDay - returns the previous Tuesday given the Saturday after it', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 26), 2),
    expected: new Date(2021, 5, /* Jun */ 22),
  })
})

test('previousDay - returns the previous Wednesday given the Saturday after it', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 26), 3),
    expected: new Date(2021, 5, /* Jun */ 23),
  })
})

test('previousDay - returns the previous Thursday given the Saturday after it', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 26), 4),
    expected: new Date(2021, 5, /* Jun */ 24),
  })
})

test('previousDay - returns the previous Friday given the Saturday after it', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 26), 5),
    expected: new Date(2021, 5, /* Jun */ 25),
  })
})

test('previousDay - returns the previous Saturday given the Saturday after it', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 26), 6),
    expected: new Date(2021, 5, /* Jun */ 19),
  })
})

test('previousDay - returns the previous Sunday given the day is Sunday', () => {
  assert({
    actual: previousDay(new Date(2021, 5, /* Jun */ 27), 0),
    expected: new Date(2021, 5, /* Jun */ 20),
  })
})
