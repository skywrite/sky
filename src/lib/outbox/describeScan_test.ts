import { assert, test } from '#test'
import { outboxScanSeverity } from './describeScan.ts'
import type { ScanReport } from './types.ts'

const base: ScanReport = {
  outcome: 'acted',
  considered: 12,
  prepared: 3,
  ignored: 9,
  stale: 0,
  failed: 0,
  pending: 0,
  total: 12,
  completed: 12,
}

test('Outbox check severity separates coverage limits, partial failures, and a failed check', () => {
  const cases: [string, ScanReport & { error?: string }][] = [
    ['acted', base],
    ['coverage only', { ...base, outcome: 'failed', incomplete: 1, pending: 1 }],
    ['some failed', { ...base, outcome: 'failed', failed: 2, pending: 2 }],
    ['stopped early', { ...base, outcome: 'failed', completed: 5, pending: 7 }],
    ['failed with coverage limits', { ...base, outcome: 'failed', failed: 1, incomplete: 2, pending: 3 }],
    ['all failed', { ...base, outcome: 'failed', prepared: 0, ignored: 0, failed: 12, pending: 12 }],
    ['worker error', { ...base, outcome: 'failed', error: 'The worker stopped.' }],
    [
      'legacy report without totals',
      { outcome: 'failed', considered: 3, prepared: 0, ignored: 0, stale: 0, failed: 1, pending: 1 },
    ],
  ]
  assert({
    given: 'reports from complete, partly failed, and failed checks',
    should: 'rank them as info, warning, or error',
    actual: cases.map(([name, report]) => [name, outboxScanSeverity(report)]),
    expected: [
      ['acted', 'info'],
      ['coverage only', 'info'],
      ['some failed', 'warning'],
      ['stopped early', 'warning'],
      ['failed with coverage limits', 'warning'],
      ['all failed', 'error'],
      ['worker error', 'error'],
      ['legacy report without totals', 'warning'],
    ],
  })
})
