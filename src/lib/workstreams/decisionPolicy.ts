import { z } from 'zod'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

const DecisionId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/)
const Risk = z.enum(['low', 'medium', 'high'])

/** Stored in the external authority grant, never inferred from a model's answer or the activity brief. */
export const DecisionPolicySchema = z
  .object({
    mode: z.enum(['human', 'recommend', 'delegate']).default('human'),
    instruction: z.string().max(6000).default(''),
    activityTitle: z.string().optional(),
    options: z
      .array(
        z.object({
          id: DecisionId,
          label: z.string().min(1).max(1000),
          risk: Risk.default('low'),
          amount: z.number().finite().min(0).optional(),
          currency: z
            .string()
            .regex(/^[A-Z]{3}$/)
            .optional(),
        }),
      )
      .max(30)
      .default([]),
    maxRisk: Risk.default('low'),
    maxAmount: z.number().finite().min(0).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    requiredSourceIds: z.array(DecisionId).max(30).default([]),
    requiredStakeholderIds: z.array(DecisionId).max(30).default([]),
    requiredAssumptionIds: z.array(DecisionId).max(30).default([]),
    allowUnconfirmedAssumptions: z.boolean().default(false),
    minConfidence: z.number().min(0).max(1).default(0.9),
    expiresAt: z.string().optional(),
  })
  .superRefine((policy, context) => {
    if (new Set(policy.options.map((option) => option.id)).size !== policy.options.length)
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Each permitted decision option needs a unique identity.',
      })
    if (policy.maxAmount !== undefined && !policy.currency)
      context.addIssue({ code: 'custom', path: ['currency'], message: 'A monetary threshold needs its currency.' })
    for (let index = 0; index < policy.options.length; index++) {
      if (policy.options[index].amount !== undefined && !policy.options[index].currency)
        context.addIssue({
          code: 'custom',
          path: ['options', index, 'currency'],
          message: 'A monetary option needs its currency.',
        })
    }
    if (policy.expiresAt) {
      try {
        new PlainDateTime(policy.expiresAt).normalize()
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['expiresAt'],
          message: 'Use a valid UTC date and time for authority expiry.',
        })
      }
    }
  })

export const DecisionAssumptionSchema = z.object({
  id: DecisionId,
  statement: z.string().min(1).max(2400),
  status: z.enum(['unconfirmed', 'confirmed', 'rejected']).default('unconfirmed'),
  sourceIds: z.array(DecisionId).default([]),
  sourceVersions: z.record(z.string(), z.string()).default({}),
  confirmedBy: z.string().max(500).optional(),
})

const EvidenceSchema = z.object({ sourceId: DecisionId, quote: z.string().min(1).max(2000) })
export const DecisionAssessmentSchema = z.object({
  activityId: DecisionId,
  choiceId: z.string().max(100),
  recommendation: z.string().min(1).max(4000),
  rationale: z.string().min(1).max(6000),
  confidence: z.number().min(0).max(1),
  options: z
    .array(
      z.object({
        id: z.string().max(100),
        label: z.string().max(1000),
        advantages: z.array(z.string().max(1200)).max(5),
        disadvantages: z.array(z.string().max(1200)).max(5),
      }),
    )
    .max(10),
  evidence: z.array(EvidenceSchema).max(30),
  assumptionIds: z.array(DecisionId).max(30),
  stakeholderEvidence: z.array(EvidenceSchema.extend({ stakeholderId: DecisionId })).max(30),
  risks: z.array(z.string().max(1200)).max(10),
  contradictions: z.array(z.string().max(1200)).max(10),
  requiresHuman: z.boolean(),
  escalationReason: z.string().max(2400),
})

export const DecisionRecordSchema = z.object({
  id: DecisionId,
  activityId: DecisionId,
  at: z.string(),
  question: z.string().optional(),
  actor: z.literal('sky'),
  runId: DecisionId,
  policyRevision: z.string(),
  outcome: z.enum(['resolved', 'recommended', 'escalated']),
  choiceId: z.string(),
  choiceLabel: z.string(),
  recommendation: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
  options: DecisionAssessmentSchema.shape.options,
  evidence: z.array(EvidenceSchema.extend({ version: z.string() })),
  assumptions: z.array(DecisionAssumptionSchema),
  stakeholderEvidence: z.array(EvidenceSchema.extend({ stakeholderId: DecisionId, version: z.string() })),
  risks: z.array(z.string()),
  contradictions: z.array(z.string()),
  reasons: z.array(z.string()),
})
export const DecisionResolutionSchema = DecisionRecordSchema.refine(
  (record) => record.outcome === 'resolved',
  'A resolution must have a resolved outcome.',
)

export type DecisionPolicy = z.infer<typeof DecisionPolicySchema>
export type DecisionAssumption = z.infer<typeof DecisionAssumptionSchema>
export type DecisionAssessment = z.infer<typeof DecisionAssessmentSchema>
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>
export type DecisionSource = {
  id: string
  content: string
  version: string
  stakeholderIds?: string[]
  error?: string
  truncated?: boolean
}
export type DecisionActivity = {
  id: string
  title: string
  kind: string
  state: string
  executor: string
  result: string
  recommendation: string
  waitingFor: string
  subworkstreamId?: string
  decisionAssumptions?: DecisionAssumption[]
  decisionAnalysis?: DecisionRecord
  decisionResolution?: DecisionRecord
  decisionHistory?: DecisionRecord[]
}
export type DecisionEvaluation = {
  action: 'resolve' | 'recommend' | 'escalate' | 'skip'
  reasons: string[]
  record?: DecisionRecord
}

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()
const riskLevel = { low: 0, medium: 1, high: 2 }

/** The model recommends; this gate alone decides whether the owner's exact delegated choice can be recorded. */
export function evaluateDecision(input: {
  activity: DecisionActivity
  policy?: DecisionPolicy
  policyRevision: string
  assessment: DecisionAssessment
  sources: DecisionSource[]
  stakeholders: { id: string; name: string }[]
  now: string
  runId: string
  prerequisitesSatisfied?: boolean
}): DecisionEvaluation {
  const { activity, sources, stakeholders, policyRevision, runId } = input
  const assessment = DecisionAssessmentSchema.parse(input.assessment)
  const policy = DecisionPolicySchema.parse(input.policy ?? {})
  if (
    activity.kind !== 'decision' ||
    activity.subworkstreamId ||
    ['done', 'canceled'].includes(activity.state) ||
    activity.decisionResolution
  )
    return { action: 'skip', reasons: ['This is not an unresolved canonical decision.'] }
  if (assessment.activityId !== activity.id)
    return { action: 'skip', reasons: ['The assessment belongs to another activity.'] }
  if (activity.decisionHistory?.some((record) => record.runId === runId))
    return { action: 'skip', reasons: ['This decision attempt is already recorded.'] }

  const reasons: string[] = []
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const verifyEvidence = (entry: { sourceId: string; quote: string }): boolean => {
    const source = sourceById.get(entry.sourceId)
    if (
      !source ||
      source.error ||
      source.truncated ||
      !source.version ||
      source.version === 'unavailable' ||
      !clean(entry.quote) ||
      !clean(source.content).includes(clean(entry.quote))
    ) {
      reasons.push(`Evidence could not be verified in source ${entry.sourceId}.`)
      return false
    }
    return true
  }
  const evidence = assessment.evidence
    .filter(verifyEvidence)
    .map((entry) => ({ ...entry, version: sourceById.get(entry.sourceId)!.version }))
  if (!evidence.length) reasons.push('No verifiable source evidence supports this decision.')
  for (const id of policy.requiredSourceIds)
    if (!evidence.some((entry) => entry.sourceId === id))
      reasons.push(`Required source ${id} has not supplied verified evidence.`)
  if (new Set(sources.map((source) => source.id)).size !== sources.length)
    reasons.push('Source identities are ambiguous.')

  const assumptions = (activity.decisionAssumptions ?? []).map((assumption) =>
    DecisionAssumptionSchema.parse(assumption),
  )
  for (const id of [...policy.requiredAssumptionIds, ...assessment.assumptionIds])
    if (!assumptions.some((assumption) => assumption.id === id))
      reasons.push(`Assumption ${id} has not been established in this decision.`)
  for (const assumption of assumptions) {
    if (assumption.status === 'rejected') reasons.push(`The assumption “${assumption.statement}” was rejected.`)
    if (assumption.status === 'confirmed' && !assumption.confirmedBy)
      reasons.push(`The confirmation of “${assumption.statement}” has no attribution.`)
    if (assumption.status === 'unconfirmed' && !policy.allowUnconfirmedAssumptions)
      reasons.push(`The assumption “${assumption.statement}” needs confirmation.`)
    for (const id of assumption.sourceIds) {
      const source = sourceById.get(id)
      if (!source || source.error) reasons.push(`Assumption evidence ${id} is unavailable.`)
      else if (assumption.sourceVersions[id] && assumption.sourceVersions[id] !== source.version)
        reasons.push(`The evidence for “${assumption.statement}” changed after confirmation.`)
    }
  }

  const stakeholderEvidence = assessment.stakeholderEvidence
    .filter((entry) => {
      if (!verifyEvidence(entry)) return false
      const source = sourceById.get(entry.sourceId)!
      if (
        !stakeholders.some((stakeholder) => stakeholder.id === entry.stakeholderId) ||
        !source.stakeholderIds?.includes(entry.stakeholderId)
      ) {
        reasons.push(`The evidence is not attributed to stakeholder ${entry.stakeholderId}.`)
        return false
      }
      return true
    })
    .map((entry) => ({ ...entry, version: sourceById.get(entry.sourceId)!.version }))
  for (const id of policy.requiredStakeholderIds)
    if (!stakeholderEvidence.some((entry) => entry.stakeholderId === id))
      reasons.push(`Input from required stakeholder ${id} is still needed.`)

  const option = policy.options.find((candidate) => candidate.id === assessment.choiceId)
  if (policy.mode === 'delegate') {
    if (activity.executor !== 'sky') reasons.push('This decision is assigned to a human.')
    if (policy.activityTitle !== activity.title) reasons.push('The decision changed after its authority was granted.')
    if (!['ready', 'waiting'].includes(activity.state))
      reasons.push('This decision has not been accepted as ready work.')
    if (input.prerequisitesSatisfied !== true) reasons.push('Required results have not been verified as available.')
    if (!policy.instruction.trim()) reasons.push('The delegated decision needs an explicit scope instruction.')
    if (!option) reasons.push('The selected option is outside the explicitly delegated choices.')
    if (option && riskLevel[option.risk] > riskLevel[policy.maxRisk])
      reasons.push('The selected option exceeds the permitted risk threshold.')
    if (
      option?.amount !== undefined &&
      (policy.maxAmount === undefined || option.amount > policy.maxAmount || option.currency !== policy.currency)
    )
      reasons.push('The selected option exceeds the monetary authority or uses an unapproved currency.')
    if (assessment.confidence < policy.minConfidence)
      reasons.push('The recommendation falls below the configured confidence threshold.')
    if (
      policy.expiresAt &&
      new PlainDateTime(policy.expiresAt).normalize().toString() <= new PlainDateTime(input.now).normalize().toString()
    )
      reasons.push('The delegated decision authority has expired.')
    if (assessment.requiresHuman)
      reasons.push(assessment.escalationReason || 'Sky identified a consequential judgment for the owner.')
  }
  if (assessment.contradictions.length) reasons.push('The supplied evidence contains unresolved contradictions.')
  if (assessment.escalationReason && policy.mode === 'delegate') reasons.push(assessment.escalationReason)
  const uniqueReasons = [...new Set(reasons)]
  const action = policy.mode !== 'delegate' ? 'recommend' : uniqueReasons.length ? 'escalate' : 'resolve'
  const record = DecisionRecordSchema.parse({
    id: `${runId}`,
    activityId: activity.id,
    question: activity.title,
    at: new PlainDateTime(input.now).normalize().toString(),
    actor: 'sky',
    runId,
    policyRevision,
    outcome: action === 'resolve' ? 'resolved' : action === 'escalate' ? 'escalated' : 'recommended',
    choiceId: option?.id ?? assessment.choiceId,
    choiceLabel:
      option?.label ?? assessment.options.find((candidate) => candidate.id === assessment.choiceId)?.label ?? '',
    recommendation: assessment.recommendation,
    rationale: assessment.rationale,
    confidence: assessment.confidence,
    options: assessment.options,
    evidence,
    assumptions,
    stakeholderEvidence,
    risks: assessment.risks,
    contradictions: assessment.contradictions,
    reasons: uniqueReasons,
  })
  return { action, reasons: uniqueReasons, record }
}

/** Applies only the evaluated result and appends attributable history. It never grants authority or rewrites a prior resolution. */
export function applyDecisionEvaluation<T extends DecisionActivity>(activity: T, evaluation: DecisionEvaluation): T {
  if (
    !evaluation.record ||
    evaluation.action === 'skip' ||
    activity.decisionResolution ||
    ['done', 'canceled'].includes(activity.state)
  )
    return activity
  if (activity.decisionHistory?.some((record) => record.runId === evaluation.record!.runId)) return activity
  const record = structuredClone(evaluation.record)
  const next = {
    ...activity,
    recommendation: record.recommendation,
    decisionAnalysis: record,
    decisionHistory: [...(activity.decisionHistory ?? []), record],
  }
  if (evaluation.action === 'resolve')
    return {
      ...next,
      state: 'done',
      result: `${record.choiceLabel}\n\n${record.rationale}`,
      waitingFor: '',
      decisionResolution: record,
    }
  return { ...next, waitingFor: evaluation.action === 'escalate' ? evaluation.reasons.join(' ') : activity.waitingFor }
}
