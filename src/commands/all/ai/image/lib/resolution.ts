import { validateSize } from './options.ts'

/** About five times a typical 1.6 MP result, within the Image API's canvas limits. */
const PHOTO_EDIT_PIXELS = 8_000_000
const MAX_EDGE = 3840

/** Preserve the reference proportions; extreme panoramas fit inside a supported canvas. */
export function photoEditSize(width: number, height: number): string {
  return canvasSize(width, height, PHOTO_EDIT_PIXELS)
}

/** Keep a graphic's native grid when the API accepts it; otherwise choose the nearest supported scale. */
export function graphicEditSize(width: number, height: number): string {
  const native = `${width}x${height}`
  if (!validateSize(native)) return native
  return canvasSize(width, height, Math.min(PHOTO_EDIT_PIXELS, Math.max(1_048_576, width * height)))
}

function canvasSize(width: number, height: number, pixels: number): string {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The reference image has no valid dimensions.')
  }
  const aspect = Math.min(3, Math.max(1 / 3, width / height))
  const scale = Math.min(Math.sqrt(pixels / aspect), MAX_EDGE, MAX_EDGE / aspect)
  let outWidth = Math.floor((scale * aspect) / 16) * 16
  let outHeight = Math.floor(scale / 16) * 16
  // Rounding near the aspect limit must not make a valid canvas invalid.
  if (outWidth > outHeight * 3) outHeight = Math.ceil(outWidth / 3 / 16) * 16
  if (outHeight > outWidth * 3) outWidth = Math.ceil(outHeight / 3 / 16) * 16
  const size = `${outWidth}x${outHeight}`
  const problem = validateSize(size)
  if (problem) throw new Error(problem)
  return size
}
