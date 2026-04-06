import { assert, test } from '#test'
import tzOffset from './timezoneOffset.ts'

test(tzOffset.name, { ignore: true }, () => {
  assert({
    given: 'a date',
    should: 'return timezone offset',
    actual: tzOffset(new Date(Date.parse('2023-07-04 15:35:00 CDT'))),
    expected: -5, // will fail as I change timezones, need t
  })
})
