import { assert, test } from '#test'
import timezoneToOffsetString from './timezoneToOffsetString.ts'

const fixtures = [
  {
    timezone: 'Asia/Hong_Kong',
    date: '2024-03-15T12:00:00',
    expected: '+08:00',
    description: 'Hong Kong (UTC+8, no DST)',
  },
  {
    timezone: 'Asia/Tokyo',
    date: '2024-03-15T12:00:00',
    expected: '+09:00',
    description: 'Tokyo (UTC+9, no DST)',
  },
  {
    timezone: 'America/Chicago',
    date: '2024-01-15T12:00:00',
    expected: '-06:00',
    description: 'Chicago winter (CST)',
  },
  {
    timezone: 'America/Chicago',
    date: '2024-07-15T12:00:00',
    expected: '-05:00',
    description: 'Chicago summer (CDT)',
  },
  {
    timezone: 'America/New_York',
    date: '2024-01-15T12:00:00',
    expected: '-05:00',
    description: 'New York winter (EST)',
  },
  {
    timezone: 'America/New_York',
    date: '2024-07-15T12:00:00',
    expected: '-04:00',
    description: 'New York summer (EDT)',
  },
  {
    timezone: 'Europe/London',
    date: '2024-03-15T12:00:00',
    expected: '+00:00',
    description: 'London winter (GMT)',
  },
  {
    timezone: 'Europe/London',
    date: '2024-07-15T12:00:00',
    expected: '+01:00',
    description: 'London summer (BST)',
  },
  {
    timezone: 'UTC',
    date: '2024-03-15T12:00:00',
    expected: '+00:00',
    description: 'UTC timezone',
  },
  {
    timezone: 'Asia/Kolkata',
    date: '2024-03-15T12:00:00',
    expected: '+05:30',
    description: 'India (UTC+5:30)',
  },
  {
    timezone: 'Asia/Kathmandu',
    date: '2024-03-15T12:00:00',
    expected: '+05:45',
    description: 'Nepal (UTC+5:45)',
  },
  {
    timezone: 'America/Phoenix',
    date: '2024-07-15T12:00:00',
    expected: '-07:00',
    description: 'Arizona (no DST)',
  },
  {
    timezone: 'Australia/Sydney',
    date: '2024-12-25T12:00:00',
    expected: '+11:00',
    description: 'Sydney summer (AEDT)',
  },
  {
    timezone: 'Australia/Sydney',
    date: '2024-06-25T12:00:00',
    expected: '+10:00',
    description: 'Sydney winter (AEST)',
  },
]

fixtures.forEach((fixture) => {
  test(`timezoneToOffsetString - ${fixture.description}`, () => {
    const date = new Date(fixture.date)

    assert({
      given: `${fixture.description} at ${fixture.date}`,
      should: `return ${fixture.expected}`,
      actual: timezoneToOffsetString(fixture.timezone, date),
      expected: fixture.expected,
    })
  })
})
