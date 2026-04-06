import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const normalizeTestFixtures = [
  {
    name: 'already normalized',
    inputTime: '08:30',
    inputDate: '2025-02-05',
    expected: '2025-02-05 08:30',
    shouldReturnSameInstance: true,
    description: 'A PlainDateTime with normal hours (08:30)',
  },
  {
    name: 'extended hours next day',
    inputTime: '31:11',
    inputDate: '2025-02-05',
    expected: '2025-02-06 07:11',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with 31:11 on Feb 5',
    comment: '31:11 = 1 day + 7:11',
  },
  {
    name: 'extended hours multiple days',
    inputTime: '56:45',
    inputDate: '2025-02-05',
    expected: '2025-02-07 08:45',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with 56:45 on Feb 5',
    comment: '56:45 = 2 days + 8:45',
  },
  {
    name: 'exactly 24 hours',
    inputTime: '24:00',
    inputDate: '2025-02-05',
    expected: '2025-02-06 00:00',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with exactly 24:00',
  },
  {
    name: 'negative hours',
    inputTime: '-1:30',
    inputDate: '2025-02-05',
    expected: '2025-02-04 23:30',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with -1:30 on Feb 5',
    comment: '-1:30 = -1 hour + 30 minutes = 30 minutes before midnight',
  },
  {
    name: 'large negative hours',
    inputTime: '-25:15',
    inputDate: '2025-02-05',
    expected: '2025-02-03 23:15',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with -25:15 on Feb 5',
    comment: '-25:15 = -25 hours + 15 minutes = -24:45 = 45 minutes before midnight on Feb 3',
  },
  {
    name: 'month boundary',
    inputTime: '30:00',
    inputDate: '2025-01-31',
    expected: '2025-02-01 06:00',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with 30:00 on Jan 31',
  },
  {
    name: 'year boundary',
    inputTime: '26:30',
    inputDate: '2024-12-31',
    expected: '2025-01-01 02:30',
    shouldReturnSameInstance: false,
    description: 'PlainDateTime with 26:30 on Dec 31, 2024',
  },
]

// Run tests for each fixture
normalizeTestFixtures.forEach((fixture) => {
  test(`PlainDateTime.normalize() - ${fixture.name}`, () => {
    const dt = new PlainDateTime(fixture.inputTime, fixture.inputDate)
    const normalized = dt.normalize()

    assert({
      given: fixture.description,
      should: `normalize to ${fixture.expected.split(' ')[1]} on ${fixture.expected.split(' ')[0]}`,
      actual: normalized.toString(),
      expected: fixture.expected,
    })

    // Test instance equality if specified
    if (fixture.shouldReturnSameInstance !== undefined) {
      assert({
        given: fixture.description,
        should: fixture.shouldReturnSameInstance ? 'return the same instance for efficiency' : 'return a new instance',
        actual: normalized === dt,
        expected: fixture.shouldReturnSameInstance,
      })
    }
  })
})
