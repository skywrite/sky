import { generateObject } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import type { MaskedImageEdit } from './mask.ts'
import { imageRegionSchema } from './maskPlan.ts'

const PROMPT_FILE = new URL('../prompts/review.prompt.md', import.meta.url).pathname
const REVIEW_TIMEOUT_MS = 120_000

export const imageReviewSchema = z.object({
  verdict: z.enum(['pass', 'revise_mask', 'needs_revision', 'uncertain']),
  reason: z.string().min(1).max(600),
  checks: z
    .array(
      z.object({
        requirement: z.string().min(1).max(240),
        passed: z.boolean(),
        detail: z.string().min(1).max(400),
      }),
    )
    .min(1)
    .max(16),
  editRegions: z
    .array(imageRegionSchema)
    .max(32)
    .describe('Only for revise_mask: the complete final footprint in the raw image, including old content to erase.'),
})
export type ImageEditAssessment = z.infer<typeof imageReviewSchema>

export interface ImageReviewRequest {
  prompt: string
  brief?: string
  edit: MaskedImageEdit
  generated: Uint8Array
  composite: Uint8Array
  allowMaskRevision: boolean
  signal?: AbortSignal
}

/** Show the permitted footprint in cyan; alpha-only masks are otherwise hard to interpret visually. */
async function workingArea(edit: MaskedImageEdit): Promise<Uint8Array> {
  const { width, height } = await sharp(edit.canvas.data).metadata()
  const alpha = await sharp((edit.generationMask ?? edit.mask).data)
    .extractChannel('alpha')
    .raw()
    .toBuffer()
  const overlay = Buffer.alloc(alpha.length * 4)
  for (let i = 0; i < alpha.length; i++) {
    overlay[i * 4 + 1] = 200
    overlay[i * 4 + 2] = 255
    overlay[i * 4 + 3] = Math.round((255 - alpha[i]!) * 0.4)
  }
  return sharp(edit.canvas.data)
    .composite([{ input: overlay, raw: { width, height, channels: 4 } }])
    .png()
    .toBuffer()
}

/** Judge the visible final result separately from the raw model output; suggest at most a mask correction. */
export async function reviewImageEdit(
  request: ImageReviewRequest,
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<ImageEditAssessment> {
  const timeout = AbortSignal.timeout(REVIEW_TIMEOUT_MS)
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
  signal.throwIfAborted()
  const inputs = [request.edit.canvas.data, request.generated, request.composite, await workingArea(request.edit)]
  const previews = await Promise.all(
    inputs.map((data) =>
      sharp(data)
        .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
        .png()
        .timeout({ seconds: 30 })
        .toBuffer(),
    ),
  )
  signal.throwIfAborted()
  const instructions = options.instructions ?? parsePromptFile(await readPromptFile(PROMPT_FILE), PROMPT_FILE).body
  const { object } = await generateObject({
    ...(options.model ??
      aiModelByProfile(request.edit.complexity === 'simple' ? 'default-gpt-6-astra-low' : 'default-gpt-6-astra-high')),
    instructions,
    schema: imageReviewSchema,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              prompt: request.prompt,
              brief: request.brief,
              plan: request.edit.plan,
              description: request.edit.description,
              allowMaskRevision: request.allowMaskRevision,
              imageOrder: [
                'original',
                'raw generation',
                'final composite to review',
                'original with permitted working area in cyan',
              ],
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
    maxOutputTokens: 12_000,
    maxRetries: 1,
    abortSignal: signal,
  })
  signal.throwIfAborted()
  return object
}
