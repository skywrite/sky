/**
 * gpt-image-2 request constraints, encoded from the OpenAI Image API docs
 * (developers.openai.com/api/docs/guides/image-generation, checked 2026-08).
 * The API rejects out-of-range values anyway — validating here turns a slow
 * failed network call into an instant, actionable message, and gives ai:chat
 * a correctable tool error before any money is spent.
 */

/**
 * The model behind ChatGPT Images 2.0 — OpenAI's recommended image model for
 * API use (verified 2026-08: the `chatgpt-image-latest` alias points to the
 * PREVIOUS ChatGPT snapshot, not this one). Not in the aiModel registry on
 * purpose: that registry resolves LanguageModels only (see its docblock) —
 * image generation is a different modality with its own call shape.
 */
export const IMAGE_MODEL = 'gpt-image-2'

export const QUALITIES = ['low', 'medium', 'high', 'auto'] as const

export const BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const

export const MAX_COUNT = 4
export const MAX_REF_IMAGES = 16
/** The edits endpoint caps every input image at 50MB. */
export const MAX_REF_BYTES = 50 * 1024 * 1024
export const REF_EXT_RE = /\.(png|jpe?g|webp)$/i

const SIZE_RE = /^(\d{2,4})x(\d{2,4})$/
const EDGE_MULTIPLE = 16
const MAX_EDGE = 3840
const MAX_ASPECT = 3
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400

/** Validate a WIDTHxHEIGHT size against gpt-image-2's rules; null when fine. */
export function validateSize(size: string): string | null {
  const match = SIZE_RE.exec(size)
  if (!match) return `size must be WIDTHxHEIGHT in pixels (e.g. 1536x1024), got "${size}"`
  const width = Number(match[1])
  const height = Number(match[2])
  if (width % EDGE_MULTIPLE !== 0 || height % EDGE_MULTIPLE !== 0) {
    return `size edges must be multiples of ${EDGE_MULTIPLE}, got ${width}x${height}`
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    return `size edges must be at most ${MAX_EDGE}px, got ${width}x${height}`
  }
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long > short * MAX_ASPECT) {
    return `aspect ratio must be at most ${MAX_ASPECT}:1, got ${width}x${height}`
  }
  const pixels = width * height
  if (pixels < MIN_PIXELS) {
    return `size is too small (${width}x${height} is under ${MIN_PIXELS} pixels — 1024x640 area or larger)`
  }
  if (pixels > MAX_PIXELS) {
    return `size is too large (${width}x${height} is over ${MAX_PIXELS} pixels — 3840x2160 is the ceiling)`
  }
  return null
}

export function validateQuality(quality: string): string | null {
  if ((QUALITIES as readonly string[]).includes(quality)) return null
  return `quality must be one of ${QUALITIES.join(', ')}, got "${quality}"`
}

export function validateBackground(background: string): string | null {
  if ((BACKGROUNDS as readonly string[]).includes(background)) return null
  return `background must be one of ${BACKGROUNDS.join(', ')}, got "${background}"`
}

/** Split a --refs value into trimmed paths (comma-separated). */
export function parseRefs(refs: string): string[] {
  return refs
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref.length > 0)
}
