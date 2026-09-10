import { generateObject } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import type { ImageReference } from './references.ts'

const PROMPT_FILE = new URL('../prompts/mask.prompt.md', import.meta.url).pathname
const MASK_TIMEOUT_MS = 120_000
const point = z.object({ x: z.number().min(0).max(1000), y: z.number().min(0).max(1000) })
export const imageRegionSchema = z.object({
  label: z.string().min(1).max(120),
  points: z.array(point).min(3).max(160),
})

export const maskPlanSchema = z.object({
  scope: z.enum(['localized', 'whole_image', 'uncertain']),
  reason: z.string().min(1).max(400),
  changes: z
    .string()
    .min(1)
    .max(1200)
    .describe('The intended replacement, including its new silhouette, occlusions and style.'),
  requirements: z.array(z.string().min(1).max(240)).min(1).max(12),
  edges: z
    .enum(['hard', 'soft'])
    .describe('Hard edges for flat graphics and pixel art; soft transitions for photographs and painted textures.'),
  generationRegions: z
    .array(imageRegionSchema)
    .max(32)
    .describe('Working space including the old extent, complete new silhouette and local transitions.'),
  editRegions: z.array(imageRegionSchema).max(32).describe('Expected final edit footprint, inside the working space.'),
  protectedRegions: z.array(imageRegionSchema).max(32),
})
export type ImageMaskPlan = z.infer<typeof maskPlanSchema>

export interface ImageMaskRequest {
  prompt: string
  brief?: string
  /** The exact output canvas: all coordinates refer to this image. */
  reference: ImageReference
  complexity?: 'simple' | 'complex'
  signal?: AbortSignal
}

/** A separate, detailed view is required for boundaries; never reuse the selector's 512px preview. */
export async function planImageMask(
  request: ImageMaskRequest,
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<ImageMaskPlan> {
  const timeout = AbortSignal.timeout(MASK_TIMEOUT_MS)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  signal.throwIfAborted()
  const preview = await sharp(request.reference.data)
    .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
    .png()
    .timeout({ seconds: 30 })
    .toBuffer()
  signal.throwIfAborted()
  const instructions = options.instructions ?? parsePromptFile(await readPromptFile(PROMPT_FILE), PROMPT_FILE).body
  const { object } = await generateObject({
    ...(options.model ??
      aiModelByProfile(request.complexity === 'simple' ? 'default-gpt-6-astra-low' : 'default-gpt-6-astra-high')),
    instructions,
    schema: maskPlanSchema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: JSON.stringify({ prompt: request.prompt, brief: request.brief }) },
          {
            type: 'file',
            mediaType: 'image',
            data: { type: 'data', data: preview },
            providerOptions: { openai: { imageDetail: 'high' } },
          },
        ],
      },
    ],
    maxOutputTokens: 16_000,
    maxRetries: 1,
    abortSignal: signal,
  })
  signal.throwIfAborted()
  return object
}
