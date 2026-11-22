import { assert, test } from '#test'
import { chartRange } from './chartGeometry.ts'

test('chartRange: round gridlines that hold every value drawn', () => {
  assert({
    given: 'long runs from 6 to 14 miles with a target of 26.2, a single value, and small decimals',
    should: 'widen each range to round numbers that hold the values, with gridlines on round steps',
    actual: [chartRange([6, 14, 26.2]), chartRange([14]), chartRange([0.2, 0.9])],
    expected: [
      { low: 0, high: 30, ticks: [0, 5, 10, 15, 20, 25, 30] },
      { low: 13.5, high: 14.5, ticks: [13.5, 14, 14.5] },
      { low: 0, high: 1, ticks: [0, 0.2, 0.4, 0.6, 0.8, 1] },
    ],
  })
})
