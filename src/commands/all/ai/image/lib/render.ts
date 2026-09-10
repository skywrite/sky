import OpenAI, { toFile } from 'openai'
import sharp from 'sharp'
import { compositeImageEdit, validateEditMask } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import { MAX_REF_IMAGES } from './options.ts'
import type { IMAGE_MODELS, ImageBackground, ImageModelName, ImageQuality } from './options.ts'
import type { ImageReference } from './references.ts'

interface ImageRenderRequest {
  prompt: string
  model: (typeof IMAGE_MODELS)[ImageModelName]
  quality: ImageQuality
  size?: string
  background?: ImageBackground
  count: number
  refs: readonly ImageReference[]
  edit?: MaskedImageEdit
  signal?: AbortSignal
}

/** Both endpoints return PNG bytes; reference uploads must carry a filename and MIME type. */
export async function renderImages(request: ImageRenderRequest, client = new OpenAI()): Promise<Uint8Array[]> {
  request.signal?.throwIfAborted()
  let refs = [...request.refs]
  let prompt = request.prompt
  if (request.edit) {
    if (!refs.length) throw new Error('A masked edit requires a reference image.')
    await validateEditMask(request.edit.mask.data, request.edit.canvas)
    const canvas = await sharp(request.edit.canvas.data).metadata()
    if (request.size !== `${canvas.width}x${canvas.height}`)
      throw new Error('A masked edit requires the exact canvas output size.')
    refs[0] = request.edit.canvas
    prompt +=
      '\n\nEdit image 1 in place using the supplied alpha mask. Transparent mask areas may change; opaque areas must stay fixed. Preserve the exact canvas dimensions, camera, framing and alignment. Do not move, rescale or redraw protected regions. Match changes to the existing scene at the mask boundary.'
    const original = request.refs[0]!
    const source = await sharp(original.data).metadata()
    if ((source.width !== canvas.width || source.height !== canvas.height) && refs.length < MAX_REF_IMAGES) {
      refs.push(original)
      prompt += ` Image ${refs.length} is the full-resolution original for detail reference only; image 1 remains the editing canvas.`
    }
  }
  request.signal?.throwIfAborted()
  const params = {
    model: request.model,
    prompt,
    n: request.count,
    size: request.size ?? 'auto',
    quality: request.quality,
    background: request.background,
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
            ? { mask: await toFile(request.edit.mask.data, request.edit.mask.name, { type: 'image/png' }) }
            : {}),
        },
        options,
      )
    : await client.images.generate(params, options)
  const images: Uint8Array[] = []
  for (const image of response.data ?? []) {
    request.signal?.throwIfAborted()
    if (!image.b64_json) throw new Error('OpenAI returned an image without PNG data.')
    const bytes = new Uint8Array(Buffer.from(image.b64_json, 'base64'))
    images.push(request.edit ? await compositeImageEdit(bytes, request.edit, request.signal) : bytes)
  }
  return images
}
