import { assert, test } from '#test'
import timezoneToAbbreviation from './timezoneToAbbreviation.ts'

const fixtures = [
  {
    timezone: 'America/Chicago',
    date: '2024-01-15T12:00:00',
    expected: 'CST',
    description: 'Chicago winter',
    isReliable: true,
  },
  {
    timezone: 'America/Chicago',
    date: '2024-07-15T12:00:00',
    expected: 'CDT',
    description: 'Chicago summer',
    isReliable: true,
  },
  {
    timezone: 'America/New_York',
    date: '2024-01-15T12:00:00',
    expected: 'EST',
    description: 'New York winter',
    isReliable: true,
  },
  {
    timezone: 'America/New_York',
    date: '2024-07-15T12:00:00',
    expected: 'EDT',
    description: 'New York summer',
    isReliable: true,
  },
  {
    timezone: 'America/Los_Angeles',
    date: '2024-01-15T12:00:00',
    expected: 'PST',
    description: 'Los Angeles winter',
    isReliable: true,
  },
  {
    timezone: 'America/Los_Angeles',
    date: '2024-07-15T12:00:00',
    expected: 'PDT',
    description: 'Los Angeles summer',
    isReliable: true,
  },
  {
    timezone: 'UTC',
    date: '2024-03-15T12:00:00',
    expected: 'UTC',
    description: 'UTC timezone',
    isReliable: true,
  },
  {
    timezone: 'Europe/London',
    date: '2024-03-15T12:00:00',
    expected: 'GMT',
    description: 'London winter',
    isReliable: true,
  },
  {
    timezone: 'Europe/London',
    date: '2024-07-15T12:00:00',
    expected: 'BST',
    description: 'London summer',
    isReliable: false, // May return 'GMT+1' in some environments
  },
  {
    timezone: 'America/Phoenix',
    date: '2024-07-15T12:00:00',
    expected: 'MST',
    description: 'Arizona (no DST)',
    isReliable: true,
  },
  {
    timezone: 'Asia/Hong_Kong',
    date: '2024-03-15T12:00:00',
    expected: 'HKT',
    description: 'Hong Kong',
    isReliable: false, // May vary by environment
  },
  {
    timezone: 'Asia/Tokyo',
    date: '2024-03-15T12:00:00',
    expected: 'JST',
    description: 'Tokyo',
    isReliable: false, // May vary by environment
  },
  {
    timezone: 'Asia/Kolkata',
    date: '2024-03-15T12:00:00',
    expected: 'IST',
    description: 'India',
    isReliable: false, // May vary by environment
  },
  {
    timezone: 'Australia/Sydney',
    date: '2024-12-25T12:00:00',
    expected: 'AEDT',
    description: 'Sydney summer',
    isReliable: false, // May vary by environment
  },
  {
    timezone: 'Australia/Sydney',
    date: '2024-06-25T12:00:00',
    expected: 'AEST',
    description: 'Sydney winter',
    isReliable: false, // May vary by environment
  },
]

fixtures.forEach((fixture) => {
  test(`timezoneToAbbreviation - ${fixture.description}`, () => {
    const date = new Date(fixture.date)
    const actual = timezoneToAbbreviation(fixture.timezone, date)

    if (fixture.isReliable) {
      // For timezones that reliably return consistent abbreviations
      assert({
        given: `${fixture.description} at ${fixture.date}`,
        should: `return ${fixture.expected}`,
        actual,
        expected: fixture.expected,
      })
    } else {
      // For timezones that may vary by environment, just ensure we get something
      assert({
        given: `${fixture.description} at ${fixture.date}`,
        should: 'return a non-empty abbreviation',
        actual: actual.length > 0,
        expected: true,
      })
    }
  })
})
