/**
 * GPT Image 2.6 request constraints, encoded from the OpenAI Image API docs
 * (developers.openai.com/api/docs/guides/image-generation, checked 2026-11-05).
 * The API rejects out-of-range values anyway — validating here turns a slow
 * failed network call into an instant, actionable message, and gives ai:chat
 * a correctable tool error before any money is spent.
 */

/**
 * Image models stay outside the language-model registry: generation uses
 * a different modality and call shape. The preflight uses that registry.
 */
export const IMAGE_MODELS = {
  flare: 'gpt-image-2.6-flare',
  sunburst: 'gpt-image-2.6-sunburst',
} as const
export type ImageModelName = keyof typeof IMAGE_MODELS

export const RENDER_QUALITIES = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ImageQuality = (typeof RENDER_QUALITIES)[number]
export const QUALITIES = [...RENDER_QUALITIES, 'auto'] as const

export const BACKGROUNDS = ['transparent', 'opaque', 'auto'] as const
export type ImageBackground = (typeof BACKGROUNDS)[number]

export const IMAGE_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'svg'] as const
export type ImageFormat = (typeof IMAGE_FORMATS)[number]
export interface ImageOutputOptions {
  format?: ImageFormat
  complexity?: 'low' | 'medium' | 'high'
  frameCount?: number
  frameDurationMs?: number
}

export function validateImageOutput(options: {
  format: string
  complexity?: string
  frameCount?: number
  frameDurationMs?: number
  references: number
  count: number
  markup?: boolean
  mask?: boolean
  reviewed?: boolean
  method?: string
  background?: string
  size?: string
}): string | null {
  const { format, frameCount, frameDurationMs, size } = options
  if (!(IMAGE_FORMATS as readonly string[]).includes(format)) return 'format must be png, jpeg, webp, gif, or svg.'
  if (options.complexity !== undefined && !['low', 'medium', 'high'].includes(options.complexity))
    return 'complexity must be low, medium, or high.'
  if ((format === 'gif' || format === 'svg') && options.references)
    return `${format.toUpperCase()} is available for new images only. Use PNG, JPEG or WebP to edit a photo.`
  if (format === 'svg' && options.count !== 1) return 'SVG generation supports one image at a time. Set count to 1.'
  if (options.background === 'transparent' && !['png', 'webp'].includes(format))
    return 'For a transparent background, choose PNG or WebP.'
  if (options.markup && (!options.references || options.mask || !['image', 'auto', undefined].includes(options.method)))
    return 'Markup requires the first reference image and the image method, without a mask.'
  if (format !== 'png' && (options.mask || options.reviewed || !['image', 'auto', undefined].includes(options.method)))
    return 'Masked edits, reviewed attempts and drawing/mixed methods currently save PNG. Choose format png or use a direct image request.'
  if (format !== 'gif' && (frameCount !== undefined || frameDurationMs !== undefined))
    return 'frameCount and frameDurationMs are only available with format gif.'
  if (frameCount !== undefined && (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > 16))
    return 'GIF frameCount must be an integer between 2 and 16.'
  if (
    frameDurationMs !== undefined &&
    (!Number.isInteger(frameDurationMs) || frameDurationMs < 20 || frameDurationMs > 2000)
  )
    return 'GIF frameDurationMs must be an integer between 20 and 2000 milliseconds.'
  if (format === 'gif' && size && size !== 'auto' && !/^\d+x\d+$/.test(size))
    return 'GIF size must be auto or WIDTHxHEIGHT.'
  if (
    format === 'gif' &&
    size &&
    size !== 'auto' &&
    size.split('x').some((edge) => Number(edge) <= 0 || Number(edge) % 16 !== 0 || Number(edge) > MAX_EDGE)
  )
    return 'GIF frame dimensions must be positive multiples of 16, at most 3840 pixels. Use size auto if the animation exceeds the provider’s pixel budget.'
  return null
}

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

/** Validate automatic sizing or WIDTHxHEIGHT against GPT Image 2.6's rules; null when fine. */
export function validateSize(size: string): string | null {
  if (size === 'auto') return null
  const match = SIZE_RE.exec(size)
  if (!match) return `size must be auto or WIDTHxHEIGHT in pixels (e.g. 1536x1024), got "${size}"`
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

/** Accept the short command names and their full API model IDs. */
export function imageModelName(model: string): ImageModelName | undefined {
  if (model === 'flare' || model === IMAGE_MODELS.flare) return 'flare'
  if (model === 'sunburst' || model === IMAGE_MODELS.sunburst) return 'sunburst'
  return undefined
}

export function validateModel(model: string): string | null {
  if (model === 'auto' || imageModelName(model)) return null
  return `model must be auto, flare, or sunburst (or their full GPT Image 2.6 IDs), got "${model}"`
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
