import { assert, test } from '#test'
import lastDayOfWeek from './lastDayOfWeek.ts'

test(lastDayOfWeek.name, () => {
  assert({
    given: 'a normal monday',
    should: 'return sunday',
    actual: lastDayOfWeek(new Date('Mon Sep 12 2022')).toDateString(),
    expected: 'Sun Sep 18 2022',
  })

  assert({
    given: 'a normal wed',
    should: 'return the following Sunday',
    actual: lastDayOfWeek(new Date('Wed Sep 14 2022')).toDateString(),
    expected: 'Sun Sep 18 2022',
  })

  assert({
    given: 'a normal Sun',
    should: 'return the Sunday',
    actual: lastDayOfWeek(new Date('Sun Sep 18 2022')).toDateString(),
    expected: 'Sun Sep 18 2022',
  })

  assert({
    given: 'Jan 1st',
    should: 'return following Sunday',
    actual: lastDayOfWeek(new Date('Sat Jan 01 2022')).toDateString(),
    expected: 'Sun Jan 02 2022',
  })

  assert({
    given: 'a date in the last week of the year',
    should: 'return Dec 31st',
    actual: lastDayOfWeek(new Date('Thu Dec 29 2022')).toDateString(),
    expected: 'Sat Dec 31 2022',
  })
})
