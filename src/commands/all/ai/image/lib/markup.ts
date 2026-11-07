import sharp from 'sharp'
import { MAX_MARKUP_PIXELS } from '#universal/ai/imageMarkup.ts'
import { MAX_REF_BYTES } from './options.ts'
import type { ImageReference } from './references.ts'

/** Markup is an annotation layer, not an alpha mask. Never resize it independently of its source. */
export async function validateImageMarkup(data: Uint8Array, reference: ImageReference): Promise<void> {
  if (data.length > MAX_REF_BYTES) throw new Error('The markup PNG must be 50 MB or less.')
  const [source, overlay] = await Promise.all([
    sharp(reference.data, { limitInputPixels: MAX_MARKUP_PIXELS }).metadata(),
    sharp(data, { limitInputPixels: MAX_MARKUP_PIXELS }).metadata(),
  ])
  if (overlay.format !== 'png' || !overlay.hasAlpha) throw new Error('Markup must be a transparent PNG overlay.')
  if (source.width * source.height > MAX_MARKUP_PIXELS || overlay.width * overlay.height > MAX_MARKUP_PIXELS)
    throw new Error('Photo markup supports images up to 16 megapixels. Use a smaller photo.')
  if (source.width !== overlay.width || source.height !== overlay.height)
    throw new Error(
      'The markup PNG must match the first reference’s dimensions after orientation. Reopen Mark up on the original photo.',
    )
  if ((await sharp(data).stats()).isOpaque)
    throw new Error('Markup must contain transparent pixels; keep the photo separate.')
}
