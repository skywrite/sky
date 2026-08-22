import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'

test('ZonedDateTime.epochMilliseconds - basic conversion', () => {
  // In March, LA is UTC-7 (PDT): 12:00 LA = 19:00 UTC
  const la = new ZonedDateTime('2024-03-15 12:00', 'America/Los_Angeles')
  assert({
    given: 'noon in LA (PDT)',
    should: 'name the correct UTC instant',
    actual: la.epochMilliseconds,
    expected: new Date('2024-03-15T19:00:00Z').getTime(),
  })
})

test('ZonedDateTime.epochMilliseconds - timezone conversions preserve the instant', () => {
  const la = new ZonedDateTime('2024-03-15 09:00', 'America/Los_Angeles')
  const nyc = la.inTimeZone('America/New_York')
  const tokyo = la.inTimeZone('Asia/Tokyo')

  assert({
    given: 'the same instant in NYC',
    should: 'carry the same epoch milliseconds',
    actual: nyc.epochMilliseconds,
    expected: la.epochMilliseconds,
  })
  assert({
    given: 'the same instant in Tokyo',
    should: 'carry the same epoch milliseconds',
    actual: tokyo.epochMilliseconds,
    expected: la.epochMilliseconds,
  })
})

test('ZonedDateTime.epochMilliseconds - extended hours', () => {
  // 26:00 on March 15 = 02:00 on March 16; in PDT (UTC-7): 02:00 LA = 09:00 UTC
  const extended = new ZonedDateTime('2024-03-15 26:00', 'America/Los_Angeles')
  assert({
    given: 'extended hours (26:00)',
    should: 'roll the day before resolving the instant',
    actual: extended.epochMilliseconds,
    expected: new Date('2024-03-16T09:00:00Z').getTime(),
  })
})

test('ZonedDateTime.epochMilliseconds - winter vs summer time', () => {
  const winter = new ZonedDateTime('2024-01-15 12:00', 'America/Los_Angeles')
  const summer = new ZonedDateTime('2024-07-15 12:00', 'America/Los_Angeles')

  assert({
    given: 'noon in January (PST)',
    should: 'be 20:00 UTC',
    actual: winter.epochMilliseconds,
    expected: new Date('2024-01-15T20:00:00.000Z').getTime(),
  })
  assert({
    given: 'noon in July (PDT)',
    should: 'be 19:00 UTC',
    actual: summer.epochMilliseconds,
    expected: new Date('2024-07-15T19:00:00.000Z').getTime(),
  })
})

test('ZonedDateTime.epochMilliseconds - duration across timezones', () => {
  // 9 AM NYC = 6 AM LA; 11 PM LA is 17 hours later
  const started = new ZonedDateTime('2024-03-15 09:00', 'America/New_York')
  const ended = new ZonedDateTime('2024-03-15 23:00', 'America/Los_Angeles')
  const durationHours = (ended.epochMilliseconds - started.epochMilliseconds) / 3_600_000

  assert({
    given: 'a day started in NYC and ended in LA',
    should: 'span 17 hours',
    actual: durationHours,
    expected: 17,
  })
})

test('ZonedDateTime.toDateValue - the JS Date boundary adapter', () => {
  const la = new ZonedDateTime('2024-03-15 12:00', 'America/Los_Angeles')
  assert({
    given: 'a ZonedDateTime',
    should: 'return a Date at the same instant',
    actual: la.toDateValue().getTime(),
    expected: la.epochMilliseconds,
  })
  assert({
    given: 'a ZonedDateTime',
    should: 'render the correct UTC instant',
    actual: la.toDateValue().toISOString(),
    expected: '2024-03-15T19:00:00.000Z',
  })
})
