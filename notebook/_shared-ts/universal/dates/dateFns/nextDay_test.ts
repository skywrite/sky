import { assert, test } from '#test'
import nextDay from './nextDay.ts'

// came from: https://github.com/date-fns/date-fns/blob/fadbd4eb7920bf932c25f734f3949027b2fe4887/src/nextDay/test.ts

test(nextDay.name, async (t) => {
  await t.step('returns the following Monday given various dates before the same', () => {
    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 20), 1),
      expected: new Date(2020, 2, /* Mar */ 23),
    })

    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 19), 1),
      expected: new Date(2020, 2, /* Mar */ 23),
    })

    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 18), 1),
      expected: new Date(2020, 2, /* Mar */ 23),
    })

    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 17), 1),
      expected: new Date(2020, 2, /* Mar */ 23),
    })

    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 16), 1),
      expected: new Date(2020, 2, /* Mar */ 23),
    })

    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 22), 1),
      expected: new Date(2020, 2, /* Mar */ 23),
    })

    assert({
      actual: nextDay(new Date(2020, 4, /* May */ 2), 1),
      expected: new Date(2020, 4, /* May */ 4),
    })
  })

  await t.step('returns the following Tuesday given the Saturday before it', () => {
    assert({
      actual: nextDay(new Date(2020, 4, /* May */ 2), 2),
      expected: new Date(2020, 4, /* May */ 5),
    })
  })

  await t.step('returns the following Wednesday given the Saturday before it', () => {
    assert({
      actual: nextDay(new Date(2020, 4, /* May */ 2), 3),
      expected: new Date(2020, 4, /* May */ 6),
    })
  })

  await t.step('returns the following Thursday given the Saturday before it', () => {
    assert({
      actual: nextDay(new Date(2020, 4, /* May */ 2), 4),
      expected: new Date(2020, 4, /* May */ 7),
    })
  })

  await t.step('returns the following Friday given the Saturday before it', () => {
    assert({
      actual: nextDay(new Date(2020, 4, /* May */ 2), 5),
      expected: new Date(2020, 4, /* May */ 8),
    })
  })

  await t.step('returns the following Saturday given the Saturday before it', () => {
    assert({
      actual: nextDay(new Date(2020, 4, /* May */ 2), 6),
      expected: new Date(2020, 4, /* May */ 9),
    })
  })

  await t.step('returns next Sunday given the day is Sunday', () => {
    assert({
      actual: nextDay(new Date(2020, 2, /* Mar */ 22), 0),
      expected: new Date(2020, 2, /* Mar */ 29),
    })
  })
})
