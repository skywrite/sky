import { assert, test } from '#test'
import PlainDateTime from './mod.ts'
import { YMD } from '#universal/dates/mod.ts'

const NOW = new Date()
const [NOW_YEAR, NOW_MONTH, NOW_DAY] = YMD(NOW)
const NOW_HOUR = ('0' + NOW.getHours()).slice(-2)
const NOW_MIN = ('0' + NOW.getMinutes()).slice(-2)

test(PlainDateTime.name, () => {
  const dt = new PlainDateTime()
  const actual = dt.toString()
  const expected = `${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY} ${NOW_HOUR}:${NOW_MIN}`

  assert({
    given: `no input`,
    should: `return a valid string representing a PlainDateTime: ${expected}`,
    actual,
    expected: expected,
  })
})
