import { assert, test } from '#test'
import getTimezoneOffsetInMilliseconds from './getTimezoneOffsetInMilliseconds.ts'

test('getTimezoneOffsetInMilliseconds - works for a modern date', () => {
  const date = new Date(2018, 0, /* Jan */ 1, 12, 34, 56, 789)
  const result = date.getTime() - getTimezoneOffsetInMilliseconds(date)
  assert({
    given: 'a modern date (Jan 1, 2018)',
    should: 'return correct UTC offset',
    actual: result,
    expected: Date.UTC(2018, 0, /* Jan */ 1, 12, 34, 56, 789),
  })
})

test('getTimezoneOffsetInMilliseconds - works for a date before standardized timezones', () => {
  const date = new Date(1800, 0, /* Jan */ 1, 12, 34, 56, 789)
  const result = date.getTime() - getTimezoneOffsetInMilliseconds(date)
  assert({
    given: 'a pre-timezone date (Jan 1, 1800)',
    should: 'return correct UTC offset',
    actual: result,
    expected: Date.UTC(1800, 0, /* Jan */ 1, 12, 34, 56, 789),
  })
})

test('getTimezoneOffsetInMilliseconds - works for a date BC', () => {
  const date = new Date(-500, 0, /* Jan */ 1, 12, 34, 56, 789)
  const result = date.getTime() - getTimezoneOffsetInMilliseconds(date)
  assert({
    given: 'a BC date (500 BC)',
    should: 'return correct UTC offset',
    actual: result,
    expected: Date.UTC(-500, 0, /* Jan */ 1, 12, 34, 56, 789),
  })
})
