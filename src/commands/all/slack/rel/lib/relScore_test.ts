import { assert, test } from '#test'
import { aggregateRel, scoreRel } from './relScore.ts'

test('scoreRel: exact under normalization', () => {
  const s = scoreRel(['Jane Doe', 'projects/Atlas-Rollout'], ['projects/Atlas Rollout', 'Jane-Doe'])
  assert({ given: 'same entities, different separators', should: 'be exact', actual: s.exact, expected: true })
  assert({ given: 'same entities', should: 'not be wrong', actual: s.wrongEntity, expected: false })
})

test('scoreRel: partial overlap is overlap, not exact', () => {
  const s = scoreRel(['Jane Doe', 'Acme Corp'], ['Jane Doe'])
  assert({ given: 'a subset prediction', should: 'overlap', actual: s.overlap, expected: true })
  assert({ given: 'a subset prediction', should: 'not be exact', actual: s.exact, expected: false })
})

test('scoreRel: all-wrong prediction is wrongEntity', () => {
  const s = scoreRel(['Jane Doe'], ['Acme Corp'])
  assert({ given: 'a disjoint prediction', should: 'be wrongEntity', actual: s.wrongEntity, expected: true })
  assert({ given: 'a disjoint prediction', should: 'not overlap', actual: s.overlap, expected: false })
})

test('scoreRel: empty prediction abstains', () => {
  const s = scoreRel(['Jane Doe'], [])
  assert({ given: 'no prediction', should: 'abstain', actual: s.abstained, expected: true })
  assert({ given: 'no prediction', should: 'not be wrongEntity', actual: s.wrongEntity, expected: false })
})

test('aggregateRel counts dimensions', () => {
  const agg = aggregateRel([scoreRel(['A'], ['A']), scoreRel(['A'], []), scoreRel(['A'], ['B'])])
  assert({ given: 'three scored files', should: 'count files', actual: agg.files, expected: 3 })
  assert({ given: 'one exact', should: 'count', actual: agg.exact, expected: 1 })
  assert({ given: 'one abstain', should: 'count', actual: agg.abstained, expected: 1 })
  assert({ given: 'one wrong', should: 'count', actual: agg.wrongEntity, expected: 1 })
})
