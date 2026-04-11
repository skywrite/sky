import { assert, test } from '#test'
import daysOfYear from './daysOfYear.ts'

test(daysOfYear.name, () => {
  assert({
    given: 'a leap year',
    should: 'return all days in the year',
    expected: 366,
    actual: daysOfYear(2024).length,
  })
})

test(daysOfYear.name, () => {
  assert({
    given: 'not a leap year',
    should: 'return all days in the year',
    expected: 365,
    actual: daysOfYear(2023).length,
  })
})
