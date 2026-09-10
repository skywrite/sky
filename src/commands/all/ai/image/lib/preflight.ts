import { generateObject } from 'ai'
import { z } from 'zod'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import { IMAGE_MODELS, RENDER_QUALITIES } from './options.ts'
import type { ImageModelName, ImageQuality } from './options.ts'

const PROMPT_FILE = new URL('../prompts/preflight.prompt.md', import.meta.url).pathname
const PREFLIGHT_TIMEOUT_MS = 45_000

const decisionSchema = z.object({
  intent: z
    .enum(['create', 'transform', 'preserve_photo', 'other_edit'])
    .describe('preserve_photo means editing an original photograph while maintaining its fidelity.'),
  model: z.enum(['flare', 'sunburst']),
  quality: z.enum(RENDER_QUALITIES),
  reason: z.string().min(1).max(280).describe('One short sentence explaining the selection.'),
})

export type ImageDecision = z.infer<typeof decisionSchema>

export interface ImageSelectionRequest {
  prompt: string
  /** Purpose, speed/budget priorities, preservation requirements, and relevant prior edits. */
  brief?: string
  refs: Uint8Array[]
  model?: ImageModelName
  quality?: ImageQuality
  size?: string
  background?: string
  count: number
  signal?: AbortSignal
}

export interface ImageSelection {
  intent: ImageDecision['intent']
  model: (typeof IMAGE_MODELS)[ImageModelName]
  quality: ImageQuality
  reason: string
}

/** Astra judges the brief and references; it never generates or rewrites the image prompt. */
export async function preflightImage(
  request: ImageSelectionRequest,
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<ImageDecision> {
  const timeout = AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  signal.throwIfAborted()
  const instructions = options.instructions ?? parsePromptFile(await readPromptFile(PROMPT_FILE), PROMPT_FILE).body
  const { object } = await generateObject({
    ...(options.model ?? aiModelByProfile('default-gpt-6-astra-low')),
    schema: decisionSchema,
    instructions,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompt: request.prompt,
              brief: request.brief,
              referenceCount: request.refs.length,
              explicitModel: request.model,
              explicitQuality: request.quality,
              size: request.size,
              background: request.background,
              count: request.count,
            }),
          },
          ...request.refs.map((data) => ({
            type: 'file' as const,
            mediaType: 'image',
            data: { type: 'data' as const, data },
            providerOptions: { openai: { imageDetail: 'low' } },
          })),
        ],
      },
    ],
    maxOutputTokens: 2_000,
    maxRetries: 1,
    abortSignal: signal,
  })
  signal.throwIfAborted()
  return object
}

export async function selectImageSettings(
  request: ImageSelectionRequest,
  preflight: (request: ImageSelectionRequest) => Promise<ImageDecision> = preflightImage,
): Promise<ImageSelection> {
  request.signal?.throwIfAborted()
  if (request.model && request.quality && !request.refs.length) {
    return {
      intent: 'create',
      model: IMAGE_MODELS[request.model],
      quality: request.quality,
      reason: 'Explicit model and quality requested; preflight skipped.',
    }
  }

  const decision = await preflight(request)
  request.signal?.throwIfAborted()
  // References alone do not imply fidelity preservation: a photograph turned
  // into an illustration is a transformation. Enforce the photograph policy
  // after classification, then honor any deliberate setting overrides.
  const preservePhoto = request.refs.length > 0 && decision.intent === 'preserve_photo'
  const model = request.model ?? (preservePhoto ? 'sunburst' : decision.model)
  const quality = request.quality ?? (preservePhoto ? 'max' : decision.quality)
  const overrides = [
    ...(request.model ? [`model ${request.model}`] : []),
    ...(request.quality ? [`quality ${request.quality}`] : []),
  ]
  const reason = preservePhoto
    ? "Preserving the original photograph's fidelity calls for Sunburst/max."
    : decision.reason
  return {
    intent: request.refs.length ? decision.intent : 'create',
    model: IMAGE_MODELS[model],
    quality,
    reason: `${reason}${overrides.length ? ` Explicit ${overrides.join(' and ')} honored.` : ''}`,
  }
}
