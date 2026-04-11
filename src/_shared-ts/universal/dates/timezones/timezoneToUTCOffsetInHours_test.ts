import { assert, test } from '#test'
import timezoneToUTCOffsetInHours from './timezoneToUTCOffsetInHours.ts'

test('timezoneToUTCOffsetInHours - UTC', () => {
  const offset = timezoneToUTCOffsetInHours('UTC')

  assert({
    given: 'UTC timezone',
    should: 'return 0 offset',
    actual: offset,
    expected: 0,
  })
})

test('timezoneToUTCOffsetInHours - US timezones', () => {
  // Use a fixed date to avoid DST variations in tests
  const winterDate = new Date('2024-01-15T12:00:00Z') // January = Standard Time
  const summerDate = new Date('2024-07-15T12:00:00Z') // July = Daylight Time

  const laWinter = timezoneToUTCOffsetInHours('America/Los_Angeles', winterDate)
  const laSummer = timezoneToUTCOffsetInHours('America/Los_Angeles', summerDate)

  assert({
    given: 'LA in winter (PST)',
    should: 'return -8',
    actual: laWinter,
    expected: -8,
  })

  assert({
    given: 'LA in summer (PDT)',
    should: 'return -7',
    actual: laSummer,
    expected: -7,
  })

  const nyWinter = timezoneToUTCOffsetInHours('America/New_York', winterDate)
  const nySummer = timezoneToUTCOffsetInHours('America/New_York', summerDate)

  assert({
    given: 'NY in winter (EST)',
    should: 'return -5',
    actual: nyWinter,
    expected: -5,
  })

  assert({
    given: 'NY in summer (EDT)',
    should: 'return -4',
    actual: nySummer,
    expected: -4,
  })
})

test('timezoneToUTCOffsetInHours - Asian timezones', () => {
  // Most Asian timezones don't observe DST
  const date = new Date('2024-03-15T12:00:00Z')

  const hk = timezoneToUTCOffsetInHours('Asia/Hong_Kong', date)
  const tokyo = timezoneToUTCOffsetInHours('Asia/Tokyo', date)
  const singapore = timezoneToUTCOffsetInHours('Asia/Singapore', date)

  assert({
    given: 'Hong Kong timezone',
    should: 'return +8',
    actual: hk,
    expected: 8,
  })

  assert({
    given: 'Tokyo timezone',
    should: 'return +9',
    actual: tokyo,
    expected: 9,
  })

  assert({
    given: 'Singapore timezone',
    should: 'return +8',
    actual: singapore,
    expected: 8,
  })
})

test('timezoneToUTCOffsetInHours - European timezones', () => {
  const winterDate = new Date('2024-01-15T12:00:00Z')
  const summerDate = new Date('2024-07-15T12:00:00Z')

  const londonWinter = timezoneToUTCOffsetInHours('Europe/London', winterDate)
  const londonSummer = timezoneToUTCOffsetInHours('Europe/London', summerDate)

  assert({
    given: 'London in winter (GMT)',
    should: 'return 0',
    actual: londonWinter,
    expected: 0,
  })

  assert({
    given: 'London in summer (BST)',
    should: 'return +1',
    actual: londonSummer,
    expected: 1,
  })

  const parisWinter = timezoneToUTCOffsetInHours('Europe/Paris', winterDate)
  const parisSummer = timezoneToUTCOffsetInHours('Europe/Paris', summerDate)

  assert({
    given: 'Paris in winter (CET)',
    should: 'return +1',
    actual: parisWinter,
    expected: 1,
  })

  assert({
    given: 'Paris in summer (CEST)',
    should: 'return +2',
    actual: parisSummer,
    expected: 2,
  })
})
