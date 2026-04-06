import { assert, test } from '#test'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

const hoursBetweenFixtures = [
  {
    name: 'same time same timezone',
    start: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    expected: 0,
    description: 'Same time in same timezone',
  },
  {
    name: 'one hour apart same timezone',
    start: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 09:00', timezone: 'America/Chicago' },
    expected: 1,
    description: 'Two times 1 hour apart in same timezone',
  },
  {
    name: 'half hour apart same timezone',
    start: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 08:30', timezone: 'America/Chicago' },
    expected: 0.5,
    description: 'Two times 30 minutes apart in same timezone',
  },
  {
    name: '23 hours next day',
    start: { datetime: '2025-02-05 08:11', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-06 07:11', timezone: 'America/Chicago' },
    expected: 23,
    description: 'Start at 08:11, end at 07:11 next day',
  },
  {
    name: '25 hours next day',
    start: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-06 09:00', timezone: 'America/Chicago' },
    expected: 25,
    description: 'Start at 08:00, end at 09:00 next day',
  },
  {
    name: 'negative hours when end is before',
    start: { datetime: '2025-02-05 10:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    expected: -2,
    description: 'Later time compared to earlier time',
  },
  {
    name: 'cross week boundary',
    start: { datetime: '2025-02-07 22:00', timezone: 'America/Chicago' }, // Friday night
    end: { datetime: '2025-02-10 06:00', timezone: 'America/Chicago' }, // Monday morning
    expected: 56, // 2 days + 8 hours
    description: 'Friday 22:00 to Monday 06:00',
  },
  {
    name: 'cross month boundary',
    start: { datetime: '2025-01-31 20:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-01 04:00', timezone: 'America/Chicago' },
    expected: 8,
    description: 'Last day of Jan 20:00 to first day of Feb 04:00',
  },
  {
    name: 'cross year boundary',
    start: { datetime: '2024-12-31 22:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-01-01 06:00', timezone: 'America/Chicago' },
    expected: 8,
    description: 'New Years Eve 22:00 to New Years Day 06:00',
  },
  {
    name: 'different timezones same instant',
    start: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 09:00', timezone: 'America/New_York' },
    expected: 0,
    description: 'Chicago 08:00 and New York 09:00 (same instant)',
    comment: 'NY is 1 hour ahead of Chicago',
  },
  {
    name: 'different timezones actual difference',
    start: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 08:00', timezone: 'America/New_York' },
    expected: -1,
    description: 'Chicago 08:00 to New York 08:00',
    comment: 'NY 08:00 is 1 hour before Chicago 08:00',
  },
  {
    name: 'LA to NYC same wall time',
    start: { datetime: '2025-02-05 12:00', timezone: 'America/Los_Angeles' },
    end: { datetime: '2025-02-05 12:00', timezone: 'America/New_York' },
    expected: -3,
    description: 'LA noon to NYC noon',
    comment: 'NYC noon happens 3 hours before LA noon',
  },
  {
    name: 'UTC to Chicago',
    start: { datetime: '2025-02-05 14:00', timezone: 'UTC' },
    end: { datetime: '2025-02-05 08:00', timezone: 'America/Chicago' },
    expected: 0,
    description: 'UTC 14:00 to Chicago 08:00',
    comment: 'Chicago is UTC-6 in winter, so 14:00 UTC = 08:00 Chicago',
  },
  {
    name: 'with extended hours created by addHours',
    start: { datetime: '2025-02-05 08:11', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 31:11', timezone: 'America/Chicago' }, // Extended hours
    expected: 23,
    description: 'Start at 08:11, end at 31:11 (extended hours)',
    comment: '31:11 represents 07:11 next day',
  },
  {
    name: 'fractional hours',
    start: { datetime: '2025-02-05 08:15', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 10:45', timezone: 'America/Chicago' },
    expected: 2.5,
    description: 'From 08:15 to 10:45',
  },
  {
    name: 'precise fractional hours',
    start: { datetime: '2025-02-05 09:20', timezone: 'America/Chicago' },
    end: { datetime: '2025-02-05 11:50', timezone: 'America/Chicago' },
    expected: 2.5,
    description: 'From 09:20 to 11:50 (2 hours 30 minutes)',
  },
]

// Test using fixture data
hoursBetweenFixtures.forEach((fixture) => {
  test(`ZonedDateTime.hoursBetween - ${fixture.name}`, () => {
    const start = new ZonedDateTime(fixture.start.datetime, fixture.start.timezone)
    const end = new ZonedDateTime(fixture.end.datetime, fixture.end.timezone)

    assert({
      given: fixture.description,
      should: `return ${fixture.expected} hours`,
      actual: start.hoursBetween(end),
      expected: fixture.expected,
    })
  })
})

// Additional test for using addHours to create extended hours
test('ZonedDateTime.hoursBetween - with dynamically created extended hours', () => {
  const start = new ZonedDateTime('2025-02-05 08:11', 'America/Chicago')
  const endExtended = start.addHours(23)

  assert({
    given: 'Start at 08:11, add 23 hours dynamically',
    should: 'calculate 23 hours correctly',
    actual: start.hoursBetween(endExtended),
    expected: 23,
  })

  // Verify the extended hours were created
  assert({
    given: 'End time created by adding 23 hours',
    should: 'have time of 31:11 (extended hours)',
    actual: endExtended.time,
    expected: '31:11',
  })
})
