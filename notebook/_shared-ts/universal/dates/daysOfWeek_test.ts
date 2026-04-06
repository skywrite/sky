import { assert, test } from '#test'
import daysOfWeek from './daysOfWeek.ts'

test(daysOfWeek.name, () => {
  const FIXTURES = {
    'Mon May 31 2021': 7,
    'Sun Jun 06 2021': 7,
    'Sat Jan 01 2022': 2,
    'Sun Jan 02 2022': 2,
    'Thu Mar 21 2022': 7,
    'Sun Mar 27 2022': 7,
    'Sat Apr 02 2022': 7,
    'Thu Sep 01 2022': 7,
    'Mon Sep 05 2022': 7,
    'Sat Dec 31 2022': 6,
    'Sun Jan 01 2023': 1,
  }

  for (const [dateStr, dateCount] of Object.entries(FIXTURES)) {
    assert({
      given: `the ${dateStr}`,
      should: 'return array',
      actual: daysOfWeek(new Date(dateStr)).length,
      expected: dateCount,
    })
  }
})
