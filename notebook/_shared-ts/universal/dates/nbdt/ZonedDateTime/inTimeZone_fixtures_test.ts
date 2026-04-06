import { assert, test } from '#test'
import ZonedDateTime from './mod.ts'

// Comprehensive test fixtures for inTimeZone conversions
const INTIMEZONE_FIXTURES = [
  // Basic timezone conversions
  {
    name: 'NYC to LA - same day',
    input: { datetime: '2024-03-15 15:00', from: 'America/New_York' },
    to: 'America/Los_Angeles',
    expected: '2024-03-15 12:00',
    description: '3 PM NYC should be noon LA',
  },
  {
    name: 'LA to NYC - same day',
    input: { datetime: '2024-03-15 09:00', from: 'America/Los_Angeles' },
    to: 'America/New_York',
    expected: '2024-03-15 12:00',
    description: '9 AM LA should be noon NYC',
  },

  // Cross-day conversions (using extended hours notation)
  {
    name: 'LA to Tokyo - extends past midnight',
    input: { datetime: '2024-03-15 20:00', from: 'America/Los_Angeles' },
    to: 'Asia/Tokyo',
    expected: '2024-03-15 36:00', // Extended hours: 36:00 = next day noon
    description: '8 PM LA should be 36:00 (noon next day) Tokyo',
  },
  {
    name: 'Tokyo to LA - crosses back',
    input: { datetime: '2024-03-16 10:00', from: 'Asia/Tokyo' },
    to: 'America/Los_Angeles',
    expected: '2024-03-16 -6:00', // -6:00 = 6 PM previous day
    description: '10 AM Tokyo should be -6:00 (6 PM previous day) LA',
  },

  // Extended hours scenarios
  {
    name: 'Extended hours - LA to HK past midnight',
    input: { datetime: '2024-03-15 23:00', from: 'America/Los_Angeles' },
    to: 'Asia/Hong_Kong',
    expected: '2024-03-15 38:00', // 38:00 = 2 PM next day
    description: '11 PM LA should be 38:00 (2 PM next day) HK',
  },
  {
    name: 'Extended hours - maintaining extended notation',
    input: { datetime: '2024-03-15 26:00', from: 'America/Los_Angeles' },
    to: 'Asia/Hong_Kong',
    expected: '2024-03-15 41:00',
    description: '26:00 (2 AM) LA should become 41:00 (extended) HK',
  },

  // UTC conversions
  {
    name: 'UTC to LA - winter time',
    input: { datetime: '2024-01-15 20:00', from: 'UTC' },
    to: 'America/Los_Angeles',
    expected: '2024-01-15 12:00',
    description: '8 PM UTC should be noon PST (UTC-8)',
  },
  {
    name: 'UTC to LA - summer time',
    input: { datetime: '2024-07-15 20:00', from: 'UTC' },
    to: 'America/Los_Angeles',
    expected: '2024-07-15 13:00',
    description: '8 PM UTC should be 1 PM PDT (UTC-7)',
  },
  {
    name: 'LA to UTC - winter',
    input: { datetime: '2024-01-15 04:00', from: 'America/Los_Angeles' },
    to: 'UTC',
    expected: '2024-01-15 12:00',
    description: '4 AM PST should be noon UTC',
  },
  {
    name: 'LA to UTC - summer',
    input: { datetime: '2024-07-15 05:00', from: 'America/Los_Angeles' },
    to: 'UTC',
    expected: '2024-07-15 12:00',
    description: '5 AM PDT should be noon UTC',
  },

  // European timezones
  {
    name: 'London to Paris - winter',
    input: { datetime: '2024-01-15 12:00', from: 'Europe/London' },
    to: 'Europe/Paris',
    expected: '2024-01-15 13:00',
    description: 'Noon London should be 1 PM Paris (1 hr ahead)',
  },
  {
    name: 'London to Paris - summer',
    input: { datetime: '2024-07-15 12:00', from: 'Europe/London' },
    to: 'Europe/Paris',
    expected: '2024-07-15 13:00',
    description: 'Noon BST should be 1 PM CEST (still 1 hr ahead)',
  },

  // Asian timezones
  {
    name: 'Hong Kong to Singapore',
    input: { datetime: '2024-03-15 14:00', from: 'Asia/Hong_Kong' },
    to: 'Asia/Singapore',
    expected: '2024-03-15 14:00',
    description: 'HK and Singapore are same timezone (UTC+8)',
  },
  {
    name: 'Tokyo to Hong Kong',
    input: { datetime: '2024-03-15 15:00', from: 'Asia/Tokyo' },
    to: 'Asia/Hong_Kong',
    expected: '2024-03-15 14:00',
    description: '3 PM Tokyo should be 2 PM HK (1 hr behind)',
  },

  // Southern hemisphere
  {
    name: 'Sydney to LA - crossing date line backwards',
    input: { datetime: '2024-03-15 09:00', from: 'Australia/Sydney' },
    to: 'America/Los_Angeles',
    expected: '2024-03-15 -9:00', // Negative time: 9 hours before March 15
    description: '9 AM Sydney should be -9:00 (3 PM previous day) LA',
  },

  // Middle East / Africa
  {
    name: 'Dubai to London',
    input: { datetime: '2024-03-15 16:00', from: 'Asia/Dubai' },
    to: 'Europe/London',
    expected: '2024-03-15 12:00',
    description: '4 PM Dubai should be noon London',
  },

  // Central/South America
  {
    name: 'NYC to São Paulo - minimal difference',
    input: { datetime: '2024-01-15 12:00', from: 'America/New_York' },
    to: 'America/Sao_Paulo',
    expected: '2024-01-15 14:00',
    description: 'Noon NYC should be 2 PM São Paulo in January',
  },

  // Edge case: same timezone
  {
    name: 'Same timezone - no change',
    input: { datetime: '2024-03-15 14:30', from: 'America/New_York' },
    to: 'America/New_York',
    expected: '2024-03-15 14:30',
    description: 'Converting to same timezone should not change time',
  },

  // Very extended hours (travel fatigue scenario)
  {
    name: 'Very extended hours - 30+ hour day',
    input: { datetime: '2024-03-15 32:00', from: 'America/Los_Angeles' },
    to: 'Asia/Hong_Kong',
    expected: '2024-03-15 47:00',
    description: '32:00 LA (8 AM next day) should be 47:00 HK',
  },

  // realistic scenario
  {
    name: 'Extended hours',
    input: { datetime: '2024-03-15 27:00', from: 'America/New_York' },
    to: 'America/Chicago',
    expected: '2024-03-15 26:00',
    description: '27:00 in NYC is 26:00 in Chicago',
  },
]

// Run all fixtures
INTIMEZONE_FIXTURES.forEach((fixture) => {
  test(`inTimeZone: ${fixture.name}`, () => {
    const zdt = new ZonedDateTime(fixture.input.datetime, fixture.input.from)
    const converted = zdt.inTimeZone(fixture.to)

    assert({
      given: fixture.description,
      should: `convert to ${fixture.expected}`,
      actual: converted.plainDateTime.toString(),
      expected: fixture.expected,
    })

    // Also verify it's the same instant (unless same timezone)
    if (fixture.input.from !== fixture.to) {
      assert({
        given: `${fixture.name} conversion`,
        should: 'maintain the same instant',
        actual: converted.isSameInstant(zdt),
        expected: true,
      })
    }
  })
})

// Additional test for chaining conversions
test('inTimeZone: chaining multiple conversions', () => {
  const start = new ZonedDateTime('2024-03-15 09:00', 'America/Los_Angeles')

  // LA -> NYC -> London -> Tokyo
  const nyc = start.inTimeZone('America/New_York')
  const london = nyc.inTimeZone('Europe/London')
  const tokyo = london.inTimeZone('Asia/Tokyo')

  // Should all be the same instant
  assert({
    given: 'chained conversions',
    should: 'all represent the same instant',
    actual: tokyo.isSameInstant(start),
    expected: true,
  })

  // Direct conversion should give same result
  const directTokyo = start.inTimeZone('Asia/Tokyo')
  assert({
    given: 'chained vs direct conversion',
    should: 'produce the same result',
    actual: tokyo.plainDateTime.toString(),
    expected: directTokyo.plainDateTime.toString(),
  })
})
