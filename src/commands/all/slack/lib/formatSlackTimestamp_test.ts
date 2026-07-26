import { assert, test } from '#test'
import formatSlackTimestamp from './formatSlackTimestamp.ts'

test('formatSlackTimestamp: formats valid Slack timestamp', () => {
  // 1700000000 = 2023-11-14 22:13 UTC
  assert({
    given: 'a valid Slack ts in UTC',
    should: 'return formatted date string',
    actual: formatSlackTimestamp('1700000000.000000', 'UTC'),
    expected: '2023-11-14 22:13',
  })
})

test('formatSlackTimestamp: respects timezone', () => {
  // 1700000000 = 2023-11-14 16:13 CST (UTC-6)
  assert({
    given: 'a valid Slack ts in America/Chicago',
    should: 'return time in that timezone',
    actual: formatSlackTimestamp('1700000000.000000', 'America/Chicago'),
    expected: '2023-11-14 16:13',
  })
})

test('formatSlackTimestamp: returns raw ts for non-numeric input', () => {
  assert({
    given: 'a non-numeric ts',
    should: 'return the raw string',
    actual: formatSlackTimestamp('not-a-number', 'UTC'),
    expected: 'not-a-number',
  })
})
