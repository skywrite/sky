import { assert, test } from '#test'
import PlainDateTime from '../PlainDateTime/mod.ts'
import ZonedDateTime from './mod.ts'

test('ZonedDateTime.toDayDateValue()', () => {
  const zdt = new ZonedDateTime('2024-03-15 14:30', 'America/Los_Angeles')
  const dayDate = zdt.toDayDateValue()

  assert({
    given: 'a ZonedDateTime',
    should: 'return Date with correct year',
    actual: dayDate.getFullYear(),
    expected: 2024,
  })

  assert({
    given: 'a ZonedDateTime',
    should: 'return Date with correct month (0-based)',
    actual: dayDate.getMonth(),
    expected: 2, // March = 2 (0-based)
  })

  assert({
    given: 'a ZonedDateTime',
    should: 'return Date with correct day',
    actual: dayDate.getDate(),
    expected: 15,
  })
})

test('ZonedDateTime.toTimeDateValue() - basic conversion', () => {
  // Create a time in LA
  const la = new ZonedDateTime('2024-03-15 12:00', 'America/Los_Angeles')
  const date = la.toTimeDateValue()

  // In March, LA is UTC-7 (PDT)
  // So 12:00 LA = 19:00 UTC
  const expectedUTC = new Date('2024-03-15T19:00:00Z')

  assert({
    given: 'noon in LA (PDT)',
    should: 'return Date representing correct UTC instant',
    actual: date.toISOString(),
    expected: expectedUTC.toISOString(),
  })
})

test('ZonedDateTime.toTimeDateValue() - timezone conversions preserve instant', () => {
  const la = new ZonedDateTime('2024-03-15 09:00', 'America/Los_Angeles')
  const nyc = la.inTimeZone('America/New_York')
  const tokyo = la.inTimeZone('Asia/Tokyo')

  const laDate = la.toTimeDateValue()
  const nycDate = nyc.toTimeDateValue()
  const tokyoDate = tokyo.toTimeDateValue()

  assert({
    given: 'same instant in different timezones',
    should: 'all return the same Date timestamp',
    actual: laDate.getTime(),
    expected: nycDate.getTime(),
  })

  assert({
    given: 'same instant in different timezones',
    should: 'LA and Tokyo have same timestamp',
    actual: laDate.getTime(),
    expected: tokyoDate.getTime(),
  })
})

test('ZonedDateTime.toTimeDateValue() - extended hours', () => {
  // 26:00 = 2 AM next day
  const extended = new ZonedDateTime('2024-03-15 26:00', 'America/Los_Angeles')
  const date = extended.toTimeDateValue()

  // 26:00 on March 15 = 02:00 on March 16
  // In PDT (UTC-7): 02:00 LA = 09:00 UTC on March 16
  const expectedUTC = new Date('2024-03-16T09:00:00Z')

  assert({
    given: 'extended hours (26:00)',
    should: 'handle day rollover correctly',
    actual: date.toISOString(),
    expected: expectedUTC.toISOString(),
  })
})

test('ZonedDateTime.toTimeDateValue() - winter vs summer time', () => {
  // January = PST (UTC-8)
  const winter = new ZonedDateTime('2024-01-15 12:00', 'America/Los_Angeles')
  const winterDate = winter.toTimeDateValue()

  // July = PDT (UTC-7)
  const summer = new ZonedDateTime('2024-07-15 12:00', 'America/Los_Angeles')
  const summerDate = summer.toTimeDateValue()

  // Winter: 12:00 PST = 20:00 UTC
  // Summer: 12:00 PDT = 19:00 UTC

  assert({
    given: 'noon in January (PST)',
    should: 'be 20:00 UTC',
    actual: winterDate.toISOString(),
    expected: '2024-01-15T20:00:00.000Z',
  })

  assert({
    given: 'noon in July (PDT)',
    should: 'be 19:00 UTC',
    actual: summerDate.toISOString(),
    expected: '2024-07-15T19:00:00.000Z',
  })
})

test('ZonedDateTime.toTimeDateValue() - duration calculation', () => {
  // Start day in NYC
  const started = new ZonedDateTime('2024-03-15 09:00', 'America/New_York')

  // End day in LA (after flying)
  const ended = new ZonedDateTime('2024-03-15 23:00', 'America/Los_Angeles')

  // Calculate duration using the Date objects
  const startDate = started.toTimeDateValue()
  const endDate = ended.toTimeDateValue()
  const durationMs = endDate.getTime() - startDate.getTime()
  const durationHours = durationMs / (1000 * 60 * 60)

  // 9 AM NYC = 6 AM LA
  // 11 PM LA = 11 PM LA
  // Duration = 17 hours

  assert({
    given: 'day starting in NYC and ending in LA',
    should: 'calculate correct duration in hours',
    actual: durationHours,
    expected: 17,
  })
})
