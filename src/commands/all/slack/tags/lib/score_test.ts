import { assert, test } from '#test'
import { aggregate, branchKey, scorePrediction, topLevel } from './score.ts'

test('topLevel and branchKey', () => {
  assert({
    given: 'a three-level tag',
    should: 'take first level',
    actual: topLevel('Work/Eng/Infra'),
    expected: 'Work',
  })
  assert({
    given: 'a three-level tag',
    should: 'take two levels',
    actual: branchKey('Work/Eng/Infra'),
    expected: 'Work/Eng',
  })
  assert({ given: 'a one-level tag', should: 'be its own branch', actual: branchKey('Personal'), expected: 'Personal' })
})

test('scorePrediction: exact match', () => {
  const s = scorePrediction(['Work/Eng', 'Work/Incident'], ['Work/Incident', 'Work/Eng'])
  assert({ given: 'same set, different order', should: 'be exact', actual: s.exact, expected: true })
  assert({ given: 'same set', should: 'overlap', actual: s.overlap, expected: true })
  assert({ given: 'same set', should: 'not be harmful', actual: s.harmful, expected: false })
})

test('scorePrediction: partial overlap is overlap, not exact', () => {
  const s = scorePrediction(['Work/Eng', 'Work/Incident'], ['Work/Eng'])
  assert({ given: 'subset prediction', should: 'not be exact', actual: s.exact, expected: false })
  assert({ given: 'subset prediction', should: 'overlap', actual: s.overlap, expected: true })
})

test('scorePrediction: sibling leaf lands in family, not harmful', () => {
  const s = scorePrediction(['Work/Deals/Closing'], ['Work/Deals/Integration'])
  assert({ given: 'sibling leaf under same branch', should: 'not overlap', actual: s.overlap, expected: false })
  assert({ given: 'sibling leaf under same branch', should: 'count as family', actual: s.family, expected: true })
  assert({ given: 'shared top level', should: 'not be harmful', actual: s.harmful, expected: false })
})

test('scorePrediction: foreign branch is harmful', () => {
  const s = scorePrediction(['Work/Deals/Closing'], ['Hobby/Music'])
  assert({ given: 'foreign top-level branch', should: 'be harmful', actual: s.harmful, expected: true })
  assert({ given: 'foreign top-level branch', should: 'not be family', actual: s.family, expected: false })
})

test('scorePrediction: mixed prediction with one shared top level is not harmful', () => {
  const s = scorePrediction(['Work/Deals/Closing'], ['Hobby/Music', 'Work/Events'])
  assert({
    given: 'one predicted tag shares the top level',
    should: 'not be harmful',
    actual: s.harmful,
    expected: false,
  })
})

test('scorePrediction: empty prediction abstains', () => {
  const s = scorePrediction(['Work/Eng'], [])
  assert({ given: 'no predicted tags', should: 'abstain', actual: s.abstained, expected: true })
  assert({ given: 'no predicted tags', should: 'not be harmful', actual: s.harmful, expected: false })
  assert({ given: 'no predicted tags', should: 'not be exact', actual: s.exact, expected: false })
})

test('aggregate counts each dimension', () => {
  const agg = aggregate([
    scorePrediction(['A/B'], ['A/B']),
    scorePrediction(['A/B'], []),
    scorePrediction(['A/B'], ['C/D']),
  ])
  assert({ given: 'three scored files', should: 'count files', actual: agg.files, expected: 3 })
  assert({ given: 'one exact', should: 'count exact', actual: agg.exact, expected: 1 })
  assert({ given: 'one abstain', should: 'count abstained', actual: agg.abstained, expected: 1 })
  assert({ given: 'one foreign branch', should: 'count harmful', actual: agg.harmful, expected: 1 })
})
