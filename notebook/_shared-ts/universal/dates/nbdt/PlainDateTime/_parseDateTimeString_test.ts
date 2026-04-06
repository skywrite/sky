import { assert, test } from '#test'
import { YMD } from '#universal/dates/mod.ts'
import _parseDateTimeString from './_parseDateTimeString.ts'

const NOW = new Date()
const [NOW_YEAR, NOW_MONTH, NOW_DAY] = YMD(NOW)

const FIXTURES = [
  {
    input: '13:45',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY}`, '13:45'],
  },
  {
    input: '8:45',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY}`, '08:45'],
  },
  {
    input: '25:45',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY}`, '25:45'],
  },
  {
    input: '27:3',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-${NOW_DAY}`, '27:03'],
  },
  {
    input: '10 8:45',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-10`, '08:45'],
  },
  {
    input: '10 13:45',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-10`, '13:45'],
  },
  {
    input: '10 25:45',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-10`, '25:45'],
  },
  {
    input: '10 20',
    expected: [`${NOW_YEAR}-${NOW_MONTH}-10`, '20:00'],
  },
  {
    input: '2-10 13:45',
    expected: [`${NOW_YEAR}-02-10`, '13:45'],
  },
  {
    input: '02-10 13:45',
    expected: [`${NOW_YEAR}-02-10`, '13:45'],
  },
  {
    input: '02-10',
    expected: [`${NOW_YEAR}-02-10`, '00:00'],
  },
  {
    input: '2023-10-09',
    expected: [`2023-10-09`, '00:00'],
  },
  {
    input: '2023-02-10 13:45',
    expected: [`2023-02-10`, '13:45'],
  },
  {
    input: '2023-05-01 12:00',
    expected: [`2023-05-01`, '12:00'],
  },
  // T separator (ISO 8601)
  {
    input: '2023-02-10T13:45',
    expected: [`2023-02-10`, '13:45'],
  },
  {
    input: '2026-02-15T16:39',
    expected: [`2026-02-15`, '16:39'],
  },
  {
    input: '2023-10-09T00:00',
    expected: [`2023-10-09`, '00:00'],
  },
]

FIXTURES.forEach(({ input, expected }) => {
  test(_parseDateTimeString.name + ` ${input}`, () => {
    const actual = _parseDateTimeString(input)

    assert({
      given: `a valid input string: ${input}`,
      should: `return a valid Date representing date from string: ${expected}`,
      actual,
      expected: expected,
    })
  })
})
