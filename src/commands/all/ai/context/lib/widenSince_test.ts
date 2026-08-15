import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { resolveWindow } from './widenSince.ts'

const today = PlainDate.from('2026-08-15')

test('resolveWindow leaves a covering window alone', () => {
  assert({
    given: 'a 7d window and a date from yesterday',
    should: 'return the window unchanged',
    expected: '7d',
    actual: resolveWindow('7d', '', ['2026-08-14'], today).since,
  })

  assert({
    given: 'a date exactly at the window edge (30 days back, 30d window)',
    should: 'stay unchanged — the recent cutoff is inclusive',
    expected: '30d',
    actual: resolveWindow('30d', '', ['2026-07-16'], today).since,
  })
})

test('resolveWindow widens a window that misses a stated date', () => {
  const result = resolveWindow('1y', '', ['2025-03-01'], today)

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

test('resolveWindow covers the earliest of several dates', () => {
  assert({
    given: 'a 30d window and dates 14 and 532 days back',
    should: 'widen to reach the earliest',
    expected: '533d',
    actual: resolveWindow('30d', '', ['2026-08-01', '2025-03-01'], today).since,
  })
})

test('resolveWindow counts days through leap years exactly', () => {
  assert({
    given: 'a window measured across the 2024 leap day',
    should: 'widen using the true civil-day count',
    expected: '733d',
    actual: resolveWindow('1y', '', ['2024-02-28'], PlainDate.from('2026-03-01')).since,
  })
})

test('resolveWindow treats dates as a floor, never a ceiling', () => {
  assert({
    given: 'no stated timeframe (all history) and an old date',
    should: 'stay all-history rather than shrink to the date',
    expected: '',
    actual: resolveWindow('', '', ['2025-03-01'], today).since,
  })
})

test('resolveWindow ignores dates that are not lookbacks', () => {
  assert({
    given: 'a future date (a planning horizon)',
    should: 'leave the window unchanged',
    expected: '30d',
    actual: resolveWindow('30d', '', ['2026-12-01'], today).since,
  })

  assert({
    given: 'an unparseable date string',
    should: 'skip it and leave the window unchanged',
    expected: '30d',
    actual: resolveWindow('30d', '', ['soon'], today).since,
  })
})

test('resolveWindow drops an unparseable duration to all-history', () => {
  const result = resolveWindow('18months', '', ['2026-08-14'], today)

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

test('resolveWindow honors a stated end alongside a widened start', () => {
  const result = resolveWindow('90d', '2026-06-01', ['2026-03-15', '2026-06-01'], today)

  assert({
    given: 'a closed range (mid-March through June 1) whose 90d start lands short',
    should: 'widen the start to cover the earliest date',
    expected: '154d',
    actual: result.since,
  })

  assert({
    given: 'the stated end',
    should: 'pass through untouched',
    expected: '2026-06-01',
    actual: result.until,
  })
})

test('resolveWindow extends a stated end that a stated date falls beyond', () => {
  const result = resolveWindow('1y', '2026-04-10', ['2026-06-20'], today)

  assert({
    given: 'an end of April 10 and a stated past date of June 20',
    should: 'extend the end to cover it — dates are a floor for the whole window',
    expected: '2026-06-20',
    actual: result.until,
  })

  assert({
    given: 'the extension',
    should: 'name the date it extended to cover',
    expected: '2026-06-20',
    actual: result.extendedToCover,
  })
})

test('resolveWindow drops an end that is not a real past date', () => {
  assert({
    given: 'a future end (a planning horizon)',
    should: 'run the window to now instead',
    expected: '',
    actual: resolveWindow('30d', '2026-12-01', [], today).until,
  })

  assert({
    given: 'an unparseable end',
    should: 'run the window to now instead',
    expected: '',
    actual: resolveWindow('30d', 'someday', [], today).until,
  })
})

test('resolveWindow allows a stated end with no stated start', () => {
  const result = resolveWindow('', '2026-04-10', ['2026-04-10'], today)

  assert({
    given: 'everything up to April 10, no lookback stated',
    should: 'keep the start open (all history)',
    expected: '',
    actual: result.since,
  })

  assert({
    given: 'the same resolution',
    should: 'keep the stated end',
    expected: '2026-04-10',
    actual: result.until,
  })
})
