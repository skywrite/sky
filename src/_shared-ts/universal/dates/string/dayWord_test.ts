import { assert, test } from '#test'
import dayWord from './dayWord.ts'

test(dayWord.name, () => {
  const given = 'a valid date'
  const should = 'return day word'

  const fixture = new Date(2023, 2, /* Mar */ 12)
  const tests = [
    ['long', 'Sunday'],
    ['short', 'Sun'],
    ['narrow', 'S'],
  ]

  tests.forEach(([type, expected]) => {
    assert({
      given,
      should,
      actual: dayWord(fixture, <Intl.DateTimeFormatOptions['weekday']>type),
      expected,
    })
  })
})
