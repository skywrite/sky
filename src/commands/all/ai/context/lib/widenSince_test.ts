import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { widenSinceToCoverDates } from './widenSince.ts'

const today = PlainDate.from('2026-08-15')

test('widenSinceToCoverDates leaves a covering window alone', () => {
  assert({
    given: 'a 7d window and a date from yesterday',
    should: 'return the window unchanged',
    expected: '7d',
    actual: widenSinceToCoverDates('7d', ['2026-08-14'], today).since,
  })

  assert({
    given: 'a date exactly at the window edge (30 days back, 30d window)',
    should: 'stay unchanged — the recent cutoff is inclusive',
    expected: '30d',
    actual: widenSinceToCoverDates('30d', ['2026-07-16'], today).since,
  })
})

test('widenSinceToCoverDates widens a window that misses a stated date', () => {
  const result = widenSinceToCoverDates('1y', ['2025-03-01'], today)

  assert({
    given: 'a 1y window and a stated date 532 days back',
    should: 'widen to the exact gap plus a one-day cushion',
    expected: '533d',
    actual: result.since,
  })

  assert({
    given: 'the widened result',
    should: 'name the date it widened to cover',
    expected: '2025-03-01',
    actual: result.widenedToCover,
  })
})

test('widenSinceToCoverDates covers the earliest of several dates', () => {
  assert({
    given: 'a 30d window and dates 14 and 532 days back',
    should: 'widen to reach the earliest',
    expected: '533d',
    actual: widenSinceToCoverDates('30d', ['2026-08-01', '2025-03-01'], today).since,
  })
})

test('widenSinceToCoverDates counts days through leap years exactly', () => {
  assert({
    given: 'a window measured across the 2024 leap day',
    should: 'widen using the true civil-day count',
    expected: '733d',
    actual: widenSinceToCoverDates('1y', ['2024-02-28'], PlainDate.from('2026-03-01')).since,
  })
})

test('widenSinceToCoverDates treats dates as a floor, never a ceiling', () => {
  assert({
    given: 'no stated timeframe (all history) and an old date',
    should: 'stay all-history rather than shrink to the date',
    expected: '',
    actual: widenSinceToCoverDates('', ['2025-03-01'], today).since,
  })
})

test('widenSinceToCoverDates ignores dates that are not lookbacks', () => {
  assert({
    given: 'a future date (a planning horizon)',
    should: 'leave the window unchanged',
    expected: '30d',
    actual: widenSinceToCoverDates('30d', ['2026-12-01'], today).since,
  })

  assert({
    given: 'an unparseable date string',
    should: 'skip it and leave the window unchanged',
    expected: '30d',
    actual: widenSinceToCoverDates('30d', ['soon'], today).since,
  })
})

test('widenSinceToCoverDates drops an unparseable duration to all-history', () => {
  const result = widenSinceToCoverDates('18months', ['2026-08-14'], today)

  assert({
    given: 'a duration the query executor cannot parse',
    should: 'fall back to all-history instead of deriving a window from the dates',
    expected: '',
    actual: result.since,
  })

  assert({
    given: 'the dropped duration',
    should: 'be reported for logging',
    expected: '18months',
    actual: result.droppedInvalid,
  })
})
