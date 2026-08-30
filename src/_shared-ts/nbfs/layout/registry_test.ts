import { assert, test } from '#test'
import { ALL_LAYOUTS, DEFAULT_LAYOUT_PATTERN, LAYOUT_PATTERNS, layoutByPattern } from './registry.ts'
import v1_1 from './v1_1/mod.ts'
import { v2 } from './v2.ts'

test('registry - patterns and default', () => {
  assert({
    given: 'the registry',
    should: 'expose exactly the supported patterns, current first',
    actual: LAYOUT_PATTERNS.join(' '),
    expected: 'YYYY/W##/MM-DD YYYY/MM-W##/MM-DD YYYY/MM/DD-DD/MM-DD',
  })
  assert({
    given: 'the default',
    should: 'be v2 - what a notebook tree is since the 2026-08-30 migration',
    actual: DEFAULT_LAYOUT_PATTERN,
    expected: v2.pattern,
  })
  for (const layout of ALL_LAYOUTS) {
    assert({
      given: layout.pattern,
      should: 'resolve to itself by pattern',
      actual: layoutByPattern(layout.pattern),
      expected: layout,
    })
  }
  assert({
    given: 'an unknown pattern',
    should: 'resolve to undefined',
    actual: layoutByPattern('YYYY/QQ/MM-DD'),
    expected: undefined,
  })
})

test('v1_1 layout wraps the existing implementation unchanged', () => {
  assert({
    given: '2026-03-31',
    should: 'build the v1.1 day dir',
    actual: v1_1.dayDir('2026-03-31'),
    expected: '2026/03/30-05/03-31',
  })
  assert({
    given: 'a v1.1 day path',
    should: 'round-trip through the wrapper',
    actual: v1_1.parseDateFromDayPath('time/2026/03/30-05/04-01/day.md').toString(),
    expected: '2026-04-01',
  })
  const week = v1_1.parseTimePath('time/2026/03/30-05/week.md')
  assert({
    given: 'a v1.1 week doc',
    should: 'classify with its cross-month span',
    actual: `${week?.kind} ${week?.start} ${week?.end}`,
    expected: 'week 2026-03-30 2026-04-05',
  })
})
