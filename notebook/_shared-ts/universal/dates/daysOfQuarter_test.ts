import { assert, test } from '#test'
import daysOfQuarter from './daysOfQuarter.ts'
import ymd from '#universal/dates/ymd.ts'

const FIXTURES = [
  { first: '2023-01-01', last: '2023-03-31' },
  { first: '2023-04-01', last: '2023-06-30' },
  { first: '2023-07-01', last: '2023-09-30' },
  { first: '2023-10-01', last: '2023-12-31' },
]

const ymdStr = (date: Date | undefined) => ymd(date).join('-')

test(daysOfQuarter.name, () => {
  const given = 'non leap year'
  const should = 'have 365 days for all quarters'
  const year = 2023

  let days: Date[] = []
  const quarters = [1, 2, 3, 4]

  quarters.forEach((quarter) => {
    days = [...days, ...daysOfQuarter(year, quarter)]
  })

  assert({ given, should, expected: 365, actual: days.length })
})

test(daysOfQuarter.name, () => {
  const given = 'leap year'
  const should = 'have 366 days for all quarters'
  const year = 2024

  let days: Date[] = []
  const quarters = [1, 2, 3, 4]

  quarters.forEach((quarter) => {
    days = [...days, ...daysOfQuarter(year, quarter)]
  })

  assert({ given, should, expected: 366, actual: days.length })
})

test(daysOfQuarter.name, () => {
  const given = 'quarter'
  const should = 'correct first and last date'
  const year = 2023

  FIXTURES.forEach((obj, i) => {
    const days = daysOfQuarter(year, i + 1)

    assert({
      given,
      should,
      actual: { first: ymdStr(days.at(0)), last: ymdStr(days.at(-1)) },
      expected: obj,
    })
  })
})
