import { assert, test } from '#test'
import { resolveCaptureHorizon } from './captureTiming.ts'
import type { CaptureHorizon, CaptureRequest } from './captureTypes.ts'

const request = (intent: string): CaptureRequest => ({ intent, answers: [] })

test('completion horizons require the owner’s actual forward-looking timing and a matching bucket', () => {
  const cases: { intent: string; horizon: CaptureHorizon; quote: string; expected: CaptureHorizon | null }[] = [
    { intent: 'Grow Atlas.', horizon: 'this-week', quote: 'Finish by Friday', expected: null },
    { intent: 'Grow Atlas.', horizon: 'few-months', quote: 'Grow Atlas', expected: null },
    {
      intent: 'Raise $2M for Atlas over the next three months.',
      horizon: 'few-months',
      quote: 'over the next three months',
      expected: 'few-months',
    },
    {
      intent: 'Raise $2M for Atlas over the next three months.',
      horizon: 'few-months',
      quote: 'Raise $2M for Atlas over the next three months.',
      expected: 'few-months',
    },
    {
      intent: 'Raise $2M for Atlas over the next three months.',
      horizon: 'this-week',
      quote: 'three months',
      expected: null,
    },
    {
      intent: 'Finish the pilot within a few weeks.',
      horizon: 'few-weeks',
      quote: 'a few weeks',
      expected: 'few-weeks',
    },
    { intent: 'Finish the pilot this week.', horizon: 'this-week', quote: 'this week', expected: 'this-week' },
    {
      intent: 'Build the partner network over the longer term.',
      horizon: 'longer-term',
      quote: 'longer term',
      expected: 'longer-term',
    },
    {
      intent: 'Complete the platform transition within one year.',
      horizon: 'longer-term',
      quote: 'one year',
      expected: 'longer-term',
    },
    { intent: 'Finish the pilot by 2025-05-01.', horizon: 'few-months', quote: 'by 2025-05-01', expected: null },
  ]
  assert({
    given: 'plain intentions, a source-only deadline quote, explicit durations and mismatched model buckets',
    should: 'accept only verifiable current user timing and ask when the date or intent cannot safely be mapped',
    actual: cases.map((entry) => resolveCaptureHorizon(request(entry.intent), entry.horizon, entry.quote)),
    expected: cases.map((entry) => entry.expected),
  })
})

test('a model cannot prune history, conditions, negation, cadence or kickoff from its quoted timing', () => {
  const clauses = [
    'Start the pilot this week.',
    'Kick off the pilot this week.',
    'Work on the pilot this week.',
    'Focus on finishing the pilot this week.',
    'Do not finish the pilot this week.',
    'Maybe finish the pilot this week.',
    'If approval arrives, finish the pilot this week.',
    'We planned to finish the pilot this week.',
    'The pilot was supposed to finish this week.',
    'The team suggested finishing the pilot this week.',
    'Raise funding for Atlas. Prepare investor slides this week.',
    'Raise funding for Atlas and prepare investor slides this week.',
    'Raise funding for Atlas. My notes say finish this week.',
    'My notes say finish this week.',
  ]
  const durations = [
    'We discussed the pilot three months ago.',
    'We started the pilot over the last three months.',
    'Send an update every three months.',
    'If approved, finish over the next three months.',
    'We could finish within three months.',
    'Finish the pilot after three months of approval processing.',
    'Create a three-month roadmap.',
    'Meet Jane in three months to discuss the rollout.',
    'Finish the platform refresh and meet Jane in three months to discuss the rollout.',
    'Complete the platform refresh. Meet Jane in three months to discuss the rollout.',
  ]
  assert({
    given: 'temporal fragments taken out of noncommittal, historical or differently scoped user statements',
    should: 'preserve the qualifying context and refuse to infer a completion horizon',
    actual: [
      ...clauses.map((intent) => resolveCaptureHorizon(request(intent), 'this-week', 'this week')),
      ...durations.map((intent) =>
        resolveCaptureHorizon(
          request(intent),
          'few-months',
          intent.includes('three-month') ? 'three-month' : 'three months',
        ),
      ),
    ],
    expected: Array(clauses.length + durations.length).fill(null),
  })
})

test('explicit owner selections and valid uncertainty take precedence over model guesses', () => {
  const choice: CaptureRequest = {
    intent: 'Expand Atlas.',
    horizon: 'longer-term',
    answers: [{ field: 'timing', question: 'When?', answer: 'This week' }],
  }
  const cases: { answer: string; model: CaptureHorizon | null; quote: string; expected: CaptureHorizon }[] = [
    { answer: 'This week', model: 'few-months', quote: 'three months', expected: 'this-week' },
    { answer: 'few-weeks', model: null, quote: '', expected: 'few-weeks' },
    { answer: 'Not sure', model: 'this-week', quote: 'this week', expected: 'unsure' },
    { answer: 'I don’t know yet.', model: 'few-months', quote: 'three months', expected: 'unsure' },
    { answer: 'Three months', model: 'few-months', quote: 'Three months', expected: 'few-months' },
    { answer: 'After the approvals arrive', model: 'this-week', quote: 'this week', expected: 'unsure' },
  ]
  assert({
    given: 'an explicit selection or an answer to the timing question',
    should: 'respect that choice and treat uncertain or unmappable answers as valid without repeating the question',
    actual: [
      resolveCaptureHorizon(choice, 'few-months', 'three months'),
      ...cases.map((entry) =>
        resolveCaptureHorizon(
          { intent: 'Expand Atlas.', answers: [{ field: 'timing', question: 'When?', answer: entry.answer }] },
          entry.model,
          entry.quote,
        ),
      ),
    ],
    expected: ['longer-term', ...cases.map((entry) => entry.expected)],
  })
})

test('the latest timing answer replaces older timing and mixed context needs clarification', () => {
  const updated: CaptureRequest = {
    intent: 'Finish the pilot within three months.',
    answers: [{ field: 'timing', question: 'When?', answer: 'Within two weeks.' }],
  }
  const unknown: CaptureRequest = {
    ...updated,
    answers: [{ field: 'timing', question: 'When?', answer: 'It depends on approval.' }],
  }
  assert({
    given: 'a later timing correction, a later uncertain answer, and a new commitment after a historical sentence',
    should: 'use the latest answer rather than cherry-pick timing from old or ambiguously scoped context',
    actual: [
      resolveCaptureHorizon(updated, 'few-months', 'three months'),
      resolveCaptureHorizon(updated, 'few-weeks', 'two weeks'),
      resolveCaptureHorizon(unknown, 'few-months', 'three months'),
      resolveCaptureHorizon(
        request('The pilot started last year. Finish the evaluation within three months.'),
        'few-months',
        'three months',
      ),
    ],
    expected: ['unsure', 'few-weeks', 'unsure', null],
  })
})
