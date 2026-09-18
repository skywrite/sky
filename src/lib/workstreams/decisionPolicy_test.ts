import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Document from '#shared/models/Markdown/Document/mod.ts'
import { assert, test } from '#test'
import {
  applyDecisionEvaluation,
  DecisionAssessmentSchema,
  DecisionPolicySchema,
  evaluateDecision,
  type DecisionActivity,
  type DecisionAssessment,
  type DecisionPolicy,
} from './decisionPolicy.ts'
import { WorkstreamStore } from './store.ts'
import { ActivitySchema } from './types.ts'

const activity = (): DecisionActivity => ({
  id: 'scope',
  title: 'Choose pilot scope',
  kind: 'decision',
  state: 'ready',
  executor: 'sky',
  result: '',
  recommendation: '',
  waitingFor: '',
  decisionHistory: [],
  decisionAssumptions: [
    {
      id: 'capacity',
      statement: 'The pilot team has capacity.',
      status: 'confirmed',
      confirmedBy: 'Jane Doe',
      sourceIds: ['brief'],
      sourceVersions: { brief: 'v1' },
    },
  ],
})
const policy = (changes: Partial<DecisionPolicy> = {}): DecisionPolicy =>
  DecisionPolicySchema.parse({
    mode: 'delegate',
    instruction: 'Choose one approved scope using the confirmed capacity and review input.',
    activityTitle: 'Choose pilot scope',
    options: [{ id: 'small', label: 'Run the small pilot.', risk: 'low', amount: 500, currency: 'USD' }],
    maxAmount: 1000,
    currency: 'USD',
    requiredSourceIds: ['brief'],
    requiredStakeholderIds: ['reviewer'],
    requiredAssumptionIds: ['capacity'],
    ...changes,
  })
const assessment = (changes: Partial<DecisionAssessment> = {}): DecisionAssessment =>
  DecisionAssessmentSchema.parse({
    activityId: 'scope',
    choiceId: 'small',
    recommendation: 'Use the small pilot.',
    rationale: 'The confirmed capacity supports the approved small scope.',
    confidence: 0.95,
    options: [
      {
        id: 'small',
        label: 'Small pilot',
        advantages: ['Fits the team capacity.'],
        disadvantages: ['Less feedback in the first round.'],
      },
    ],
    evidence: [{ sourceId: 'brief', quote: 'The team can support the small pilot.' }],
    stakeholderEvidence: [{ stakeholderId: 'reviewer', sourceId: 'brief', quote: 'I recommend the small pilot.' }],
    assumptionIds: ['capacity'],
    risks: ['The first round covers fewer participants.'],
    contradictions: [],
    requiresHuman: false,
    escalationReason: '',
    ...changes,
  })
function evaluate(changes: Partial<Parameters<typeof evaluateDecision>[0]> = {}) {
  return evaluateDecision({
    activity: activity(),
    policy: policy(),
    policyRevision: 'grant-v1',
    assessment: assessment(),
    sources: [
      {
        id: 'brief',
        content: 'The team can support the small pilot. I recommend the small pilot.',
        version: 'v1',
        stakeholderIds: ['reviewer'],
      },
    ],
    stakeholders: [{ id: 'reviewer', name: 'Jane Doe' }],
    now: '2025-03-15 09:00',
    runId: 'run-1',
    prerequisitesSatisfied: true,
    ...changes,
  })
}

test('a delegated decision resolves an exact permitted option with source and authority attribution', () => {
  const evaluation = evaluate()
  const next = applyDecisionEvaluation(activity(), evaluation)
  assert({
    given: 'verified source evidence, attributed stakeholder input, confirmed assumptions and an exact scoped grant',
    should: 'record the decision and immutable basis rather than leave a perpetual proposal',
    actual: [
      evaluation.action,
      next.state,
      next.decisionResolution?.choiceLabel,
      next.decisionResolution?.actor,
      next.decisionResolution?.policyRevision,
      next.decisionResolution?.evidence[0].version,
      next.decisionHistory?.length,
    ],
    expected: ['resolve', 'done', 'Run the small pilot.', 'sky', 'grant-v1', 'v1', 1],
  })
})

test('human and recommendation policies never become delegated through executor assignment', () => {
  const defaultPolicy = evaluate({ policy: undefined })
  const recommended = evaluate({ policy: policy({ mode: 'recommend' }) })
  assert({
    given: 'Sky is assigned but the owner has not delegated the decision',
    should: 'provide a recommendation while preserving human resolution',
    actual: [defaultPolicy.action, recommended.action, applyDecisionEvaluation(activity(), defaultPolicy).state],
    expected: ['recommend', 'recommend', 'ready'],
  })
})

test('a delegated policy cannot override a human executor or a changed question', () => {
  const human = evaluate({ activity: { ...activity(), executor: 'human' } })
  const changed = evaluate({ activity: { ...activity(), title: 'Choose the production launch scope' } })
  assert({
    given: 'a human-owned decision or a materially renamed decision',
    should: 'escalate instead of borrowing authority from another scope',
    actual: [human.action, changed.action, changed.reasons.some((reason) => reason.includes('changed after'))],
    expected: ['escalate', 'escalate', true],
  })
})

test('risk, monetary and currency thresholds use the granted option instead of model claims', () => {
  const overBudget = evaluate({
    policy: policy({
      options: [{ id: 'small', label: 'Expensive pilot', risk: 'low', amount: 1500, currency: 'USD' }],
    }),
  })
  const highRisk = evaluate({ policy: policy({ options: [{ id: 'small', label: 'Risky pilot', risk: 'high' }] }) })
  const otherCurrency = evaluate({
    policy: policy({ options: [{ id: 'small', label: 'Other currency', risk: 'low', amount: 500, currency: 'EUR' }] }),
  })
  const invented = evaluate({ assessment: assessment({ choiceId: 'invented-option' }) })
  assert({
    given: 'the model selects choices outside the financial, risk or option boundaries',
    should: 'escalate every out-of-scope choice deterministically',
    actual: [overBudget.action, highRisk.action, otherCurrency.action, invented.action],
    expected: ['escalate', 'escalate', 'escalate', 'escalate'],
  })
})

test('unconfirmed, rejected and stale assumptions prevent delegated resolution', () => {
  const pending = evaluate({
    activity: {
      ...activity(),
      decisionAssumptions: [
        {
          id: 'capacity',
          statement: 'Capacity is available.',
          status: 'unconfirmed',
          sourceIds: [],
          sourceVersions: {},
        },
      ],
    },
  })
  const rejected = evaluate({
    activity: {
      ...activity(),
      decisionAssumptions: [
        { id: 'capacity', statement: 'Capacity is available.', status: 'rejected', sourceIds: [], sourceVersions: {} },
      ],
    },
  })
  const stale = evaluate({
    sources: [
      {
        id: 'brief',
        content: 'The team can support the small pilot. I recommend the small pilot.',
        version: 'v2',
        stakeholderIds: ['reviewer'],
      },
    ],
  })
  assert({
    given: 'a material assumption is unsupported, rejected or based on replaced evidence',
    should: 'retain the uncertainty and require review',
    actual: [pending.action, rejected.action, stale.action],
    expected: ['escalate', 'escalate', 'escalate'],
  })
})

test('explicit permission to use an unconfirmed assumption preserves that qualification in the resolution', () => {
  const evaluation = evaluate({
    activity: {
      ...activity(),
      decisionAssumptions: [
        {
          id: 'capacity',
          statement: 'Capacity is likely available.',
          status: 'unconfirmed',
          sourceIds: [],
          sourceVersions: {},
        },
      ],
    },
    policy: policy({ allowUnconfirmedAssumptions: true }),
  })
  assert({
    given: 'the owner expressly permits proceeding with an unconfirmed assumption',
    should: 'resolve the limited decision while retaining the assumption as unconfirmed',
    actual: [evaluation.action, evaluation.record?.assumptions[0].status],
    expected: ['resolve', 'unconfirmed'],
  })
})

test('invented quotes, whitespace quotes and unattributed stakeholder assertions fail evidence checks', () => {
  const invented = evaluate({
    assessment: assessment({ evidence: [{ sourceId: 'brief', quote: 'The large pilot was approved.' }] }),
  })
  const whitespace = evaluate({ assessment: assessment({ evidence: [{ sourceId: 'brief', quote: '  ' }] }) })
  const unattributed = evaluate({
    sources: [
      { id: 'brief', content: 'The team can support the small pilot. I recommend the small pilot.', version: 'v1' },
    ],
  })
  const truncated = evaluate({
    sources: [
      {
        id: 'brief',
        content: 'The team can support the small pilot. I recommend the small pilot.',
        version: 'v1',
        stakeholderIds: ['reviewer'],
        truncated: true,
      },
    ],
  })
  assert({
    given: 'a model tries to use fabricated, empty, unattributed or incomplete evidence',
    should: 'escalate instead of manufacturing ground truth',
    actual: [invented.action, whitespace.action, unattributed.action, truncated.action],
    expected: ['escalate', 'escalate', 'escalate', 'escalate'],
  })
})

test('high model confidence does not override missing evidence, contradictions or required results', () => {
  const contradictory = evaluate({
    assessment: assessment({
      confidence: 1,
      contradictions: ['The latest capture disagrees with the earlier capacity report.'],
    }),
  })
  const humanJudgment = evaluate({
    assessment: assessment({
      confidence: 1,
      requiresHuman: true,
      escalationReason: 'The scope includes a commitment outside the delegation.',
    }),
  })
  const prerequisite = evaluate({ prerequisitesSatisfied: false })
  const expired = evaluate({ policy: policy({ expiresAt: '2025-03-14 09:00' }) })
  assert({
    given: 'confidence is high but an independent prerequisite or policy condition fails',
    should: 'escalate all unresolved conditions',
    actual: [contradictory.action, humanJudgment.action, prerequisite.action, expired.action],
    expected: ['escalate', 'escalate', 'escalate', 'escalate'],
  })
})

test('decision attribution is append-only and retries do not overwrite a resolved decision', () => {
  const first = applyDecisionEvaluation(activity(), evaluate())
  const repeated = applyDecisionEvaluation(first, evaluate())
  const later = evaluate({
    activity: first,
    runId: 'run-2',
    assessment: assessment({ recommendation: 'Change the decision.' }),
  })
  assert({
    given: 'a resolved decision and a repeated or later assessment',
    should: 'preserve the original resolution and its audit record',
    actual: [
      repeated === first,
      later.action,
      repeated.decisionHistory?.length,
      repeated.decisionResolution?.recommendation,
    ],
    expected: [true, 'skip', 1, 'Use the small pilot.'],
  })
})

test('policy validation rejects ambiguous option identities and money without a currency', () => {
  const duplicate = DecisionPolicySchema.safeParse({
    options: [
      { id: 'a', label: 'First' },
      { id: 'a', label: 'Second' },
    ],
  })
  const money = DecisionPolicySchema.safeParse({ maxAmount: 1000 })
  assert({
    given: 'an ambiguous or incomplete policy',
    should: 'reject it before any model evaluation',
    actual: [duplicate.success, money.success],
    expected: [false, false],
  })
})

test('canonical decision documents preserve delegated attribution across restart and refuse retrospective edits', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sky-decision-policy-'))
  try {
    const store = new WorkstreamStore(path.join(root, 'workstreams'), path.join(root, 'state'), root)
    const original = await store.create(
      { title: 'Atlas pilot', activities: [ActivitySchema.parse(activity())] },
      '2025-03-15 09:00',
    )
    const resolution = applyDecisionEvaluation(original.activities[0], evaluate())
    const saved = await store.put({ ...original, activities: [resolution] }, original.revision)
    const restarted = new WorkstreamStore(store.dir, store.stateDir, root)
    const reloaded = (await restarted.get(saved.id))!
    const decision = reloaded.activities[0]
    const canonical = Document.fromMarkdown(await readFile(path.join(root, decision.decisionPath!), 'utf8'))
    let refused = false
    try {
      await restarted.put(
        {
          ...reloaded,
          activities: [
            {
              ...decision,
              decisionResolution: { ...decision.decisionResolution!, rationale: 'A rewritten justification.' },
            },
          ],
        },
        reloaded.revision,
      )
    } catch {
      refused = true
    }
    let resultRefused = false
    try {
      await restarted.put(
        { ...reloaded, activities: [{ ...decision, result: 'A different choice.' }] },
        reloaded.revision,
      )
    } catch {
      resultRefused = true
    }
    assert({
      given: 'a delegated decision saved in its canonical document',
      should: 'retain evidence and actor attribution and reject overwritten justification',
      actual: [
        decision.state,
        decision.decisionResolution?.actor,
        decision.decisionHistory?.length,
        (canonical.yaml.decisionResolution as { policyRevision: string }).policyRevision,
        refused,
        resultRefused,
        decision.decisionResolution?.question,
      ],
      expected: ['done', 'sky', 1, 'grant-v1', true, true, 'Choose pilot scope'],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
