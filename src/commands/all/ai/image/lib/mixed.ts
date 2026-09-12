import { generateObject } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import { drawingCanvasSchema } from './drawing/mod.ts'
import { MAX_REF_IMAGES } from './options.ts'
import type { ImageReference } from './references.ts'

const PROMPT_FILE = new URL('../prompts/mixed.prompt.md', import.meta.url).pathname
const MIXED_PLAN_TIMEOUT_MS = 180_000

export const mixedImagePlanSchema = z
  .object({
    artworkPrompt: z
      .string()
      .min(1)
      .max(6000)
      .describe(
        'Complete artwork-only instructions, reserving layout space for precise overlays and omitting newly requested text and logos drawn there.',
      ),
    drawingPrompt: z
      .string()
      .min(1)
      .max(8000)
      .describe(
        'Complete precise overlay instructions, preserving all requested exact wording, geometry, layout and styling.',
      ),
    artworkScope: z
      .enum(['surface', 'objects'])
      .describe(
        'Surface repaints a coherent panel, background or illustration including negative space; objects changes isolated subjects while keeping surrounding content.',
      ),
    regenerateArtwork: z
      .boolean()
      .describe(
        'True for the first artwork generation or an artwork defect; false when an existing base can be reused for an overlay-only correction.',
      ),
    reason: z.string().min(1).max(600),
  })
  .strict()

export type MixedImagePlan = z.infer<typeof mixedImagePlanSchema>

export interface MixedImageRequest {
  prompt: string
  brief?: string
  width: number
  height: number
  refs: readonly ImageReference[]
  feedback?: string
  previousPlan?: MixedImagePlan
  complexity?: 'simple' | 'complex'
  signal?: AbortSignal
}

/** Plan the artwork and precise overlay separately so typography corrections can reuse a completed base. */
export async function planMixedImage(
  request: MixedImageRequest,
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<MixedImagePlan> {
  drawingCanvasSchema.parse(request)
  if (request.refs.length > MAX_REF_IMAGES + 1)
    throw new Error(
      `Mixed image planning supports at most ${MAX_REF_IMAGES + 1} reference images, including current artwork.`,
    )
  if (request.prompt.length + (request.brief?.length ?? 0) + (request.feedback?.length ?? 0) > 32_000) {
    throw new Error('Mixed image planning instructions exceed 32000 characters.')
  }
  const previousPlan = request.previousPlan ? mixedImagePlanSchema.parse(request.previousPlan) : undefined
  const timeout = AbortSignal.timeout(MIXED_PLAN_TIMEOUT_MS)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  signal.throwIfAborted()
  const previews = await Promise.all(
    request.refs.map(async (reference) => {
      if (reference.data.byteLength > 50 * 1024 * 1024) throw new Error('Mixed image reference exceeds 50 MB.')
      return sharp(reference.data)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .png()
        .timeout({ seconds: 30 })
        .toBuffer()
    }),
  )
  signal.throwIfAborted()
  const instructions = options.instructions ?? parsePromptFile(await readPromptFile(PROMPT_FILE), PROMPT_FILE).body
  const { object } = await generateObject({
    ...(options.model ??
      aiModelByProfile(request.complexity === 'simple' ? 'default-gpt-6-astra-low' : 'default-gpt-6-astra-high')),
    instructions,
    schema: mixedImagePlanSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompt: request.prompt,
              brief: request.brief,
              width: request.width,
              height: request.height,
              feedback: request.feedback,
              previousPlan,
              artworkAvailable: !!previousPlan,
              imageOrder: request.refs.map((reference, index) => ({
                name: reference.name,
                role:
                  previousPlan && index === 0 ? 'current artwork available for reuse' : 'original or style reference',
              })),
            }),
          },
          ...previews.map((data) => ({
            type: 'file' as const,
            mediaType: 'image',
            data: { type: 'data' as const, data },
            providerOptions: { openai: { imageDetail: 'high' } },
          })),
        ],
      },
    ],
    maxOutputTokens: 16_000,
    maxRetries: 1,
    abortSignal: signal,
  })
  signal.throwIfAborted()
  const plan = mixedImagePlanSchema.parse(object)
  if (!previousPlan) return { ...plan, regenerateArtwork: true }
  // Reusing a raster also reuses the prompt that created it. Do not record a
  // silently revised artwork description for pixels that were never regenerated.
  return plan.regenerateArtwork
    ? plan
    : { ...plan, artworkPrompt: previousPlan.artworkPrompt, artworkScope: previousPlan.artworkScope }
}
