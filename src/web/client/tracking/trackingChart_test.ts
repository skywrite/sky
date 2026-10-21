import { createElement } from 'react'
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
  const sparse = renderToStaticMarkup(
    createElement(TrackingChart, { points, column: { name: 'steps', type: 'number' } }),
  )
  const zero = renderToStaticMarkup(
    createElement(TrackingChart, {
      points: [{ date: '2030-06-18', value: 0, text: '0', count: 1 }],
      column: { name: 'pages', type: 'number', aggregate: 'sum' },
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
    actual: [zero.includes('sky-tracking-bar'), /NaN|Infinity/.test(zero)],
    expected: [true, false],
  })
})

test('tracking charts label the axes in words and round numbers', () => {
  const points: TrackingPoint[] = Array.from({ length: 30 }, (_, index) => ({
    date: new PlainDate('2030-03-01').addDays(index).ymd,
    value: 174 + (index % 5) * 0.6,
    text: String(174 + (index % 5) * 0.6),
    count: 1,
  }))
  const html = renderToStaticMarkup(
    createElement(TrackingChart, { points, column: { name: 'mass', type: 'number', unit: 'kg' } }),
  )
  const sparkline = renderToStaticMarkup(
    createElement(TrackingChart, { points, column: { name: 'mass', type: 'number', unit: 'kg' }, compact: true }),
  )
  const labels = [...html.matchAll(/class="sky-tracking-axis"[^>]*>([^<]*)</g)].map((match) => match[1])
  assert({
    given: 'a month of readings',
    should: 'print calendar dates along the bottom and whole-number gridlines with the unit on top',
    actual: [
      labels.includes('Mar 1'),
      labels.includes('Mar 30'),
      labels.some((text) => /^\d+ kg$/.test(text)),
      labels.filter((text) => /^\d+$/.test(text)).length >= 2,
    ],
    expected: [true, true, true, true],
  })
  assert({
    given: 'the same readings as a card sparkline',
    should: 'skip axes and gridlines but keep the line and its end dot',
    actual: [
      sparkline.includes('sky-tracking-axis'),
      sparkline.includes('sky-tracking-line'),
      (sparkline.match(/<circle/g) ?? []).length,
    ],
    expected: [false, true, 1],
  })
})
