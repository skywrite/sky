import { assert, test } from '#test'
import type { Tracker, TrackingEntry } from './types.ts'
import {
  formatTrackingValue,
  isTrackingDay,
  normalizeTrackingValue,
  trackingSeries,
  trackingSummary,
} from './values.ts'

test('tracking durations use the declared unit and support clock-style entries', () => {
  const duration = { name: 'duration', type: 'duration' as const, unit: 'min' }
  assert({
    given: 'minutes, hours, seconds, and extended wall-clock times',
    should: 'preserve their distinct meanings',
    actual: [
      normalizeTrackingValue(duration, '1h 30m'),
      normalizeTrackingValue({ ...duration, unit: 'hr' }, '7:45'),
      normalizeTrackingValue({ ...duration, unit: 'sec' }, '2m'),
      formatTrackingValue(duration, '90'),
      formatTrackingValue({ ...duration, unit: 'sec' }, '30'),
      formatTrackingValue(duration, '0.5'),
      normalizeTrackingValue({ name: 'at', type: 'time' }, '25:30'),
    ],
    expected: ['90', '7.75', '120', '1h 30m', '30s', '30s', '25:30'],
  })
})

test('tracking aggregates observations without inventing zeroes for missing or unknown data', () => {
  const entries = [
    ['2030-06-17', '2'],
    ['2030-06-17', '3'],
    ['2030-06-18', ''],
    ['2030-06-19', '0'],
    ['2030-06-20', '?'],
  ].map(
    ([date, value], at): TrackingEntry => ({
      id: String(at),
      date,
      values: { value },
      source: 'data/tracking/2030/sample.csv',
    }),
  )
  const column = { name: 'value', type: 'number' as const, aggregate: 'sum' as const }
  const series = trackingSeries(entries, column, '2030-06-17', '2030-06-21')
  assert({
    given: 'repeated entries, an explicit zero, blanks, and placeholders',
    should: 'sum only real values and keep gaps',
    actual: series.map((p) => p.value),
    expected: [5, null, 0, null, null],
  })
  assert({
    given: 'a summary over a sparse range',
    should: 'retain the cumulative total and average recorded days, including explicit zeroes',
    actual: [trackingSummary(series, column).value, trackingSummary(series, column).average],
    expected: ['5', '2.5'],
  })
  assert({
    given: 'other aggregation choices',
    should: 'apply daily last, mean, and collect semantics',
    actual: ['last', 'mean', 'collect'].map(
      (aggregate) =>
        trackingSeries(
          entries,
          { ...column, aggregate: aggregate as 'last' | 'mean' | 'collect' },
          '2030-06-17',
          '2030-06-17',
        )[0].text,
    ),
    expected: ['3', '2.5', '2 · 3'],
  })
})

test('tracking prompts respect start, end, and weekdays', () => {
  const tracker = { start: '2030-06-17', end: '2030-06-24', schedule: 'weekdays' } as Tracker
  assert({
    given: 'a weekday tracker with inclusive dates',
    should: 'skip weekends and dates outside its life',
    actual: ['2030-06-16', '2030-06-17', '2030-06-22', '2030-06-24', '2030-06-25'].map((day) =>
      isTrackingDay(tracker, day),
    ),
    expected: [false, true, false, true, false],
  })
  assert({
    given: 'manual tracking',
    should: 'never create a missing check-in',
    actual: isTrackingDay({ ...tracker, schedule: 'manual' }, '2030-06-18'),
    expected: false,
  })
})

test('sleep averages use recorded days across the selected period', () => {
  const column = { name: 'duration', type: 'duration' as const, unit: 'hr', aggregate: 'mean' as const }
  const entries = [
    { id: 'first', date: '2030-06-17', values: { duration: '6.5' }, source: 'data/tracking/2030/sleep.csv' },
    { id: 'second', date: '2030-06-19', values: { duration: '8' }, source: 'data/tracking/2030/sleep.csv' },
  ]
  const summary = trackingSummary(trackingSeries(entries, column, '2030-06-01', '2030-06-30'), column)
  assert({
    given: 'two recorded nights in a month with otherwise missing entries',
    should: 'show the average sleep duration without treating gaps as sleepless nights',
    actual: [summary.label, formatTrackingValue(column, summary.value), summary.days],
    expected: ['Daily average', '7h 15m', 2],
  })
})
