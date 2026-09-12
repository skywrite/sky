import sharp from 'sharp'
import type { MaskedImageEdit } from './mask.ts'
import { validateEditMask } from './mask.ts'
import { MAX_REF_BYTES, validateSize } from './options.ts'
import type { ImageReference } from './references.ts'

export interface FocusedEdit {
  canvas: ImageReference
  mask: ImageReference
  size: string
  description: string
  /** Integer coordinates at output resolution. No source pixels are scaled. */
  geometry: {
    source: { left: number; top: number; width: number; height: number }
    padding: { left: number; top: number; right: number; bottom: number }
  }
  /** Align a generated crop to the full source canvas before bounded compositing. */
  restore(generatedCrop: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>
}

/** Find the smallest supported canvas covering the desired source context without resizing it. */
function supportedCanvas(width: number, height: number): { width: number; height: number } | undefined {
  let best: { width: number; height: number } | undefined
  let bestScore = Infinity
  for (let w = Math.ceil(width / 16) * 16; w <= 3840; w += 16) {
    for (let h = Math.ceil(height / 16) * 16; h <= 3840; h += 16) {
      const score = w * h * (1 + Math.abs(Math.log(w / h / (width / height))))
      if (score >= bestScore || validateSize(`${w}x${h}`)) continue
      best = { width: w, height: h }
      bestScore = score
    }
  }
  return best
}

/**
 * Focus on the entire permitted workspace with at least 64px / 30% local context.
 * Expand to real neighboring pixels first; any necessary padding is protected.
 * A separate full reference still supplies global context to the image model.
 * Explicit masks stay unchanged, and widely separated targets remain full-frame.
 */
export async function focusImageEdit(
  edit: MaskedImageEdit,
  options: { enabled?: boolean; signal?: AbortSignal } = {},
): Promise<FocusedEdit | undefined> {
  const { signal } = options
  signal?.throwIfAborted()
  if (options.enabled === false) return undefined
  const mask = edit.generationMask ?? edit.mask
  await validateEditMask(mask.data, edit.canvas)
  const { width, height } = await sharp(edit.canvas.data).metadata()
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  let left = width
  let top = height
  let right = 0
  let bottom = 0
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] === 255) continue
    const x = i % width
    const y = Math.floor(i / width)
    left = Math.min(left, x)
    right = Math.max(right, x + 1)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y + 1)
  }
  if (left >= right || top >= bottom) return undefined
  const xContext = Math.max(64, Math.ceil((right - left) * 0.3))
  const yContext = Math.max(64, Math.ceil((bottom - top) * 0.3))
  const desiredWidth = Math.min(width, right - left + xContext * 2)
  const desiredHeight = Math.min(height, bottom - top + yContext * 2)
  const frame = supportedCanvas(desiredWidth, desiredHeight)
  // A marginal crop costs detail/context without making the target meaningfully larger in view.
  if (!frame || frame.width * frame.height >= width * height * 0.85) return undefined
  const source = {
    left: Math.max(0, Math.min(width - Math.min(width, frame.width), Math.floor((left + right - frame.width) / 2))),
    top: Math.max(0, Math.min(height - Math.min(height, frame.height), Math.floor((top + bottom - frame.height) / 2))),
    width: Math.min(width, frame.width),
    height: Math.min(height, frame.height),
  }
  const padding = {
    left: Math.floor((frame.width - source.width) / 2),
    top: Math.floor((frame.height - source.height) / 2),
    right: Math.ceil((frame.width - source.width) / 2),
    bottom: Math.ceil((frame.height - source.height) / 2),
  }
  const [canvasData, maskData] = await Promise.all([
    sharp(edit.canvas.data)
      .extract(source)
      .extend({ ...padding, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .timeout({ seconds: 30 })
      .toBuffer(),
    sharp(mask.data)
      .extract(source)
      .extend({ ...padding, background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .png()
      .timeout({ seconds: 30 })
      .toBuffer(),
  ])
  signal?.throwIfAborted()
  if (canvasData.length >= MAX_REF_BYTES || maskData.length >= MAX_REF_BYTES) return undefined
  const canvas: ImageReference = { name: 'focused-canvas.png', mediaType: 'image/png', data: canvasData }
  const focusedMask: ImageReference = { name: 'focused-mask.png', mediaType: 'image/png', data: maskData }
  await validateEditMask(maskData, canvas)
  return {
    canvas,
    mask: focusedMask,
    size: `${frame.width}x${frame.height}`,
    geometry: { source, padding },
    description:
      `The first image is a focused crop of the full ${width}x${height} source, at identical pixel scale. ` +
      `Its source rectangle begins at (${source.left}, ${source.top}) and measures ${source.width}x${source.height}; ` +
      `protected padding is ${padding.left}px left and ${padding.top}px top. ` +
      'Edit this crop using its mask. The separate full source is context only; retain the crop framing and dimensions.',
    async restore(generatedCrop, restoreSignal) {
      signal?.throwIfAborted()
      restoreSignal?.throwIfAborted()
      const generated = await sharp(generatedCrop).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      if (generated.info.width !== frame.width || generated.info.height !== frame.height) {
        throw new Error('The generated focused image dimensions changed; it cannot be aligned with the source.')
      }
      const original = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer()
      // Copy, rather than alpha-composite: transparent generated pixels must be able to erase old content.
      for (let row = 0; row < source.height; row++) {
        const generatedStart = ((row + padding.top) * frame.width + padding.left) * 4
        const originalStart = ((row + source.top) * width + source.left) * 4
        original.set(generated.data.subarray(generatedStart, generatedStart + source.width * 4), originalStart)
      }
      signal?.throwIfAborted()
      restoreSignal?.throwIfAborted()
      const restored = await sharp(original, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer()
      signal?.throwIfAborted()
      restoreSignal?.throwIfAborted()
      return restored
    },
  }
}
