import { drawingCanvasSchema } from './drawing/mod.ts'

/** Drawing canvases use their own pixel budget; small icons and arbitrary aspect ratios are valid. */
export function validateDrawingSize(size: string): string | null {
  if (size === 'auto') return null
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) return `Drawing size must be auto or WIDTHxHEIGHT in whole pixels (e.g. 64x64), got "${size}".`
  const width = Number(match[1])
  const height = Number(match[2])
  const result = drawingCanvasSchema.safeParse({ width, height })
  if (result.success) return null
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192
  ) {
    return `Drawing size edges must be whole pixels from 1 to 8192, got ${size}.`
  }
  return `Drawing size ${size} exceeds 16,777,216 pixels; choose a smaller canvas (e.g. 4096x4096).`
}
