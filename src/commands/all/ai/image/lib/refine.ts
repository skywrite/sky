import { generateObject } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { aiModelByProfile } from '#shared/ai/models.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { readPromptFile } from '#shared/prompts/load.ts'
import { parsePromptFile } from '#shared/prompts/parse.ts'
import { limitEditMask, maskFromPlan, validateEditMask } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import { imageRegionSchema } from './maskPlan.ts'
import type { ImageReference } from './references.ts'

const PROMPT_FILE = new URL('../prompts/refine.prompt.md', import.meta.url).pathname

export const imageRefinementSchema = z.object({
  confidence: z.enum(['high', 'uncertain']),
  reason: z.string().min(1).max(600),
  edges: z.enum(['contours', 'transparent_object']),
  editRegions: z.array(imageRegionSchema).max(32),
})
export type ImageMaskRefinement = z.infer<typeof imageRefinementSchema>

export interface ImageRefinementRequest {
  edit: MaskedImageEdit
  generated: Uint8Array
  prompt: string
  brief?: string
  signal?: AbortSignal
}

/**
 * Trace the observed old/new footprint, never expand the immutable workspace.
 * Alpha snapping is only suitable for isolated artwork on transparent backgrounds;
 * opaque photographs retain the model contours. This is not semantic segmentation.
 */
export async function refineMaskFromContours(
  request: ImageRefinementRequest,
  refinement: ImageMaskRefinement,
): Promise<ImageReference> {
  const { edit, signal } = request
  signal?.throwIfAborted()
  if (!edit.plan || !edit.generationMask || refinement.confidence !== 'high' || !refinement.editRegions.length) {
    return edit.mask
  }
  const [sourceSize, generatedSize] = await Promise.all([
    sharp(edit.canvas.data).metadata(),
    sharp(request.generated).metadata(),
  ])
  if (sourceSize.width !== generatedSize.width || sourceSize.height !== generatedSize.height) return edit.mask
  const plan = { ...edit.plan, editRegions: refinement.editRegions }
  let result = await limitEditMask(
    await maskFromPlan(plan, edit.canvas, signal),
    edit.generationMask,
    edit.canvas,
    signal,
  )
  if (refinement.edges === 'transparent_object') {
    const [base, generated, alpha] = await Promise.all([
      sharp(edit.canvas.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(request.generated).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
      sharp(result.data).extractChannel('alpha').raw().toBuffer(),
    ])
    if (base.info.width !== generated.info.width || base.info.height !== generated.info.height) return edit.mask
    let sourceClear = 0
    let generatedClear = 0
    let candidatePixels = 0
    for (let i = 0; i < alpha.length; i++) {
      const offset = i * 4 + 3
      const oldAlpha = base.data[offset]!
      const newAlpha = generated.data[offset]!
      if (alpha[i] !== 255) {
        candidatePixels++
        if (oldAlpha === 0) sourceClear++
        if (newAlpha === 0) generatedClear++
      }
    }
    // An opaque background or incidental transparent pixel is not evidence of an isolated silhouette.
    if (sourceClear > candidatePixels * 0.1 && generatedClear > candidatePixels * 0.1) {
      // The artwork's own alpha already antialiases the silhouette; do not feather it a second time.
      const bounded = await limitEditMask(
        await maskFromPlan({ ...plan, edges: 'hard' }, edit.canvas, signal),
        edit.generationMask,
        edit.canvas,
        signal,
      )
      const boundary = await sharp(bounded.data).extractChannel('alpha').raw().toBuffer()
      const rgba = Buffer.alloc(alpha.length * 4)
      for (let i = 0; i < alpha.length; i++) {
        const offset = i * 4 + 3
        // Removing the old extent is part of the edit, even where the new image is fully transparent.
        rgba[offset] = base.data[offset]! > 0 || generated.data[offset]! > 0 ? boundary[i]! : 255
      }
      const data = await sharp(rgba, { raw: { width: base.info.width, height: base.info.height, channels: 4 } })
        .png()
        .toBuffer()
      await validateEditMask(data, edit.canvas)
      result = { name: 'refined-mask.png', mediaType: 'image/png', data }
    }
  }
  signal?.throwIfAborted()
  return { ...result, name: 'refined-mask.png' }
}

/** Inference is optional after generation: preserve the existing mask on outage, but honor user cancellation. */
export async function refineImageMask(
  request: ImageRefinementRequest,
  options: { model?: ResolvedModel; instructions?: string } = {},
): Promise<ImageReference> {
  request.signal?.throwIfAborted()
  if (!request.edit.plan || !request.edit.generationMask) return request.edit.mask
  try {
    const timeout = AbortSignal.timeout(120_000)
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout
    const previews = await Promise.all(
      [request.edit.canvas.data, request.generated].map((data) =>
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
        aiModelByProfile(
          request.edit.complexity === 'simple' ? 'default-gpt-6-astra-low' : 'default-gpt-6-astra-high',
        )),
      instructions,
      schema: imageRefinementSchema,
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
                imageOrder: ['original full canvas', 'raw generation aligned to the full canvas'],
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
    return await refineMaskFromContours({ ...request, signal }, object)
  } catch {
    request.signal?.throwIfAborted()
    return request.edit.mask
  }
}
