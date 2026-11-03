import { assert, test } from '#test'
import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import findWakeCutoff, { findWakeStart } from './wakeGap.ts'

const DAY = PlainDate.from('2026-02-08')

function instants(...iso: string[]): Instant[] {
  return iso.map((s) => Instant.from(s))
}

test('findWakeCutoff ends the day at a sleep gap resuming next morning', () => {
  const cutoff = findWakeCutoff(
    // Work until 01:20 next calendar day (25:20), sleep, resume 04:38
    instants('2026-02-08T21:00:00Z', '2026-02-09T01:20:00Z', '2026-02-09T04:38:00Z', '2026-02-09T06:00:00Z'),
    DAY,
    'UTC',
  )

  assert({
    given: 'a 3.3h silence resuming at 04:38 the next day',
    should: 'cut at the last instant before the gap',
    expected: '2026-02-09T01:20:00.000Z',
    actual: cutoff?.toString({ smallestUnit: 'millisecond' }),
  })
})

test('findWakeCutoff keeps late-night work after a long evening break', () => {
  const cutoff = findWakeCutoff(
    // Dinner break 20:00 → 00:30, then a midnight session: still the same day
    instants('2026-02-08T20:00:00Z', '2026-02-09T00:30:00Z', '2026-02-09T01:45:00Z'),
    DAY,
    'UTC',
  )

  assert({
    given: 'a 4.5h evening break resuming at 00:30',
    should: 'not treat it as a day boundary',
    expected: null,
    actual: cutoff,
  })
})

test('findWakeCutoff ignores same-day afternoon gaps', () => {
  const cutoff = findWakeCutoff(
    instants('2026-02-08T09:00:00Z', '2026-02-08T13:00:00Z', '2026-02-08T18:00:00Z'),
    DAY,
    'UTC',
  )

  assert({
    given: 'a 5h afternoon gap resuming the same day',
    should: 'not treat it as a day boundary',
    expected: null,
    actual: cutoff,
  })
})

test('findWakeCutoff returns null for continuous activity', () => {
  const cutoff = findWakeCutoff(
    instants('2026-02-08T09:00:00Z', '2026-02-08T11:00:00Z', '2026-02-09T01:30:00Z'),
    DAY,
    'UTC',
  )

  assert({
    given: 'no qualifying gap',
    should: 'return null',
    expected: null,
    actual: cutoff,
  })
})

test('findWakeStart opens the day at a pre-ceremony wake resumption', () => {
  const ceremony = Instant.from('2026-02-09T08:21:00Z')
  const day9 = PlainDate.from('2026-02-09')
  const start = findWakeStart(
    // Previous night until 01:20, sleep, resume 04:38 — before the 08:21 ceremony
    instants('2026-02-08T21:00:00Z', '2026-02-09T01:20:00Z', '2026-02-09T04:38:00Z', '2026-02-09T06:00:00Z'),
    day9,
    'UTC',
    ceremony,
  )

  assert({
    given: 'a wake gap resuming at 04:38 before the 08:21 day:start',
    should: 'open the day at the resumption',
    expected: '2026-02-09T04:38:00.000Z',
    actual: start?.toString({ smallestUnit: 'millisecond' }),
  })
})

test('findWakeStart returns null without a qualifying pre-ceremony gap', () => {
  const day9 = PlainDate.from('2026-02-09')
  const start = findWakeStart(
    instants('2026-02-09T05:00:00Z', '2026-02-09T06:00:00Z'),
    day9,
    'UTC',
    Instant.from('2026-02-09T04:30:00Z'),
  )

  assert({
    given: 'continuous activity starting after the ceremony',
    should: 'keep the ceremony start',
    expected: null,
    actual: start,
  })
})

test('findWakeStart opens the day at a lone morning signal before the ceremony', () => {
  const day9 = PlainDate.from('2026-02-09')
  const start = findWakeStart(
    // Nothing in the lookback, then a 07:02 session before the 09:04 day:start
    instants('2026-02-09T07:02:00Z', '2026-02-09T07:30:00Z'),
    day9,
    'UTC',
    Instant.from('2026-02-09T09:04:00Z'),
  )

  assert({
    given: "the scan's first signal on the day's own morning, before the ceremony",
    should: 'open the day there',
    expected: '2026-02-09T07:02:00.000Z',
    actual: start?.toString({ smallestUnit: 'millisecond' }),
  })
})

test('findWakeStart leaves a lone late-night signal to the previous day', () => {
  const day9 = PlainDate.from('2026-02-09')
  const start = findWakeStart(instants('2026-02-09T01:00:00Z'), day9, 'UTC', Instant.from('2026-02-09T09:04:00Z'))

  assert({
    given: 'one 01:00 signal before the ceremony',
    should: 'keep the ceremony start',
    expected: null,
    actual: start,
  })
})

test('findWakeCutoff ends a quiet day where it began when its only signals are the next morning', () => {
  const cutoff = findWakeCutoff(instants('2026-02-09T07:02:00Z'), DAY, 'UTC', Instant.from('2026-02-08T09:04:00Z'))

  assert({
    given: "the day's start and one signal the next morning",
    should: 'cut at the start, claiming nothing',
    expected: '2026-02-08T09:04:00.000Z',
    actual: cutoff?.toString({ smallestUnit: 'millisecond' }),
  })
})

test("findWakeCutoff with the day's start still ends at the last signal before the wake gap", () => {
  const cutoff = findWakeCutoff(
    instants('2026-02-08T10:00:00Z', '2026-02-09T07:02:00Z'),
    DAY,
    'UTC',
    Instant.from('2026-02-08T09:04:00Z'),
  )

  assert({
    given: "a signal within three hours of the start, then the next morning's",
    should: "cut at the day's own last signal",
    expected: '2026-02-08T10:00:00.000Z',
    actual: cutoff?.toString({ smallestUnit: 'millisecond' }),
  })
})
