import { assert, test } from '#test'
import { WorkstreamDraftSchema, WorkstreamReviewSchema } from './ai.ts'
import { CoordinationProposalSchema, groundCoordination } from './coordination.ts'

const stakeholder = {
  name: 'Jane Doe',
  role: 'Contributes customer input',
  reason: 'Owner named this input.',
  basis: 'stated',
}
const reporting = {
  audience: 'Pilot team',
  medium: 'email',
  destination: 'jane@example.com',
  cadenceDays: 7,
  instructions: 'Summarize the pilot.',
  detail: 'summary',
  artifacts: ['presentation outline'],
  reason: 'The owner requested a weekly update.',
  basis: 'stated',
}
const metric = {
  name: 'Invited customers',
  target: '10 invited customers',
  reason: 'Owner supplied the pilot size.',
  basis: 'stated',
  sourceQuote: 'Target 10 invited customers for the pilot.',
}

test('coordination stays optional for simple work and strips authority from model proposals', () => {
  const proposal = CoordinationProposalSchema.parse({
    stakeholders: [{ ...stakeholder, executor: 'sky' }],
    reporting: [{ ...reporting, delivery: 'send', allowSensitive: true, permittedSourceIds: ['private'] }],
    decisionPolicies: { choose: { mode: 'delegate' } },
  })
  assert({
    given: 'optional coordination with attempted permission fields',
    should: 'retain only reviewable arrangements and permit no coordination at all',
    actual: [CoordinationProposalSchema.parse({}), proposal],
    expected: [{}, { stakeholders: [stakeholder], reporting: [reporting] }],
  })
  assert({
    given: 'a reporting proposal whose cadence was never stated or proposed',
    should: 'require the visible proposal to name its cadence rather than silently scheduling weekly updates',
    actual: CoordinationProposalSchema.safeParse({ reporting: [{ ...reporting, cadenceDays: undefined }] }).success,
    expected: false,
  })
})

test('coordination validates real calendar dates and an ordered interval', () => {
  const cases = [
    { start: '2024-02-29', due: '2024-03-01' },
    { start: '2025-02-29' },
    { due: '2025-04-31' },
    { start: '2025-03-20', due: '2025-03-19' },
    { due: 'tomorrow' },
  ]
  assert({
    given: 'a leap date, impossible dates, reversed dates, and an unresolved relative date',
    should: 'accept only the valid ordered calendar interval',
    actual: cases.map(
      (timeline) =>
        CoordinationProposalSchema.safeParse({
          timeline: { ...timeline, reason: 'Proposed timing.', basis: 'suggested' },
        }).success,
    ),
    expected: [true, false, false, false, false],
  })
})

test('metric proposals cannot invent targets by attaching an unrelated real quote', () => {
  const valid = CoordinationProposalSchema.parse({ metrics: [metric] })
  const candidates = CoordinationProposalSchema.parse({
    metrics: [
      metric,
      { ...metric, target: '100 invited customers' },
      { ...metric, current: '8' },
      { ...metric, sourceQuote: 'Target 10 invited customers and 90% satisfaction.' },
    ],
  })
  assert({
    given: 'one supplied target alongside invented targets, current values and evidence',
    should: 'retain only the target actually present in supplied context',
    actual: groundCoordination(candidates, {
      objective: 'Prepare the pilot. Target 10 invited customers\nfor the pilot.',
    }),
    expected: valid,
  })
  assert({
    given: 'a metric whose basis is a recommendation',
    should: 'reject it because generic KPIs are not part of workstream creation',
    actual: CoordinationProposalSchema.safeParse({ metrics: [{ ...metric, basis: 'suggested' }] }).success,
    expected: false,
  })
})

test('coordination limits proposal growth and accepts the same optional payload in draft and review', () => {
  const coordination = { stakeholders: [stakeholder], reporting: [reporting], metrics: [metric] }
  const common = {
    understanding: '',
    unknowns: [],
    activities: [],
    decisions: [],
    coordination,
    relationships: [],
    suggestions: [],
    subworkstreams: [],
  }
  const draft = { ...common, title: 'Atlas pilot', outcome: 'A useful pilot.' }
  const review = {
    ...common,
    summary: 'New coordination to review.',
    outcomeSuggestion: '',
    artifact: null,
    communication: null,
    waitingFor: '',
    nextCheckMinutes: 1440,
  }
  assert({
    given: 'a draft and an ongoing review plus overlarge coordination arrays',
    should: 'share the optional proposal contract and cap each collection at six',
    actual: [
      WorkstreamDraftSchema.safeParse(draft).success,
      WorkstreamReviewSchema.safeParse(review).success,
      CoordinationProposalSchema.safeParse({ stakeholders: Array(7).fill(stakeholder) }).success,
      CoordinationProposalSchema.safeParse({ reporting: Array(7).fill(reporting) }).success,
      CoordinationProposalSchema.safeParse({ metrics: Array(7).fill(metric) }).success,
      CoordinationProposalSchema.safeParse({ reporting: [{ ...reporting, artifacts: Array(7).fill('outline') }] })
        .success,
    ],
    expected: [true, true, false, false, false, false],
  })
})
