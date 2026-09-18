import { z } from 'zod'

export const ActionPolicySchema = z.object({
  mode: z.literal('deliverable'),
  successCriteria: z.string().trim().min(1).max(6000),
  requiredSourceIds: z.array(z.string()).default([]),
  activityTitle: z.string().optional(),
})

export const ActionAssessmentSchema = z.object({
  satisfied: z.boolean(),
  rationale: z.string().min(1).max(4000),
  artifactEvidence: z.array(z.string().trim().min(1).max(2000)).max(10),
  sourceEvidence: z.array(z.object({ sourceId: z.string(), quote: z.string().trim().min(1).max(2000) })).max(20),
  missingInputs: z.array(z.string().min(1).max(1000)).max(10),
  requiresExternalResult: z.boolean(),
})

export const ActionVerificationSchema = ActionAssessmentSchema.extend({
  outcome: z.enum(['accepted', 'needs_review']),
  reasons: z.array(z.string()),
  runId: z.string(),
  checkedAt: z.string(),
  policyRevision: z.string(),
  sourceVersions: z.record(z.string(), z.string()),
})

export type ActionPolicy = z.infer<typeof ActionPolicySchema>
export type ActionAssessment = z.infer<typeof ActionAssessmentSchema>
export type ActionVerification = z.infer<typeof ActionVerificationSchema>

/** Only completion of the requested local deliverable can be delegated by this policy. */
export function verifyActionArtifact(input: {
  activity: { title: string }
  policy: ActionPolicy
  assessment: ActionAssessment
  content: string
  sources: { id: string; content: string; version: string; error?: string; truncated?: boolean }[]
  runId: string
  now: string
  policyRevision: string
}): ActionVerification {
  const { policy, sources } = input
  const assessment = ActionAssessmentSchema.parse(input.assessment)
  const reasons: string[] = []
  if (policy.activityTitle !== input.activity.title)
    reasons.push('The activity changed after completion was delegated.')
  if (!assessment.satisfied) reasons.push('The prepared deliverable does not yet meet the agreed success criteria.')
  if (assessment.requiresExternalResult) reasons.push('A local artifact cannot establish this real-world result.')
  if (assessment.missingInputs.length) reasons.push(...assessment.missingInputs)
  if (!assessment.artifactEvidence.length) reasons.push('The assessment supplied no evidence from the deliverable.')
  for (const quote of assessment.artifactEvidence)
    if (!input.content.includes(quote)) reasons.push('The assessment cited text missing from the deliverable.')
  for (const id of policy.requiredSourceIds) {
    const source = sources.find((candidate) => candidate.id === id)
    if (!source || source.error || source.truncated || source.version === 'unavailable')
      reasons.push(`Required source ${id} is unavailable or incomplete.`)
    if (!assessment.sourceEvidence.some((evidence) => evidence.sourceId === id))
      reasons.push(`Required source ${id} has not been supported by cited evidence.`)
  }
  for (const evidence of assessment.sourceEvidence) {
    const source = sources.find((candidate) => candidate.id === evidence.sourceId)
    if (!source || source.error || !source.content.includes(evidence.quote))
      reasons.push(`Evidence from ${evidence.sourceId} could not be verified.`)
  }
  return {
    ...assessment,
    outcome: reasons.length ? 'needs_review' : 'accepted',
    reasons: [...new Set(reasons)],
    runId: input.runId,
    checkedAt: input.now,
    policyRevision: input.policyRevision,
    sourceVersions: Object.fromEntries(
      sources
        .filter((source) => assessment.sourceEvidence.some((evidence) => evidence.sourceId === source.id))
        .map((source) => [source.id, source.version]),
    ),
  }
}
