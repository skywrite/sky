import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

test('ZonedDateTime.millisBetween - same timezone', () => {
  const start = new ZonedDateTime('2025-02-05 08:00', 'America/Chicago')
  const end = new ZonedDateTime('2025-02-05 09:00', 'America/Chicago')

  assert({
    given: 'Two times 1 hour apart in same timezone',
    should: 'return 3600000 milliseconds',
    actual: start.millisBetween(end),
    expected: 3600000,
  })
})

test('ZonedDateTime.millisBetween - different timezones', () => {
  const chicago = new ZonedDateTime('2025-02-05 08:00', 'America/Chicago')
  const newYork = new ZonedDateTime('2025-02-05 09:00', 'America/New_York')

  // Chicago 08:00 and NY 09:00 are the same instant (NY is 1 hour ahead)
  assert({
    given: 'Chicago 08:00 and New York 09:00 (same instant)',
    should: 'return 0 milliseconds',
    actual: chicago.millisBetween(newYork),
    expected: 0,
  })
})

test('ZonedDateTime.millisBetween - negative when other is before', () => {
  const later = new ZonedDateTime('2025-02-05 10:00', 'America/Chicago')
  const earlier = new ZonedDateTime('2025-02-05 08:00', 'America/Chicago')

  assert({
    given: 'Later time compared to earlier time',
    should: 'return negative milliseconds',
    actual: later.millisBetween(earlier),
    expected: -7200000, // -2 hours in milliseconds
  })
})

// hoursBetween tests moved to hoursBetween_test.ts

test('ZonedDateTime.minutesBetween', () => {
  const start = new ZonedDateTime('2025-02-05 08:00', 'America/Chicago')
  const end = new ZonedDateTime('2025-02-05 08:30', 'America/Chicago')

  assert({
    given: 'Two times 30 minutes apart',
    should: 'return 30 minutes',
    actual: start.minutesBetween(end),
    expected: 30,
  })
})

test('ZonedDateTime.daysBetween', () => {
  const start = new ZonedDateTime('2025-02-01 08:00', 'America/Chicago')
  const end = new ZonedDateTime('2025-02-08 08:00', 'America/Chicago')

  assert({
    given: 'Two times exactly 7 days apart',
    should: 'return 7 days',
    actual: start.daysBetween(end),
    expected: 7,
  })
})

test('ZonedDateTime.daysBetween - fractional days', () => {
  const start = new ZonedDateTime('2025-02-01 08:00', 'America/Chicago')
  const end = new ZonedDateTime('2025-02-02 20:00', 'America/Chicago')

  assert({
    given: 'Two times 1.5 days apart',
    should: 'return 1.5 days',
    actual: start.daysBetween(end),
    expected: 1.5,
  })
})
