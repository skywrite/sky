import { assert, test } from '#test'
import firstDayOfWeek from './firstDayOfWeek.ts'

test(firstDayOfWeek.name, () => {
  const mon1 = 'Mon Sep 12 2022'
  assert({
    given: 'a normal monday',
    should: 'return same date',
    actual: firstDayOfWeek(new Date(mon1)).toDateString(),
    expected: mon1,
  })

  assert({
    given: 'a normal wed',
    should: 'return the previous monday',
    actual: firstDayOfWeek(new Date('Wed Sep 14 2022')).toDateString(),
    expected: mon1,
  })

  assert({
    given: 'a date in a new year',
    should: 'return Jan 1st',
    actual: firstDayOfWeek(new Date('Sun Jan 02 2022')).toDateString(),
    expected: 'Sat Jan 01 2022',
  })

  assert({
    given: 'a date in a new year',
    should: 'return Jan 1st',
    actual: firstDayOfWeek(new Date('Sun Jan 01 2023')).toDateString(),
    expected: 'Sun Jan 01 2023',
  })

  assert({
    given: 'a date in a new year',
    should: 'return Sunday',
    actual: firstDayOfWeek(new Date('Sun Jan 01 2023')).toDateString(),
    expected: 'Sun Jan 01 2023',
  })
})
