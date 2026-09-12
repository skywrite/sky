import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { finishImageEdit } from './finish.ts'
import type { ImageReviewSummary } from './finish.ts'
import { focusImageEdit } from './focus.ts'
import { validateEditMask } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import { MAX_REF_IMAGES } from './options.ts'
import type { IMAGE_MODELS, ImageBackground, ImageModelName, ImageQuality } from './options.ts'
import type { ImageReference } from './references.ts'
import { reviewImageEdit } from './review.ts'

export interface ImageRenderRequest {
  prompt: string
  brief?: string
  model: (typeof IMAGE_MODELS)[ImageModelName]
  quality: ImageQuality
  size?: string
  background?: ImageBackground
  count: number
  refs: readonly ImageReference[]
  edit?: MaskedImageEdit
  signal?: AbortSignal
  onProgress?: (message: string) => void
  finish?: boolean
  focus?: boolean
  feedback?: string
}

export interface RenderedImage {
  data: Uint8Array
  /** Provider output before optional compositing; also the final image for ordinary generation and edits. */
  generated: Uint8Array
  generationPrompt: string
  background?: ImageBackground
  mask?: ImageReference
  review?: ImageReviewSummary
  providerGenerated?: Uint8Array
  focus?: {
    size: string
    description: string
    geometry: {
      source: { left: number; top: number; width: number; height: number }
      padding: { left: number; top: number; right: number; bottom: number }
    }
  }
}

/** Both endpoints return PNG bytes; reference uploads must carry a filename and MIME type. */
export async function renderImages(
  request: ImageRenderRequest,
  client = new OpenAI(),
  reviewer: typeof reviewImageEdit = reviewImageEdit,
): Promise<RenderedImage[]> {
  request.signal?.throwIfAborted()
  let refs = [...request.refs]
  let prompt = request.prompt
  let background = request.background
  if (request.edit) {
    if (!refs.length) throw new Error('A masked edit requires a reference image.')
    await validateEditMask(request.edit.mask.data, request.edit.canvas)
    await validateEditMask((request.edit.generationMask ?? request.edit.mask).data, request.edit.canvas)
    const canvas = await sharp(request.edit.canvas.data).metadata()
    if (request.size !== `${canvas.width}x${canvas.height}`)
      throw new Error('A masked edit requires the exact canvas output size.')
    // Auto can paint a checkerboard instead of alpha. Preserve real transparency
    // through the API setting, while honoring an explicit background choice.
    if ((!background || background === 'auto') && canvas.hasAlpha) {
      const { isOpaque } = await sharp(request.edit.canvas.data).stats()
      if (!isOpaque) background = 'transparent'
    }
    refs[0] = request.edit.canvas
    prompt +=
      '\n\nEdit image 1 in place using the supplied alpha mask. Transparent areas provide working space for the complete requested change, including its new silhouette and necessary local transitions; not every pixel in that space needs to change. Opaque areas must stay fixed. Preserve the exact canvas dimensions, framing and alignment. Do not move, rescale or redraw protected regions. Retain the original medium, palette, linework, typography and transparency where applicable. Match the edited edges to the source style.'
    if (request.edit.plan)
      prompt += `\nPlanned change: ${request.edit.plan.changes}\nRequired result: ${request.edit.plan.requirements.join('; ')}`
    const original = request.refs[0]!
    const source = await sharp(original.data).metadata()
    if ((source.width !== canvas.width || source.height !== canvas.height) && refs.length < MAX_REF_IMAGES) {
      refs.push(original)
      prompt += ` Image ${refs.length} is the full-resolution original for detail reference only; image 1 remains the editing canvas.`
    }
  }
  const focused =
    request.edit && request.focus && refs.length < MAX_REF_IMAGES
      ? await focusImageEdit(request.edit, { signal: request.signal })
      : undefined
  if (focused && request.edit) {
    refs[0] = focused.canvas
    refs.push(request.edit.canvas)
    prompt += `\nImage 1 is a focused editing crop. ${focused.description} Image ${refs.length} is the complete original canvas for context only. Any full-scene coordinates or dimensions in the request or brief refer to that context image. Return the crop at exactly ${focused.size}, with its position, framing and surrounding context unchanged.`
    request.onProgress?.('Editing a focused area with the full image available for context…')
  }
  if (request.feedback)
    prompt += `\nCorrections from the previous attempt (keep the original request and protected areas):\n${request.feedback}`
  request.signal?.throwIfAborted()
  const params = {
    model: request.model,
    prompt,
    n: request.count,
    size: focused?.size ?? request.size ?? 'auto',
    quality: request.quality,
    background,
    output_format: 'png' as const,
  }
  const options = { signal: request.signal }
  const response = refs.length
    ? await client.images.edit(
        {
          ...params,
          // The AI SDK image adapter converts inputs to unnamed Blobs.
          // Bun serializes those with filename="", which OpenAI rejects.
          image: await Promise.all(refs.map((ref) => toFile(ref.data, ref.name, { type: ref.mediaType }))),
          ...(request.edit
            ? {
                mask: await toFile(
                  (focused?.mask ?? request.edit.generationMask ?? request.edit.mask).data,
                  'generation-mask.png',
                  {
                    type: 'image/png',
                  },
                ),
              }
            : {}),
        },
        options,
      )
    : await client.images.generate(params, options)
  const images: RenderedImage[] = []
  for (const image of response.data ?? []) {
    request.signal?.throwIfAborted()
    if (!image.b64_json) throw new Error('OpenAI returned an image without PNG data.')
    const providerGenerated = new Uint8Array(Buffer.from(image.b64_json, 'base64'))
    const bytes = focused ? await focused.restore(providerGenerated, request.signal) : providerGenerated
    const finished =
      request.edit && request.finish !== false
        ? await finishImageEdit(
            {
              prompt: request.prompt,
              brief: request.brief,
              generated: bytes,
              edit: request.edit,
              signal: request.signal,
              onProgress: request.onProgress,
            },
            reviewer,
          )
        : { data: bytes }
    images.push({
      ...finished,
      generated: bytes,
      generationPrompt: prompt,
      background,
      ...(focused
        ? {
            providerGenerated,
            focus: { size: focused.size, description: focused.description, geometry: focused.geometry },
          }
        : {}),
    })
  }
  return images
}
