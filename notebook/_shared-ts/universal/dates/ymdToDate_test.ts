import { assert, test } from '#test'
import ymdToDate from './ymdToDate.ts'

test(ymdToDate.name, () => {
  const given = 'a valid YMD string'
  const should = 'return a valid date'
  const FIXTURE = '2022-09-05'

  const date = ymdToDate(FIXTURE)

  const expected = { year: 2022, month: 8, day: 5 }
  const actual = { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() }

  assert({ given, should, expected, actual })
})
