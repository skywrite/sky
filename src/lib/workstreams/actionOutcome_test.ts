import { assert, test } from '#test'
import { verifyActionArtifact, type ActionAssessment } from './actionOutcome.ts'

const assessment: ActionAssessment = {
  satisfied: true,
  rationale: 'The scope includes the invited cohort and a measurable learning target.',
  artifactEvidence: ['Invite a small cohort.'],
  sourceEvidence: [{ sourceId: 'feedback', quote: 'Start with existing customers.' }],
  missingInputs: [],
  requiresExternalResult: false,
}
const input = {
  activity: { title: 'Prepare pilot scope' },
  policy: {
    mode: 'deliverable' as const,
    activityTitle: 'Prepare pilot scope',
    successCriteria: 'Include an invited cohort and a learning target.',
    requiredSourceIds: ['feedback'],
  },
  assessment,
  content: 'Invite a small cohort. Measure whether customers finish the pilot.',
  sources: [{ id: 'feedback', content: 'Start with existing customers.', version: 'source-v1' }],
  runId: 'run-1',
  now: '2025-03-15 12:00',
  policyRevision: 'permission-v1',
}

test('delegated deliverables finish with recorded artifact and source evidence', () => {
  const result = verifyActionArtifact(input)
  assert({
    given: 'an explicitly delegated local deliverable and independently checked evidence',
    should: 'accept the work with its policy and source provenance',
    actual: [result.outcome, result.reasons, result.policyRevision, result.sourceVersions],
    expected: ['accepted', [], 'permission-v1', { feedback: 'source-v1' }],
  })
})

test('delegated completion cannot turn an artifact into evidence of an external result', () => {
  const external = verifyActionArtifact({ ...input, assessment: { ...assessment, requiresExternalResult: true } })
  const unsupported = verifyActionArtifact({
    ...input,
    assessment: { ...assessment, artifactEvidence: ['Invented text'] },
  })
  const missing = verifyActionArtifact({ ...input, sources: [] })
  const changed = verifyActionArtifact({ ...input, activity: { title: 'Get pilot approval' } })
  assert({
    given: 'external completion, invented evidence, missing required context, or a changed task',
    should: 'keep each result open for human review',
    actual: [external, unsupported, missing, changed].map((result) => result.outcome),
    expected: ['needs_review', 'needs_review', 'needs_review', 'needs_review'],
  })
})
