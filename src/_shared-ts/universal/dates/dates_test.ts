import { assert, test } from '#test'
import { shortTimeAMPMGMT, toUTCDateString } from './dates.ts'
// import { DIR_TIME } from '#config'

test({
  name: 'dates > toUTCDateString()',
  fn: () => {
    const ts = 1648372676000
    const d = new Date(ts)

    assert({
      given: 'a timestamp for 2022-03-27 09:17:56 UTC',
      should: 'return formatted UTC string',
      actual: toUTCDateString(d),
      expected: '2022-03-27 09:17:56 UTC',
    })
  },
})

test({
  name: 'dates > new Date()',
  fn: () => {
    const ts = '2022-03-27 09:17:56 UTC'
    const d = new Date(ts)

    assert({
      given: 'a UTC date string',
      should: 'return correct timestamp',
      actual: d.getTime(),
      expected: 1648372676000,
    })
  },
})

/*
test({
  name: 'dates > shorTimeAMPMGMT() ',
  fn: () => {
    const d1Str = '2022-06-21 3:23 PM GMT-5'
    const d1 = new Date(d1Str)

    const expected = '3:23 PM GMT-5'
    const actual = shortTimeAMPMGMT(d1)
    asserts.assertEquals(actual, expected)
  }
})
*/
