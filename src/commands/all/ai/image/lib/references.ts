import * as path from 'node:path'
import sharp from 'sharp'
import { MAX_REF_BYTES } from './options.ts'

export interface ImageReference {
  name: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp'
  data: Uint8Array
}

/**
 * A camera JPEG can contain an HDR gain map/MPF image, an ICC profile, and
 * EXIF rotation. A filename and MIME type alone do not make it API-compatible.
 * Decode the main image, apply orientation and sRGB conversion, then encode
 * losslessly without metadata. Keep every pixel and any transparency; never
 * overwrite the original. The upload name must describe the converted bytes.
 */
export async function prepareReferenceImage(
  data: Uint8Array,
  name: string,
  signal?: AbortSignal,
): Promise<ImageReference> {
  signal?.throwIfAborted()
  const image = sharp(data).rotate().toColourspace('srgb').timeout({ seconds: 30 })
  const stem = path.parse(path.basename(name)).name
  const png = await image.clone().png().toBuffer()
  signal?.throwIfAborted()
  if (png.length < MAX_REF_BYTES) return { name: `${stem}.png`, mediaType: 'image/png', data: png }

  // Lossless WebP can fit a large photograph without resizing or another
  // lossy JPEG encode. Recheck the upload limit after conversion, too.
  const webp = await image.webp({ lossless: true }).toBuffer()
  signal?.throwIfAborted()
  if (webp.length < MAX_REF_BYTES) return { name: `${stem}.webp`, mediaType: 'image/webp', data: webp }
  throw new Error('Reference exceeds 50 MB even with lossless compression; use a smaller reference image.')
}

/** Astra only needs a small view to choose settings; the edit gets the full image. */
export async function referencePreview(reference: ImageReference, signal?: AbortSignal): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const preview = await sharp(reference.data)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .png()
    .timeout({ seconds: 30 })
    .toBuffer()
  signal?.throwIfAborted()
  return preview
}
