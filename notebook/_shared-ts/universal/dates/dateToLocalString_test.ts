import { assert, test } from '#test'
import dateToLocalString from './dateToLocalString.ts'
import timezoneOffset from './timezones/timezoneOffset.ts'

test(dateToLocalString.name, { ignore: timezoneOffset() != -6 }, () => {
  assert({
    given: 'a date',
    should: 'return local date and time string',
    actual: dateToLocalString(new Date(2023, 1, 17, 6, 38)),
    // test will fail in a different timezone
    expected: '2023-02-17 06:38 UTC-6',
  })
})
