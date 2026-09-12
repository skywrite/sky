import sharp from 'sharp'
import { drawingSceneSchema, MAX_DRAWING_PIXELS } from './schema.ts'
import type { DrawingScene } from './schema.ts'
import { sceneSvg } from './svg.ts'

export interface RenderedDrawing {
  data: Uint8Array
  svg: string
  /** Opaque means affected by drawing/erasure; transparent means untouched. Binary, including antialiased edge pixels. */
  coverage: Uint8Array
}

/** Rasterize a validated scene at its native pixel dimensions, retaining the independently editable SVG. */
export async function renderDrawing(
  input: DrawingScene,
  options: { base?: Uint8Array; signal?: AbortSignal } = {},
): Promise<RenderedDrawing> {
  options.signal?.throwIfAborted()
  const scene = drawingSceneSchema.parse(input)
  let basePng: Uint8Array | undefined
  if (options.base) {
    if (options.base.byteLength > 50 * 1024 * 1024) throw new Error('Drawing base exceeds 50 MB.')
    const base = sharp(options.base, { limitInputPixels: MAX_DRAWING_PIXELS }).timeout({ seconds: 30 })
    const metadata = await base.metadata()
    if (metadata.width !== scene.width || metadata.height !== scene.height) {
      throw new Error('Drawing base dimensions must match the scene canvas; resize the base before planning.')
    }
    if (!['png', 'jpeg', 'webp', 'avif', 'heif', 'tiff'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
      throw new Error('Drawing base must be a single raster image.')
    }
    basePng = await base.toColourspace('srgb').png().toBuffer()
  }
  options.signal?.throwIfAborted()
  const svg = sceneSvg(scene, { basePng })
  const [data, alpha] = await Promise.all([
    sharp(Buffer.from(svg), { limitInputPixels: MAX_DRAWING_PIXELS }).png().timeout({ seconds: 30 }).toBuffer(),
    sharp(Buffer.from(sceneSvg(scene, { coverage: true })), { limitInputPixels: MAX_DRAWING_PIXELS })
      .ensureAlpha()
      .extractChannel('alpha')
      .raw()
      .timeout({ seconds: 30 })
      .toBuffer(),
  ])
  options.signal?.throwIfAborted()
  // The result already contains its edge antialiasing and opacity. A fractional
  // copy mask would blend those pixels twice when compositing against the base.
  const pixels = Buffer.alloc(alpha.length * 4, 255)
  for (let i = 0; i < alpha.length; i++) pixels[i * 4 + 3] = alpha[i] === 0 ? 0 : 255
  const coverage = await sharp(pixels, { raw: { width: scene.width, height: scene.height, channels: 4 } })
    .png()
    .timeout({ seconds: 30 })
    .toBuffer()
  options.signal?.throwIfAborted()
  return { data, svg, coverage }
}
