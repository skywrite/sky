/** Coordinates are relative to the oriented original, never to a resized preview. */
export interface MarkupPoint {
  x: number
  y: number
}

export interface ImageMark {
  kind: 'circle' | 'arrow' | 'draw'
  points: MarkupPoint[]
  instruction: string
}

export interface ImageMarkup {
  width: number
  height: number
  marks: ImageMark[]
  instruction: string
  format: 'png' | 'jpeg' | 'webp'
}

export const MAX_MARKUP_PIXELS = 16_777_216
export const MAX_IMAGE_MARKS = 20
export const MAX_MARK_POINTS = 1000
export const MARKUP_COLOR = '#e34f46'

/** Bound uploads and restored drafts before drawing anything or forwarding an edit. */
export function isImageMarkup(value: unknown): value is ImageMarkup {
  if (!value || typeof value !== 'object') return false
  const v = value as ImageMarkup
  return (
    Number.isSafeInteger(v.width) &&
    v.width > 0 &&
    Number.isSafeInteger(v.height) &&
    v.height > 0 &&
    v.width * v.height <= MAX_MARKUP_PIXELS &&
    ['png', 'jpeg', 'webp'].includes(v.format) &&
    typeof v.instruction === 'string' &&
    v.instruction.length <= 4000 &&
    Array.isArray(v.marks) &&
    v.marks.length <= MAX_IMAGE_MARKS &&
    v.marks.every(
      (mark) =>
        mark &&
        ['circle', 'arrow', 'draw'].includes(mark.kind) &&
        typeof mark.instruction === 'string' &&
        mark.instruction.length <= 2000 &&
        Array.isArray(mark.points) &&
        mark.points.length >= 2 &&
        mark.points.length <= (mark.kind === 'draw' ? MAX_MARK_POINTS : 2) &&
        mark.points.every(
          (point) =>
            point &&
            Number.isFinite(point.x) &&
            point.x >= 0 &&
            point.x <= 1 &&
            Number.isFinite(point.y) &&
            point.y >= 0 &&
            point.y <= 1,
        ),
    )
  )
}

export function hasImageMarkup(markup?: ImageMarkup | null): markup is ImageMarkup {
  return !!markup && (markup.marks.length > 0 || !!markup.instruction.trim() || markup.format !== 'png')
}

export function imageMarkupInstructions(
  message: string,
  files: readonly { name: string }[],
  markups: readonly (ImageMarkup | null)[],
): string {
  return [
    message.trim(),
    ...files.flatMap((file, index) => {
      const markup = markups[index]
      if (!hasImageMarkup(markup)) return []
      return [
        `Edit ${file.name}:\n${[
          markup.instruction.trim(),
          ...markup.marks.map(
            (mark, i) =>
              `Mark ${i + 1}: ${mark.instruction.trim() || 'Use this area with the instructions in this message.'}`,
          ),
          'Keep the rest of the photo unchanged. Remove the annotation marks from the finished image.',
          `Output: ${markup.format.toUpperCase()}.`,
        ]
          .filter(Boolean)
          .join('\n')}`,
      ]
    }),
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** The editor preview and server PNG use identical paths, badge positions and stroke widths. */
export function imageMarkupShapes(markup: ImageMarkup) {
  const stroke = Math.max(2, Math.min(markup.width, markup.height) / 160)
  const radius = stroke * 6
  const shapes = markup.marks.map((mark, index) => {
    const points = mark.points.map((point) => ({ x: point.x * markup.width, y: point.y * markup.height }))
    const a = points[0]!
    const b = points.at(-1)!
    let d: string
    if (mark.kind === 'circle') {
      const rx = Math.max(stroke, Math.abs(b.x - a.x) / 2)
      const ry = Math.max(stroke, Math.abs(b.y - a.y) / 2)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      d = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0`
    } else {
      d = points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ')
      if (mark.kind === 'arrow') {
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const length = stroke * 5
        d += ` M ${b.x - length * Math.cos(angle - 0.5)} ${b.y - length * Math.sin(angle - 0.5)} L ${b.x} ${b.y} L ${b.x - length * Math.cos(angle + 0.5)} ${b.y - length * Math.sin(angle + 0.5)}`
      }
    }
    const clamp = (n: number, edge: number) => Math.max(radius, Math.min(edge - radius, n))
    return { d, number: index + 1, x: clamp(a.x, markup.width), y: clamp(a.y, markup.height) }
  })
  return { stroke, radius, shapes }
}

/** Contains only validated numeric geometry and our fixed paint; never interpolates user text. */
export function imageMarkupSvg(markup: ImageMarkup): string {
  if (!isImageMarkup(markup)) throw new Error('Invalid photo markup. Reopen Mark up and try again.')
  const { stroke, radius, shapes } = imageMarkupShapes(markup)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${markup.width}" height="${markup.height}" viewBox="0 0 ${markup.width} ${markup.height}">${shapes
    .map(
      (shape) =>
        `<path d="${shape.d}" stroke="${MARKUP_COLOR}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="${shape.x}" cy="${shape.y}" r="${radius}" fill="${MARKUP_COLOR}"/><text x="${shape.x}" y="${shape.y + radius * 0.36}" text-anchor="middle" font-family="sans-serif" font-size="${radius * 1.3}" font-weight="bold" fill="white">${shape.number}</text>`,
    )
    .join('')}</svg>`
}
