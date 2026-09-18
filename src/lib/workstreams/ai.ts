import { generateObject, generateText, NoObjectGeneratedError } from 'ai'
import { z } from 'zod'
import { getProfile, resolveProfile } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import { ActionAssessmentSchema, type ActionAssessment } from './actionOutcome.ts'
import { CoordinationProposalSchema, groundCoordination } from './coordination.ts'
import { DecisionAssessmentSchema } from './decisionPolicy.ts'
import { workstreamGenerationSchema } from './generationSchema.ts'
import { Id, RelationshipKind, WorkstreamError } from './types.ts'

const ActivityProposalSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().max(2400),
  executor: z.enum(['human', 'sky']),
})
const DecisionProposalSchema = z.object({
  question: z.string().min(1).max(500),
  context: z.string().max(2400),
  recommendation: z.string().max(2400),
})
const RelationshipProposalSchema = z.object({
  workstreamId: z.string().max(100),
  kind: z.enum([...RelationshipKind.options, 'child']),
  reason: z.string().max(1000),
  activityId: Id.optional(),
  requiredActivityId: Id.optional(),
  requiredResult: z.string().max(2400).optional(),
})

export const WorkstreamDraftSchema = z.object({
  title: z.string().min(1).max(160),
  outcome: z.string().min(1).max(2400),
  understanding: z.string().max(6000),
  unknowns: z.array(z.string().max(800)).max(8),
  activities: z.array(ActivityProposalSchema).max(2),
  decisions: z.array(DecisionProposalSchema).max(2),
  coordination: CoordinationProposalSchema.optional(),
  relationships: z.array(RelationshipProposalSchema).max(6),
  suggestions: z.array(z.string().max(1000)).max(6),
  subworkstreams: z
    .array(z.object({ title: z.string().min(1).max(200), outcome: z.string().max(2400), reason: z.string().max(1200) }))
    .max(2),
})

export const WorkstreamReviewSchema = z.object({
  summary: z.string().min(1).max(2400),
  understanding: z.string().max(6000),
  outcomeSuggestion: z.string().max(2400),
  unknowns: z.array(z.string().max(800)).max(8),
  activities: z.array(ActivityProposalSchema).max(2),
  decisions: z.array(DecisionProposalSchema).max(2),
  decisionAssessments: z.array(DecisionAssessmentSchema).max(2).optional(),
  coordination: CoordinationProposalSchema.optional(),
  relationships: z.array(RelationshipProposalSchema).max(6),
  suggestions: z.array(z.string().max(1000)).max(6),
  subworkstreams: z
    .array(z.object({ title: z.string().min(1).max(200), outcome: z.string().max(2400), reason: z.string().max(1200) }))
    .max(2),
  artifact: z
    .object({
      title: z.string().min(1).max(180),
      body: z.string().min(1).max(24_000),
      activityId: z.string().max(100),
    })
    .nullable(),
  communication: z
    .object({
      activityId: z.string().min(1).max(100),
      title: z.string().min(1).max(180),
      draft: z.string().min(1).max(16_000),
      medium: z.enum(['Email', 'Slack']),
      destination: z.string().max(1000),
      sourceRef: z.string().max(2000),
    })
    .nullable(),
  waitingFor: z.string().max(1200),
  nextCheckMinutes: z.number().int().min(15).max(10_080),
})

export const WorkstreamReportSchema = z.object({
  title: z.string().min(1).max(180),
  body: z.string().min(1).max(24_000),
  missingInputs: z.array(z.string().max(1000)).max(10),
})

export type WorkstreamDraft = z.infer<typeof WorkstreamDraftSchema>
export type WorkstreamReview = z.infer<typeof WorkstreamReviewSchema>
export type WorkstreamReport = z.infer<typeof WorkstreamReportSchema>
export type WorkstreamAIContext = Record<string, unknown>
export type WorkstreamProposer = (context: WorkstreamAIContext, signal?: AbortSignal) => Promise<WorkstreamReview>
export type WorkstreamReporter = (context: WorkstreamAIContext, signal?: AbortSignal) => Promise<WorkstreamReport>
export type ActionAssessor = (context: WorkstreamAIContext, signal?: AbortSignal) => Promise<ActionAssessment>

async function instructions(name: 'draft' | 'review' | 'report' | 'verify-action'): Promise<string> {
  const file = new URL(`./prompts/${name}.prompt.md`, import.meta.url).pathname
  return renderPromptFile(await readPromptFile(file), file, {}).output
}

/** Reuses Sky's configured models, prompt overrides, usage accounting, and provider middleware. */
export async function draftWorkstream(context: WorkstreamAIContext): Promise<WorkstreamDraft> {
  const profile = getProfile('default-cerebras-qwen-3.8')
  // Keep capture quick without changing the shared profile or an explicit provider/model override.
  const captureProfile =
    profile.provider === 'cerebras' && profile.model === 'qwen-3.8-27b'
      ? { ...profile, options: { ...profile.options, reasoningEffort: 'none' as const } }
      : profile
  const result = await generateText({
    ...resolveProfile(captureProfile, { maxRetries: 0, maxOutputTokens: 6000 }),
    instructions: `${await instructions('draft')}\n\nReturn exactly one JSON object matching this schema, without Markdown fences or prose outside the object.\n${JSON.stringify(z.toJSONSchema(WorkstreamDraftSchema, { target: 'draft-07' }))}`,
    prompt: JSON.stringify(context),
    abortSignal: AbortSignal.timeout(60_000),
  })
  const draft = WorkstreamDraftSchema.parse(JSON.parse(result.text.trim()))
  if (draft.coordination) draft.coordination = groundCoordination(draft.coordination, context)
  return draft
}

export const proposeWorkstream: WorkstreamProposer = async (context, signal) => {
  const review = await generateOngoingWork('review', WorkstreamReviewSchema, context, signal)
  if (review.coordination) review.coordination = groundCoordination(review.coordination, context)
  return review
}

export const prepareWorkstreamReport: WorkstreamReporter = (context, signal) =>
  generateOngoingWork('report', WorkstreamReportSchema, context, signal)

/** A separate assessment reads the actual deliverable; generating something is never itself proof of completion. */
export const assessWorkstreamAction: ActionAssessor = (context, signal) =>
  generateOngoingWork('verify-action', ActionAssessmentSchema, context, signal)

async function generateOngoingWork<T extends z.ZodType>(
  purpose: 'review' | 'report' | 'verify-action',
  validator: T,
  context: WorkstreamAIContext,
  signal = AbortSignal.timeout(60_000),
): Promise<z.output<T>> {
  signal.throwIfAborted()
  const profile = getProfile('default-gpt-6-astra-high')
  // Leave room for reasoning as well as the visible result; preserve the user's named profile override.
  const model = resolveProfile(profile, { maxRetries: 0, maxOutputTokens: 16_000 })
  const guidance = await instructions(purpose)
  // The composite review shape needs a structural provider grammar, with all bounds enforced locally.
  const schema = workstreamGenerationSchema(validator)
  let incomplete = false
  for (let attempt = 0; attempt < 2; attempt += 1) {
    signal.throwIfAborted()
    try {
      const result = await generateObject({
        ...model,
        output: 'object',
        schema,
        instructions: `${guidance}\n\nReturn a complete, concise structured result. Use null for optional fields that do not apply.${attempt ? ' The previous response was incomplete or invalid. Regenerate a compact complete result; shorten prose and omit unnecessary proposals.' : ''}`,
        prompt: JSON.stringify(context),
        abortSignal: signal,
      })
      signal.throwIfAborted()
      checkFinishReason(result.finishReason)
      if (result.finishReason !== 'length') return result.object
      incomplete = true
    } catch (error) {
      signal.throwIfAborted()
      if (!NoObjectGeneratedError.isInstance(error)) throw error
      checkFinishReason(error.finishReason)
      incomplete = error.finishReason === 'length'
    }
    // Only pure generation is repeated. No controller state, artifacts, decisions, or Outbox effects have run.
  }
  throw new WorkstreamError(
    incomplete
      ? 'Sky’s response was cut off twice. Try again with a smaller next step.'
      : 'Sky could not produce a usable workstream response after retrying. Try again.',
    503,
  )
}

function checkFinishReason(reason: string | undefined): void {
  if (reason === 'content-filter') {
    throw new WorkstreamError(
      'The model could not provide this workstream response. Review the request before retrying.',
      503,
    )
  }
  if (reason === 'error' || reason === 'tool-calls') {
    throw new WorkstreamError('The model did not finish this workstream response. Try again.', 503)
  }
}
