import { assert, test } from '#test'
import isLeapYear from './isLeapYear.ts'

test(isLeapYear.name, () => {
  const leapYears = [2020, 2024, 2028, 2032, 2036]
  const misYears = [2021, 2022, 2023, 2025, 2026]

  leapYears.forEach((year) => {
    assert({
      given: 'a leap year',
      should: 'return true',
      expected: true,
      actual: isLeapYear(year),
    })
  })

  misYears.forEach((year) => {
    assert({
      given: 'not a leap year',
      should: 'return false',
      expected: false,
      actual: isLeapYear(year),
    })
  })
})
