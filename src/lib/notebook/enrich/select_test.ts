import { assert, test } from '#test'
import type { RelCandidate } from './select.ts'
import { buildSelectInstructions, rankCandidates, validateSelection } from './select.ts'

const CANDIDATES: RelCandidate[] = [
  { ref: 'projects/Atlas-Rollout', inText: true, inPrior: true, uses: 12 },
  { ref: 'Acme Corp', inText: true, inPrior: false, uses: 0 },
  { ref: 'Jane Doe', inText: false, inPrior: true, uses: 3 },
  { ref: 'Beacon Labs', inText: true, inPrior: false, uses: 0, score: 5 },
]

test('validateSelection keeps only verbatim candidates, deduped and capped', () => {
  const picked = validateSelection(['projects/atlas rollout', 'Acme Corp', 'Acme Corp', 'Nonsense Inc'], CANDIDATES)
  assert({
    given: 'normalized duplicates and a non-candidate',
    should: 'keep two canonical refs',
    actual: picked,
    expected: ['projects/Atlas-Rollout', 'Acme Corp'],
  })
})

test('rankCandidates orders by evidence class then usage then score', () => {
  const ranked = rankCandidates(CANDIDATES)
  assert({
    given: 'a text+prior candidate',
    should: 'rank it first',
    actual: ranked[0],
    expected: 'projects/Atlas-Rollout',
  })
  assert({
    given: 'two text-only candidates',
    should: 'break the tie by score',
    actual: ranked[1],
    expected: 'Beacon Labs',
  })
  assert({ given: 'the cap', should: 'stop at two', actual: ranked.length, expected: 2 })
})

test('buildSelectInstructions annotates evidence and exemplars', () => {
  const text = buildSelectInstructions({
    body: 'x',
    candidates: CANDIDATES,
    exemplars: [{ summary: 'Rollout status sync', rel: ['projects/Atlas-Rollout'] }],
  })
  assert({
    given: 'a text+prior candidate',
    should: 'show both evidence kinds',
    actual: text.includes('named in the text; prior precedent, 12 prior uses'),
    expected: true,
  })
  assert({
    given: 'an exemplar',
    should: 'render the summary → rel pair',
    actual: text.includes('"Rollout status sync" → projects/Atlas-Rollout'),
    expected: true,
  })
})
