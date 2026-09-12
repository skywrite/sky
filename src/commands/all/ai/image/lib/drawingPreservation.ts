import sharp from 'sharp'
import type { RenderedDrawing } from './drawing/mod.ts'
import { compositeImageEdit, validateEditMask } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import type { ImageReference } from './references.ts'

/**
 * Input SVG must come from the typed drawing renderer, never arbitrary user markup.
 * Preserve whole pixels at the permission boundary: drawing coverage already includes
 * antialiasing and the source, so blending it again would soften or darken its edges.
 */
export async function preserveDrawing(
  drawing: RenderedDrawing,
  edit: MaskedImageEdit,
  signal?: AbortSignal,
): Promise<{ data: Uint8Array; svg: string; mask: ImageReference }> {
  signal?.throwIfAborted()
  const limit = edit.plan ? (edit.generationMask ?? edit.mask) : edit.mask
  await validateEditMask(limit.data, edit.canvas)
  const [sourceInfo, drawingInfo, coverageInfo] = await Promise.all([
    sharp(edit.canvas.data).metadata(),
    sharp(drawing.data).metadata(),
    sharp(drawing.coverage).metadata(),
  ])
  const { width, height } = sourceInfo
  if (
    drawingInfo.width !== width ||
    drawingInfo.height !== height ||
    coverageInfo.width !== width ||
    coverageInfo.height !== height
  ) {
    throw new Error('Drawing output and coverage must match the preservation canvas dimensions.')
  }
  if (coverageInfo.format !== 'png' || !coverageInfo.hasAlpha) {
    throw new Error('Drawing coverage must be a PNG with an alpha channel.')
  }
  const [coverage, permission, sourcePng] = await Promise.all([
    sharp(drawing.coverage).extractChannel('alpha').raw().toBuffer(),
    sharp(limit.data).extractChannel('alpha').raw().toBuffer(),
    sharp(edit.canvas.data).png().toBuffer(),
  ])
  const keep = Buffer.alloc(coverage.length * 4, 255)
  const replace = Buffer.alloc(coverage.length * 4, 255)
  for (let i = 0; i < coverage.length; i++) {
    const editable = coverage[i]! > 0 && permission[i] === 0
    keep[i * 4 + 3] = editable ? 0 : 255
    replace[i * 4 + 3] = editable ? 255 : 0
  }
  const [keepPng, replacePng] = await Promise.all([
    sharp(keep, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    sharp(replace, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  ])
  signal?.throwIfAborted()
  const mask: ImageReference = { name: 'drawing-preservation-mask.png', mediaType: 'image/png', data: keepPng }
  // A proposal completely outside the permitted region is valid to review; its final mask is all opaque.
  const data = await compositeImageEdit(drawing.data, { ...edit, mask }, signal)
  const image = (bytes: Uint8Array, attributes = '') =>
    `<image x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="none" href="data:image/png;base64,${Buffer.from(bytes).toString('base64')}"${attributes}/>`
  const layerMask = (id: string, pixels: Uint8Array) =>
    `<mask id="${id}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" style="mask-type:alpha">${image(pixels)}</mask>`
  // Complementary layers are necessary: placing the generated SVG over a complete source would undo erasure.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${layerMask('sky-preserve-source', keepPng)}${layerMask('sky-preserve-drawing', replacePng)}</defs>${image(sourcePng, ' mask="url(#sky-preserve-source)"')}<g mask="url(#sky-preserve-drawing)">${drawing.svg}</g></svg>`
  signal?.throwIfAborted()
  return { data, svg, mask }
}
