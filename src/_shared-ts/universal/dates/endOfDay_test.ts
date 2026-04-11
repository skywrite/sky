import { assert, test } from '#test'
import endOfDay from './endOfDay.ts'

test(endOfDay.name, () => {
  const given = 'a date with any time'
  const should = 'return the same date with the time set to 17:30'

  const refDate = new Date(2023, 2, /* March */ 30, 13, 22, 3, 122)
  const newDate = endOfDay(refDate)

  assert({ given, should, expected: 2023, actual: newDate.getFullYear() })
  assert({ given, should, expected: 2, actual: newDate.getMonth() })
  assert({ given, should, expected: 30, actual: newDate.getDate() })

  assert({ given, should, expected: 17, actual: newDate.getHours() })
  assert({ given, should, expected: 30, actual: newDate.getMinutes() })
  assert({ given, should, expected: 0, actual: newDate.getSeconds() })
  assert({ given, should, expected: 0, actual: newDate.getMilliseconds() })
})
