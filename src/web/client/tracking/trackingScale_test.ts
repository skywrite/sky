import type { TrackingColumn } from '#shared/models/Tracking/mod.ts'
import { assert, test } from '#test'
import { axisDate, barPath, chartScale, pointDate, spreadIndices, tickLabel } from './trackingScale.ts'

const mass: TrackingColumn = { name: 'mass', type: 'number', unit: 'kg' }
const pages: TrackingColumn = { name: 'pages', type: 'number', aggregate: 'sum' }
const hours: TrackingColumn = { name: 'hours', type: 'duration', unit: 'hours' }

test('tracking chart gridlines land on round numbers around the data', () => {
  const zoomed = chartScale(mass, [174.2, 175.1, 176.8], false, true)
  const totals = chartScale(pages, [3, 5, 7], true, true)
  const clock = chartScale(hours, [6.5, 7.25, 8], false, true)
  const zeroes = chartScale(pages, [0], true, true)
  const spark = chartScale(mass, [174.2, 176.8], false, false)
  assert({
    given: 'a narrow band of readings',
    should: 'zoom to whole-number gridlines that still enclose every reading',
    actual: [
      zoomed.ticks.every(Number.isInteger),
      zoomed.low <= 174.2 && zoomed.high >= 176.8,
      zoomed.ticks.length >= 3 && zoomed.ticks.length <= 8,
    ],
    expected: [true, true, true],
  })
  assert({
    given: 'daily totals',
    should: 'grow from a zero baseline in even steps',
    actual: totals.ticks,
    expected: [0, 2, 4, 6, 8],
  })
  assert({
    given: 'a duration in hours',
    should: 'step by the half hour and label like a clock',
    actual: [clock.ticks.map((tick) => tickLabel(hours, tick, false)).slice(0, 3), clock.ticks.includes(6.5)],
    expected: [['6h', '6h 30m', '7h'], true],
  })
  assert({
    given: 'nothing but explicit zeroes',
    should: 'still produce a finite scale with room above the baseline',
    actual: [Number.isFinite(zeroes.high), zeroes.high > zeroes.low, zeroes.ticks[0]],
    expected: [true, true, 0],
  })
  assert({
    given: 'a sparkline',
    should: 'skip gridlines and hug the data',
    actual: [spark.ticks, spark.high - spark.low < 4],
    expected: [[], true],
  })
})

test('tracking chart labels stay short and read as dates', () => {
  assert({
    given: 'gridline values with a unit',
    should: 'show the unit only where asked and compact thousands',
    actual: [tickLabel(mass, 180, true), tickLabel(mass, 175, false), tickLabel(pages, 12000, false)],
    expected: ['180 kg', '175', '12K'],
  })
  assert({
    given: 'axis and readout dates',
    should: 'read as calendar dates with the year only when it matters',
    actual: [axisDate('2026-09-05', false), axisDate('2025-12-31', true), pointDate('2030-06-10')],
    expected: ['Sep 5', 'Dec 31, 2025', 'Mon, Jun 10, 2030'],
  })
})

test('tracking chart geometry helpers spread ticks and keep bars finite', () => {
  const spread = spreadIndices(100, 5)
  const flat = barPath(10, 8, 100, 100, 4)
  assert({
    given: 'five axis slots over a hundred days',
    should: 'include both ends and climb without repeats',
    actual: [spread[0], spread.at(-1), spread.length, spread.every((index, at) => at === 0 || index > spread[at - 1]!)],
    expected: [0, 99, 5, true],
  })
  assert({
    given: 'a bar with no height',
    should: 'draw a one-pixel foot instead of nothing or NaN',
    actual: [/NaN|Infinity/.test(flat), flat.includes(' 99')],
    expected: [false, true],
  })
})
