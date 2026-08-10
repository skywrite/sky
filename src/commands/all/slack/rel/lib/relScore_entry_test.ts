import { assert, test } from '#test'
import { entryTallies } from './relScore.ts'

test('entryTallies counts per-entry precision and recall inputs', () => {
  const t = entryTallies(['Jane Doe', 'Acme Corp'], ['Jane-Doe', 'Beacon Labs', 'Beacon Labs'])
  assert({ given: 'deduped predictions', should: 'count distinct', actual: t.predicted, expected: 2 })
  assert({ given: 'one normalized hit', should: 'count correct', actual: t.correct, expected: 1 })
  assert({ given: 'two actual entries', should: 'count actual', actual: t.actual, expected: 2 })
  assert({ given: 'one recovered actual', should: 'count recovered', actual: t.recovered, expected: 1 })
})

test('entryTallies handles empty sides', () => {
  const t = entryTallies([], [])
  assert({
    given: 'empty sets',
    should: 'be all zero',
    actual: [t.predicted, t.correct, t.actual, t.recovered],
    expected: [0, 0, 0, 0],
  })
})
