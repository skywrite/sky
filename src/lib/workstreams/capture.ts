import { generateText } from 'ai'
import { z } from 'zod'
import { getProfile, resolveProfile } from '#shared/ai/models.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { renderPromptFile } from '#shared/prompts/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { resolveCaptureHorizon } from './captureTiming.ts'
import {
  CAPTURE_HORIZON_CHOICES,
  CaptureHorizonSchema,
  CaptureQuestionSchema,
  CaptureRequestSchema,
  CaptureResponseSchema,
  type CaptureRequest,
  type CaptureResponse,
  type CaptureSource,
  type CaptureQuestion,
} from './captureTypes.ts'
import { WorkstreamError } from './types.ts'

export type CaptureContext = { sources: (CaptureSource & { content: string })[]; limited: boolean }
const CaptureModelSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    outcome: z.string().trim().min(1).max(500).nullable(),
    understanding: z.string().trim().max(280),
    horizon: CaptureHorizonSchema.nullable(),
    horizonEvidence: z.string().trim().max(500).nullable(),
    situationKnown: z.boolean(),
    question: CaptureQuestionSchema.extend({
      field: z.enum(['outcome', 'situation']),
      basis: z.enum(['missing-context', 'specific-gap', 'conflict']),
      evidence: z.string().trim().max(300),
    }).nullable(),
    sourceIds: z.array(z.string().min(1).max(160)).max(20),
  })
  .strict()

/** Questions are optional clarification, not a checklist the model must complete. */
export function resolveCapture(input: CaptureRequest, value: unknown, context: CaptureContext): CaptureResponse {
  const request = CaptureRequestSchema.parse(input)
  const model = CaptureModelSchema.parse(value)
  const answered = new Set(request.answers.map((answer) => answer.field))
  const horizon = resolveCaptureHorizon(request, model.horizon, model.horizonEvidence)
  const selected = new Set(model.sourceIds)
  const sources = context.sources.filter((source) => selected.has(source.id))
  const evidence = model.question?.evidence.replace(/\s+/g, ' ').trim()
  const groundedQuestion = Boolean(
    evidence &&
    [
      request.intent,
      ...request.answers.map((answer) => answer.answer),
      ...sources.map((source) => source.content),
    ].some((text) => text.replace(/\s+/g, ' ').includes(evidence)),
  )
  let question: CaptureQuestion | null = model.question
  if (
    question &&
    (answered.has(question.field) ||
      (model.question!.basis !== 'missing-context' && !groundedQuestion) ||
      (question.field === 'situation' && model.situationKnown && model.question!.basis === 'missing-context'))
  )
    question = null
  if (horizon === null && !answered.has('timing'))
    question = { field: 'timing', prompt: 'What time frame do you have in mind?', choices: CAPTURE_HORIZON_CHOICES }
  if (horizon === 'this-week' || request.answers.length >= 3) question = null
  // Capture preserves the owner's scope. Model wording is a separate suggestion requiring an explicit choice.
  let title = ''
  for (const character of request.intent.split(/\r?\n/, 1)[0]!) {
    if (title.length + character.length > 160) break
    title += character
  }
  const normalizeWords = (text: string) => text.replace(/\s+/g, ' ').trim()
  const suggestedOutcome =
    model.outcome && normalizeWords(model.outcome) !== normalizeWords(request.intent) ? model.outcome : null
  return CaptureResponseSchema.parse({
    title,
    outcome: request.intent,
    suggestedOutcome,
    understanding: model.understanding,
    horizon,
    horizonLabel: CAPTURE_HORIZON_CHOICES.find((choice) => choice.value === horizon)?.label ?? 'Timing not set',
    question,
    sources: sources.map(({ id, path, label }) => ({ id, path, label })),
    contextLimited: context.limited,
  })
}

/** Uses the configured profile and shared accounting while keeping this conversation short. */
export async function captureWorkstream(
  input: CaptureRequest,
  context: CaptureContext,
  today: PlainDate,
  signal?: AbortSignal,
): Promise<CaptureResponse> {
  const request = CaptureRequestSchema.parse(input)
  const timeout = AbortSignal.timeout(30_000)
  const abortSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  abortSignal.throwIfAborted()
  const file = new URL('./prompts/capture.prompt.md', import.meta.url).pathname
  const instructions = renderPromptFile(await readPromptFile(file), file, {}).output
  abortSignal.throwIfAborted()
  const profile = getProfile('default-cerebras-qwen-3.8')
  const captureProfile =
    profile.provider === 'cerebras' && profile.model === 'qwen-3.8-27b'
      ? { ...profile, options: { ...profile.options, reasoningEffort: 'none' as const } }
      : profile
  const result = await runWithUsageSource('workstreams:capture', () =>
    generateText({
      ...resolveProfile(captureProfile, { maxRetries: 0, maxOutputTokens: 1400 }),
      instructions: `${instructions}\n\nReturn exactly one JSON object matching this schema, without Markdown fences or extra prose.\n${JSON.stringify(z.toJSONSchema(CaptureModelSchema, { target: 'draft-07' }))}`,
      prompt: JSON.stringify({
        ...request,
        today: today.ymd,
        sources: context.sources,
        contextLimited: context.limited,
      }),
      abortSignal,
    }),
  )
  abortSignal.throwIfAborted()
  try {
    return resolveCapture(request, JSON.parse(result.text.trim()), context)
  } catch {
    throw new WorkstreamError(
      'Sky returned an incomplete starting point. Try again; your intention has not been saved.',
      503,
    )
  }
}
