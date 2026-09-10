import type { MessageRecord } from '#lib/notebook/enrich/corpus.ts'
import { assert, test } from '#test'
import { samplePlaceRecords } from './backfill.ts'

function record(medium: string, day: string): MessageRecord {
  return { path: `time/${day}_${medium}.md`, date: day, medium, body: '', rel: [], tags: [] }
}

test('spread backfill covers dates and media even when messages dominate the corpus', () => {
  const records = [
    ...Array.from({ length: 20 }, (_, i) => record('email', `2026-01-${String(i + 1).padStart(2, '0')}`)),
    record('note', '2025-01-01'),
    record('note', '2026-06-01'),
    record('journal', '2026-02-01'),
  ]
  const sample = samplePlaceRecords(records, 7, 'spread')
  assert({
    given: 'many emails and a few notes and journals across different dates',
    should: 'keep the budget, include every medium and span each selected medium’s dates',
    actual: [
      sample.length,
      new Set(sample.map((r) => r.path)).size,
      sample.filter((r) => r.medium === 'email').map((r) => r.date),
      sample.filter((r) => r.medium === 'note').map((r) => r.date),
      sample.filter((r) => r.medium === 'journal').length,
      samplePlaceRecords(records, 0, 'spread').length,
      samplePlaceRecords(records, 100, 'spread').length,
      samplePlaceRecords([], 10, 'spread').length,
    ],
    expected: [
      7,
      7,
      ['2026-01-01', '2026-01-07', '2026-01-14', '2026-01-20'],
      ['2025-01-01', '2026-06-01'],
      1,
      0,
      23,
      0,
    ],
  })
  assert({
    given: 'the same input in reverse order, or the recent sampling mode',
    should: 'make spread repeatable and keep recent ordering newest first',
    actual: [
      samplePlaceRecords([...records].reverse(), 7, 'spread').map((r) => r.path),
      samplePlaceRecords(records, 2, 'recent').map((r) => r.date),
    ],
    expected: [sample.map((r) => r.path), ['2026-06-01', '2026-02-01']],
  })
})
