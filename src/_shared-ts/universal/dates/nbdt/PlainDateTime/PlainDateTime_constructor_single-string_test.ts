import { assert, test } from '#test'
import PlainDateTime from './mod.ts'
import { YMD } from '#universal/dates/mod.ts'

const NOW = new Date()
const [NOW_YEAR, NOW_MONTH, NOW_DAY] = YMD(NOW)

const FIXTURES = [
  {
    input: ['13:45'],
    expected: `${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY} 13:45`,
  },
  {
    input: ['31:45'],
    expected: `${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY} 31:45`,
  },
  {
    input: ['10 13:45'],
    expected: `${NOW_YEAR}-${NOW_MONTH}-10 13:45`,
  },
  {
    input: ['02-10 13:45'],
    expected: `${NOW_YEAR}-02-10 13:45`,
  },
  {
    input: ['2024-02-10 13:45'],
    expected: `2024-02-10 13:45`,
  },
  {
    input: ['2024-02-10'],
    expected: `2024-02-10 00:00`,
  },
]

test(PlainDateTime.name, () => {
  FIXTURES.forEach(({ input, expected }) => {
    const dt = new PlainDateTime(input[0])
    const actual = dt.toString()

    assert({
      given: `a valid input: ${input}`,
      should: `return a valid string representing a PlainDateTime: ${expected}`,
      actual,
      expected: expected,
    })
  })
})
