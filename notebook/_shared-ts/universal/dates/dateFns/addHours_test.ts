import { assert, test } from '#test'
import addHours from './addHours.ts'

const fixtures = [
  {
    given: 'Jan 1 2020 00:00, add 1 hour',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 1,
    expected: new Date(2020, 0, 1, 1, 0, 0),
  },
  {
    given: 'Jan 1 2020 00:00, add 1.5 hours',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 1.5,
    expected: new Date(2020, 0, 1, 1, 30, 0),
  },
  {
    given: 'Jan 1 2020 22:30, add 2.25 hours',
    date: new Date(2020, 0, 1, 22, 30, 0),
    hours: 2.25,
    expected: new Date(2020, 0, 2, 0, 45, 0),
  },
  {
    given: 'Jan 2 2020 12:15, add -3 hours',
    date: new Date(2020, 0, 2, 12, 15, 0),
    hours: -3,
    expected: new Date(2020, 0, 2, 9, 15, 0),
  },
  {
    given: 'Fractional quarter hour UTC',
    date: new Date('2020-01-01T00:00:00Z'),
    hours: 0.25,
    expected: new Date('2020-01-01T00:15:00Z'),
  },
  {
    given: 'ISO +02:00 offset, add 5 hours',
    date: new Date('2020-01-01T10:00:00+02:00'),
    hours: 5,
    expected: new Date('2020-01-01T15:00:00+02:00'),
  },
  {
    given: 'ISO -07:00 offset, add 3.5 hours',
    date: new Date('2020-01-01T23:00:00-07:00'),
    hours: 3.5,
    expected: new Date('2020-01-02T02:30:00-07:00'),
  },
  {
    given: 'DST starts (spring forward) US 2020',
    date: new Date('2020-03-08T01:00:00-06:00'),
    hours: 2,
    // 01:00 CST (UTC-6) + 2 real hours = 09:00 UTC = 04:00 CDT (UTC-5)
    expected: new Date('2020-03-08T04:00:00-05:00'),
  },
  {
    given: 'DST ends (fall back) US 2020',
    date: new Date('2020-11-01T01:00:00-04:00'),
    hours: 2,
    // 01:00 EDT (UTC-4) + 2 hours = 07:00 UTC = 02:00 EST (UTC-5)
    expected: new Date('2020-11-01T02:00:00-05:00'),
  },
  {
    given: 'Zero hours (no change)',
    date: new Date(2020, 0, 1, 12, 0, 0),
    hours: 0,
    expected: new Date(2020, 0, 1, 12, 0, 0),
  },
  {
    given: 'Preserves milliseconds',
    date: new Date(2020, 0, 1, 12, 0, 0, 500),
    hours: 1,
    expected: new Date(2020, 0, 1, 13, 0, 0, 500),
  },
  {
    given: 'Month boundary with fewer days (Jan 31 -> Feb)',
    date: new Date(2020, 0, 31, 23, 0, 0),
    hours: 1,
    expected: new Date(2020, 1, 1, 0, 0, 0),
  },
  {
    given: 'Leap year boundary (Feb 28 -> Feb 29)',
    date: new Date(2020, 1, 28, 23, 0, 0),
    hours: 1,
    expected: new Date(2020, 1, 29, 0, 0, 0),
  },
  {
    given: 'Year boundary forward',
    date: new Date(2020, 11, 31, 23, 0, 0),
    hours: 1,
    expected: new Date(2021, 0, 1, 0, 0, 0),
  },
  {
    given: 'Large hour value',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 25,
    expected: new Date(2020, 0, 2, 1, 0, 0),
  },
  {
    given: 'Classic floating point issue: 0.1 hours',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 0.1,
    expected: new Date(2020, 0, 1, 0, 6, 0), // Exactly 6 minutes
  },
  {
    given: 'Repeating decimal: 1/3 hour (20 minutes)',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 1 / 3,
    expected: new Date(2020, 0, 1, 0, 20, 0),
  },
  {
    given: '1⁄3 hour',
    date: new Date('2020-01-01T00:00:00Z'),
    hours: 1 / 3,
    // 1/3 hour = exactly 20 minutes = 1,200,000 ms
    expected: new Date('2020-01-01T00:20:00.000Z'),
  },
  {
    given: 'Repeating decimal: 1/6 hour (10 minutes)',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 1 / 6,
    expected: new Date(2020, 0, 1, 0, 10, 0),
  },
  {
    given: 'Problematic decimal: 0.3 hours (18 minutes)',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 0.3,
    expected: new Date(2020, 0, 1, 0, 18, 0),
  },
  {
    given: 'Very small fraction: 1/3600 hour (1 second)',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 1 / 3600,
    expected: new Date(2020, 0, 1, 0, 0, 1),
  },
  {
    given: 'Accumulated precision: 0.1 + 0.2 hours',
    date: new Date(2020, 0, 1, 0, 0, 0),
    hours: 0.1 + 0.2, // Should be exactly 18 minutes
    expected: new Date(2020, 0, 1, 0, 18, 0),
  },
  {
    given: '1 minute (fractional) crossing midnight',
    date: new Date('2020-01-01T23:59:00Z'),
    hours: 0.016666666667,
    expected: new Date('2020-01-02T00:00:00Z'),
  },
  {
    given: '≈ 3.6 ms (sub-ms edge)',
    date: new Date('2020-01-01T00:00:00.000Z'),
    hours: 0.000001,
    expected: new Date('2020-01-01T00:00:00.003Z'), // rounds 3 ms
  },
]

fixtures.forEach(({ given, date, hours, expected }) => {
  test(addHours.name, () => {
    const actual = addHours(date, hours)
    assert({
      given,
      should: `return a date + ${hours} hours`,
      actual,
      expected,
    })
  })
})
