import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { resolveWindow, type WindowInput } from './widenSince.ts'

const today = PlainDate.from('2026-08-15')
const win = (input: Partial<WindowInput>) =>
  resolveWindow({ since: '', from: '', until: '', dates: [], today, ...input })

test('resolveWindow leaves a covering window alone', () => {
  assert({
    given: 'a 7d window and a date from yesterday',
    should: 'return the window unchanged',
    expected: '7d',
    actual: win({ since: '7d', dates: ['2026-08-14'] }).since,
  })

  assert({
    given: 'a date exactly at the window edge (30 days back, 30d window)',
    should: 'stay unchanged — the recent cutoff is inclusive',
    expected: '30d',
    actual: win({ since: '30d', dates: ['2026-07-16'] }).since,
  })
})

test('resolveWindow widens a window that misses a stated date', () => {
  const result = win({ since: '1y', dates: ['2025-03-01'] })

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
    actual: win({ since: '30d', dates: ['2026-08-01', '2025-03-01'] }).since,
  })
})

test('resolveWindow counts days through leap years exactly', () => {
  assert({
    given: 'a window measured across the 2024 leap day',
    should: 'widen using the true civil-day count',
    expected: '733d',
    actual: resolveWindow({
      since: '1y',
      from: '',
      until: '',
      dates: ['2024-02-28'],
      today: PlainDate.from('2026-03-01'),
    }).since,
  })
})

test('resolveWindow treats dates as a floor, never a ceiling', () => {
  assert({
    given: 'no stated timeframe (all history) and an old date',
    should: 'stay all-history rather than shrink to the date',
    expected: '',
    actual: win({ dates: ['2025-03-01'] }).since,
  })
})

test('resolveWindow ignores dates that are not lookbacks', () => {
  assert({
    given: 'a future date (a planning horizon)',
    should: 'leave the window unchanged',
    expected: '30d',
    actual: win({ since: '30d', dates: ['2026-12-01'] }).since,
  })

  assert({
    given: 'an unparseable date string',
    should: 'skip it and leave the window unchanged',
    expected: '30d',
    actual: win({ since: '30d', dates: ['soon'] }).since,
  })
})

test('resolveWindow drops an unparseable duration to all-history', () => {
  const result = win({ since: '18months', dates: ['2026-08-14'] })

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
  const result = win({ since: '90d', until: '2026-06-01', dates: ['2026-03-15', '2026-06-01'] })

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

  assert({
    given: 'a range without a stated from',
    should: 'derive the exact start from the widened duration',
    expected: '2026-03-14',
    actual: result.start,
  })
})

test('resolveWindow extends a stated end that a stated date falls beyond', () => {
  const result = win({ since: '1y', until: '2026-04-10', dates: ['2026-06-20'] })

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
    actual: win({ since: '30d', until: '2026-12-01' }).until,
  })

  assert({
    given: 'an unparseable end',
    should: 'run the window to now instead',
    expected: '',
    actual: win({ since: '30d', until: 'someday' }).until,
  })
})

test('resolveWindow allows a stated end with no stated start', () => {
  const result = win({ until: '2026-04-10', dates: ['2026-04-10'] })

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

test('resolveWindow uses a stated from as the exact range start', () => {
  const result = win({
    since: '4y',
    from: '2023-01-01',
    until: '2023-12-31',
    dates: ['2023-01-01', '2023-12-31'],
  })

  assert({
    given: 'a stated year range with an over-generous duration guess (4y)',
    should: 'start the range at the stated date, not today − 4y',
    expected: { start: '2023-01-01', until: '2023-12-31', since: '4y' },
    actual: { start: result.start, until: result.until, since: result.since },
  })
})

test('resolveWindow counts a stated from toward the coverage floor', () => {
  const result = win({ since: '30d', from: '2026-03-15', until: '2026-06-01' })

  assert({
    given: 'a from the 30d duration cannot reach',
    should: 'widen the duration and start the range exactly at the stated from',
    expected: { since: '154d', start: '2026-03-15' },
    actual: { since: result.since, start: result.start },
  })
})

test('resolveWindow widens the range start to a stated date before the from', () => {
  assert({
    given: 'a from of June 2023 and a mentioned date the previous March',
    should: 'start the range at the earlier date — floors apply to the start too',
    expected: '2023-03-01',
    actual: win({ since: '4y', from: '2023-06-01', until: '2023-12-31', dates: ['2023-03-01'] }).start,
  })
})

test('resolveWindow ignores a from that is not a usable start', () => {
  assert({
    given: 'a future from',
    should: 'fall back to the duration-derived start',
    expected: '2026-07-16',
    actual: win({ since: '30d', from: '2026-12-01', until: '2026-08-01' }).start,
  })

  assert({
    given: 'a contradictory extraction (from after the end)',
    should: 'resolve by the floor — extend the end to cover the stated from, never drop it',
    expected: { start: '2026-08-10', until: '2026-08-10' },
    actual: (() => {
      const r = win({ since: '30d', from: '2026-08-10', until: '2026-08-01' })
      return { start: r.start, until: r.until }
    })(),
  })

  assert({
    given: 'a from with no end in effect',
    should: 'resolve no range start (trailing mode), only duration coverage',
    expected: { start: undefined, since: '46d' },
    actual: (() => {
      const r = win({ since: '7d', from: '2026-07-01' })
      return { start: r.start, since: r.since }
    })(),
  })
})
