import sharp from 'sharp'
import { maskPlanSchema } from './maskPlan.ts'
import type { ImageMaskPlan } from './maskPlan.ts'
import { MAX_REF_BYTES } from './options.ts'
import type { ImageReference } from './references.ts'

export interface MaskedImageEdit {
  /** Both the API input and the source pixels used during compositing. */
  canvas: ImageReference
  /** PNG alpha: transparent edits, opaque preserves. Same dimensions as canvas. */
  mask: ImageReference
  /** Broader working space sent to the model; also bounds any reviewed mask correction. */
  generationMask?: ImageReference
  plan?: ImageMaskPlan
  complexity?: 'simple' | 'complex'
  description: string
}

export async function imageCanvas(
  reference: ImageReference,
  size: string,
  signal?: AbortSignal,
): Promise<ImageReference> {
  signal?.throwIfAborted()
  const [width, height] = size.split('x').map(Number)
  const data = await sharp(reference.data)
    .resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .timeout({ seconds: 30 })
    .toBuffer()
  signal?.throwIfAborted()
  if (data.length >= MAX_REF_BYTES) throw new Error('The edit canvas exceeds the 50 MB upload limit.')
  return { name: 'edit-canvas.png', mediaType: 'image/png', data }
}

/** Rasterize numeric contours locally. Protected holes win; feathering stays inside editable pixels. */
export async function maskFromPlan(
  plan: ImageMaskPlan,
  canvas: ImageReference,
  signal?: AbortSignal,
): Promise<ImageReference> {
  signal?.throwIfAborted()
  maskPlanSchema.parse(plan)
  if (plan.scope !== 'localized' || !plan.editRegions.length)
    throw new Error('No localized edit regions were identified.')
  const { width, height } = await sharp(canvas.data).metadata()
  const polygon = (region: ImageMaskPlan['editRegions'][number], fill: string) =>
    `<polygon fill="${fill}" points="${region.points.map(({ x, y }) => `${x},${y}`).join(' ')}"/>`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1000 1000" preserveAspectRatio="none"><rect width="1000" height="1000" fill="black"/>${plan.editRegions.map((region) => polygon(region, 'white')).join('')}${plan.protectedRegions.map((region) => polygon(region, 'black')).join('')}</svg>`
  const raw = await sharp(Buffer.from(svg)).removeAlpha().extractChannel(0).raw().toBuffer()
  const blurred =
    plan.edges === 'hard'
      ? undefined
      : await sharp(raw, { raw: { width, height, channels: 1 } })
          .blur(Math.max(1, Math.min(width, height) / 1000))
          .extractChannel(0)
          .raw()
          .toBuffer()
  const rgba = Buffer.alloc(raw.length * 4)
  for (let i = 0; i < raw.length; i++) {
    rgba[i * 4 + 3] = 255 - (blurred ? Math.round((raw[i]! * blurred[i]!) / 255) : raw[i]!)
  }
  const data = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  signal?.throwIfAborted()
  await validateEditMask(data, canvas)
  return { name: 'edit-mask.png', mediaType: 'image/png', data }
}

/** Intersect permissions, including antialiased edges: no correction may open protected source pixels. */
export async function limitEditMask(
  mask: ImageReference,
  limit: ImageReference,
  canvas: ImageReference,
  signal?: AbortSignal,
): Promise<ImageReference> {
  signal?.throwIfAborted()
  await validateEditMask(mask.data, canvas)
  await validateEditMask(limit.data, canvas)
  const { width, height } = await sharp(canvas.data).metadata()
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  const boundary = await sharp(limit.data).extractChannel('alpha').raw().toBuffer()
  const rgba = Buffer.alloc(alpha.length * 4)
  for (let i = 0; i < alpha.length; i++) rgba[i * 4 + 3] = Math.max(alpha[i]!, boundary[i]!)
  const data = await sharp(rgba, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  signal?.throwIfAborted()
  await validateEditMask(data, canvas)
  return { ...mask, data }
}

export async function validateEditMask(data: Uint8Array, canvas: ImageReference): Promise<void> {
  const mask = await sharp(data).metadata()
  const base = await sharp(canvas.data).metadata()
  if (mask.format !== 'png' || !mask.hasAlpha) throw new Error('An edit mask must be a PNG with an alpha channel.')
  if (mask.width !== base.width || mask.height !== base.height) {
    throw new Error('The mask dimensions must match the edit canvas.')
  }
  if (data.length >= MAX_REF_BYTES) throw new Error('The mask exceeds the 50 MB upload limit.')
  const alpha = await sharp(data).extractChannel('alpha').raw().toBuffer()
  if (!alpha.some((value) => value === 0) || !alpha.some((value) => value === 255)) {
    throw new Error('The mask must contain both transparent editable areas and opaque protected areas.')
  }
}

/** User masks may match the upright source or the output canvas; black/white RGB alone is not a mask. */
export async function prepareExplicitMask(
  data: Uint8Array,
  reference: ImageReference,
  canvas: ImageReference,
  signal?: AbortSignal,
): Promise<ImageReference> {
  signal?.throwIfAborted()
  const input = await sharp(data).metadata()
  const source = await sharp(reference.data).metadata()
  const target = await sharp(canvas.data).metadata()
  if (input.format !== 'png' || !input.hasAlpha) throw new Error('An edit mask must be a PNG with an alpha channel.')
  const matches = (other: { width: number; height: number }) =>
    input.width === other.width && input.height === other.height
  if (!matches(source) && !matches(target)) {
    throw new Error('The mask must match the upright first reference or the requested output dimensions.')
  }
  const resized = matches(target)
    ? data
    : await sharp(data)
        .resize({
          width: target.width,
          height: target.height,
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 1 },
        })
        .png()
        .timeout({ seconds: 30 })
        .toBuffer()
  await validateEditMask(resized, canvas)
  signal?.throwIfAborted()
  return { name: 'edit-mask.png', mediaType: 'image/png', data: resized }
}

/** A provider mask is only guidance. Copy original output-canvas pixels wherever alpha says protected. */
export async function compositeImageEdit(
  generated: Uint8Array,
  edit: MaskedImageEdit,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted()
  const base = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const result = await sharp(generated).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (base.info.width !== result.info.width || base.info.height !== result.info.height) {
    throw new Error(
      'The generated image dimensions changed; it cannot be aligned with the preservation mask. No unprotected result was saved.',
    )
  }
  const alpha = await sharp(edit.mask.data).extractChannel('alpha').raw().toBuffer()
  const pixels = base.data
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] === 255) continue
    const offset = i * 4
    const weight = 1 - alpha[i]! / 255
    const originalAlpha = (pixels[offset + 3]! / 255) * (1 - weight)
    const generatedAlpha = (result.data[offset + 3]! / 255) * weight
    const combinedAlpha = originalAlpha + generatedAlpha
    for (let channel = 0; channel < 3; channel++) {
      pixels[offset + channel] = combinedAlpha
        ? Math.round(
            (pixels[offset + channel]! * originalAlpha + result.data[offset + channel]! * generatedAlpha) /
              combinedAlpha,
          )
        : 0
    }
    pixels[offset + 3] = Math.round(combinedAlpha * 255)
  }
  signal?.throwIfAborted()
  return sharp(pixels, { raw: { width: base.info.width, height: base.info.height, channels: 4 } })
    .png()
    .toBuffer()
}
