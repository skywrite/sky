import { renderToStaticMarkup } from 'react-dom/server'
import type { TrackingPoint } from '#lib/tracking/values.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { TrackingChart } from './trackingChart.tsx'

test('tracking charts retain isolated observations in long ranges and render explicit zeroes', () => {
  const points: TrackingPoint[] = Array.from({ length: 365 }, (_, index) => ({
    date: new PlainDate('2030-01-01').addDays(index).ymd,
    value: index === 10 ? 7 : null,
    text: index === 10 ? '7' : null,
    count: index === 10 ? 1 : 0,
  }))
  const sparse = renderToStaticMarkup(TrackingChart({ points, column: { name: 'weight', type: 'number' } }))
  const zero = renderToStaticMarkup(
    TrackingChart({
      points: [{ date: '2030-06-18', value: 0, text: '0', count: 1 }],
      column: { name: 'distance', type: 'number', aggregate: 'sum' },
    }),
  )
  assert({
    given: 'one observation in a year with missing days',
    should: 'draw its point even though the line has no neighboring observations',
    actual: sparse.includes('<circle'),
    expected: true,
  })
  assert({
    given: 'a range containing only explicit zeroes',
    should: 'draw a finite bar instead of an invalid zero-height scale',
    actual: [zero.includes('<rect'), /NaN|Infinity/.test(zero)],
    expected: [true, false],
  })
})
