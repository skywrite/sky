import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'

test('ZonedDateTime.inTimeZone - automatic conversion', () => {
  const laTime = new ZonedDateTime('2024-03-15 14:00', 'America/Los_Angeles')
  const nyTime = laTime.inTimeZone('America/New_York')

  assert({
    given: 'converting timezone',
    should: 'adjust the time correctly',
    actual: nyTime.plainDateTime.time,
    expected: '17:00', // 3 hours ahead
  })

  assert({
    given: 'converting timezone',
    should: 'represent the same instant',
    actual: nyTime.isSameInstant(laTime),
    expected: true,
  })
})

test('ZonedDateTime with extended hours during travel', () => {
  // Scenario: Been awake for 20+ hours during travel
  const longDay = new ZonedDateTime('2024-03-15 28:30', 'America/Los_Angeles')

  assert({
    given: 'extended hours past midnight',
    should: 'preserve extended hours',
    actual: longDay.plainDateTime.time,
    expected: '28:30',
  })

  // Convert to Hong Kong time
  const hkTime = longDay.inTimeZone('Asia/Hong_Kong')

  assert({
    given: 'converting with extended hours',
    should: 'adjust time with timezone offset',
    actual: hkTime.plainDateTime.time.includes(':30'),
    expected: true,
  })

  assert({
    given: 'converting to different timezone',
    should: 'maintain the same instant',
    actual: hkTime.isSameInstant(longDay),
    expected: true,
  })
})
