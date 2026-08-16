import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import findWakeCutoff, { findWakeStart } from './wakeGap.ts'

const DAY = PlainDate.from('2026-02-08')

function instants(...iso: string[]): Date[] {
  return iso.map((s) => new Date(s))
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
    actual: cutoff?.toISOString(),
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
  const ceremony = new Date('2026-02-09T08:21:00Z')
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
    actual: start?.toISOString(),
  })
})

test('findWakeStart returns null without a qualifying pre-ceremony gap', () => {
  const day9 = PlainDate.from('2026-02-09')
  const start = findWakeStart(
    instants('2026-02-09T05:00:00Z', '2026-02-09T06:00:00Z'),
    day9,
    'UTC',
    new Date('2026-02-09T04:30:00Z'),
  )

  assert({
    given: 'continuous activity starting after the ceremony',
    should: 'keep the ceremony start',
    expected: null,
    actual: start,
  })
})
