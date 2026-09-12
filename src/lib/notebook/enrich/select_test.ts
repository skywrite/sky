import { assert, test } from '#test'
import type { PlaceJudgment, RelCandidate, SelectRequest } from './select.ts'
import {
  buildPlaceJudgmentsSchema,
  buildSelectInstructions,
  rankCandidates,
  validatePlaceSelection,
  validateSelection,
} from './select.ts'

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

test('place selection requires a unique subject judgment grounded in the named place and visible source', () => {
  const quote = 'France faces a housing shortage.'
  const place: RelCandidate = {
    ref: 'places/FR',
    inText: true,
    inPrior: false,
    uses: 0,
    placeEvidence: [{ name: 'France', quote }],
  }
  const req: SelectRequest = { body: quote, candidates: [place, CANDIDATES[1]!], exemplars: [] }
  const subject: PlaceJudgment = {
    ref: place.ref,
    role: 'subject',
    reason: 'Local housing conditions are the topic.',
  }
  const picked = [place.ref, 'Acme Corp']
  const invalid: PlaceJudgment[][] = [
    [],
    [{ ...subject, role: 'incidental' }],
    [{ ...subject, role: 'not_a_place' }],
    [{ ...subject, reason: ' ' }],
    [subject, { ...subject, role: 'incidental' }],
    [{ ...subject, ref: 'places/CA' }],
  ]
  assert({
    given: 'a model selecting a place with missing, incidental, conflicting or ungrounded support',
    should: 'drop that place while preserving a valid ordinary entity selection',
    actual: invalid.map((judgments) => validatePlaceSelection(picked, judgments, req)),
    expected: invalid.map(() => ['Acme Corp']),
  })
  assert({
    given: 'a substantive place with an exact named excerpt, or one beyond the selector’s reading budget',
    should: 'keep only the judgment supported by the visible source and an extracted place name',
    actual: [
      validatePlaceSelection(picked, [subject], req),
      validatePlaceSelection(picked, [subject], { ...req, placesOnly: true }),
      validatePlaceSelection([], [subject], { ...req, placesOnly: true }),
      validatePlaceSelection(picked, [subject], { ...req, body: 'x '.repeat(3500) + quote }),
      validatePlaceSelection(picked, [subject], { ...req, body: 'x '.repeat(4500) + quote }),
      validatePlaceSelection(picked, [subject], {
        ...req,
        candidates: [{ ...place, placeEvidence: [] }, CANDIDATES[1]!],
      }),
      ...['Invented claim about France.', 'housing shortage'].map((evidence) =>
        validatePlaceSelection(picked, [subject], {
          ...req,
          candidates: [{ ...place, placeEvidence: [{ name: 'France', quote: evidence }] }, CANDIDATES[1]!],
        }),
      ),
    ],
    expected: [picked, [place.ref], [place.ref], picked, ['Acme Corp'], ['Acme Corp'], ['Acme Corp'], ['Acme Corp']],
  })
})

test('place selection reuses original multiline evidence without another model quotation', () => {
  const quote = 'France faces a housing shortage.\n\nPublic rents keep rising.'
  const candidate: RelCandidate = {
    ref: 'places/FR',
    inText: true,
    inPrior: false,
    uses: 0,
    placeEvidence: [{ name: 'France', quote }],
  }
  const req: SelectRequest = { body: quote, candidates: [candidate], exemplars: [] }
  const judgment: PlaceJudgment = {
    ref: candidate.ref,
    role: 'subject',
    reason: 'The place’s housing conditions are discussed.',
  }
  assert({
    given: 'original multiline evidence, changed wording, or noncontiguous passages',
    should: 'accept only the original grounded evidence without requiring the selector to quote it again',
    actual: [
      validatePlaceSelection([candidate.ref], [judgment], req),
      validatePlaceSelection([candidate.ref], [judgment], {
        ...req,
        candidates: [{ ...candidate, placeEvidence: [{ name: 'France', quote: 'France faces a housing crisis.' }] }],
      }),
      validatePlaceSelection([candidate.ref], [judgment], {
        ...req,
        body: quote.replace('\n\n', '\n\nAnother topic.\n\n'),
      }),
    ],
    expected: [[candidate.ref], [], []],
  })
})

test('travel destinations qualify with grounded evidence and share the existing place limit', () => {
  const body = 'France trip: met the team, then visited Canada. We discussed local housing in Spain.'
  const candidates = ['France', 'Canada', 'Spain'].map((name) => ({
    ref: `places/mock/${name}`,
    inText: true,
    inPrior: false,
    uses: 0,
    placeEvidence: [{ name, quote: body }],
  }))
  const judgments: PlaceJudgment[] = candidates.map((candidate, i) => ({
    ref: candidate.ref,
    role: i < 2 ? 'destination' : 'subject',
    reason: i < 2 ? 'The entry recounts a business trip to this destination.' : 'Local housing is discussed.',
  }))
  const req: SelectRequest = { body, candidates, exemplars: [], placesOnly: true }
  assert({
    given: 'two travel destinations and a place topic',
    should: 'accept destinations under the existing two-place cap',
    actual: validatePlaceSelection([], judgments, req),
    expected: candidates.slice(0, 2).map((c) => c.ref),
  })
  assert({
    given: 'a destination judgment with conflicting, missing or ungrounded support',
    should: 'enforce the same checks as for place topics',
    actual: [
      validatePlaceSelection([], [judgments[0]!, { ...judgments[0]!, role: 'incidental' }], req),
      validatePlaceSelection([], [{ ...judgments[0]!, reason: ' ' }], req),
      validatePlaceSelection([], [judgments[0]!], { ...req, body: 'Unrelated entry.' }),
      validatePlaceSelection([candidates[0]!.ref], [judgments[0]!], { ...req, placesOnly: false }),
    ],
    expected: [[], [], [], [candidates[0]!.ref]],
  })
})

test('place judgment output requires an assessment for every place candidate', () => {
  const schema = buildPlaceJudgmentsSchema([
    { ...CANDIDATES[0]!, ref: 'places/FR' },
    { ...CANDIDATES[0]!, ref: 'places/CA' },
    CANDIDATES[1]!,
  ])
  const destination = { role: 'destination', reason: 'The entry recounts a visit.' }
  const incidental = { role: 'incidental', reason: 'Only a passing reference.' }
  assert({
    given: 'complete, empty, partial and substituted candidate assessments',
    should: 'require both place judgments while ordinary entity candidates remain context',
    actual: [
      { 'places/FR': destination, 'places/CA': incidental },
      {},
      { 'places/FR': destination },
      { 'places/FR': destination, 'places/ES': incidental },
    ].map((places) => schema.safeParse({ places }).success),
    expected: [true, false, false, false],
  })
})
