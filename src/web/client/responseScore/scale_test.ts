import { assert, test } from '#test'
import { axisStep } from './scale.ts'

test('axisStep picks a round gridline gap that fits the tallest day', () => {
  assert({
    given: 'an empty chart, ordinary days, a 30-reply day, and a peak beyond the list',
    should: 'keep four round steps at or above the peak',
    actual: [0, 100, 260, 1160, 3000, 3001, 90_000].map(axisStep),
    expected: [25, 25, 100, 300, 750, 1000, 25_000],
  })
})
