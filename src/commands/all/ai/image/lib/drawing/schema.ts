import { z } from 'zod'

export const MAX_DRAWING_PIXELS = 16_777_216
const coordinate = z.number().finite().min(-32768).max(32768)
const length = z.number().finite().min(0).max(32768)
const color = z.string().regex(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/)
const paint = z.union([color, z.literal('none')])
const point = z.object({ x: coordinate, y: coordinate }).strict()
const style = z
  .object({
    fill: paint,
    stroke: paint,
    strokeWidth: z.number().finite().min(0).max(512),
    opacity: z.number().finite().min(0).max(1),
  })
  .strict()

// OpenAI Structured Outputs accepts anyOf unions but rejects oneOf emitted for
// discriminated unions by the SDK's JSON Schema conversion.
const pathCommand = z.union([
  z.object({ command: z.literal('move'), x: coordinate, y: coordinate }).strict(),
  z.object({ command: z.literal('line'), x: coordinate, y: coordinate }).strict(),
  z
    .object({
      command: z.literal('cubic'),
      x1: coordinate,
      y1: coordinate,
      x2: coordinate,
      y2: coordinate,
      x: coordinate,
      y: coordinate,
    })
    .strict(),
  z.object({ command: z.literal('quadratic'), x1: coordinate, y1: coordinate, x: coordinate, y: coordinate }).strict(),
  z
    .object({
      command: z.literal('arc'),
      rx: length,
      ry: length,
      rotation: z.number().finite().min(-360).max(360),
      largeArc: z.boolean(),
      clockwise: z.boolean(),
      x: coordinate,
      y: coordinate,
    })
    .strict(),
  z.object({ command: z.literal('close') }).strict(),
])

/** Scene values are data, never SVG fragments, CSS, URLs or executable code. */
export const drawingElementSchema = z.union([
  z
    .object({
      type: z.literal('rect'),
      x: coordinate,
      y: coordinate,
      width: length,
      height: length,
      radius: length,
      style,
    })
    .strict(),
  z.object({ type: z.literal('ellipse'), cx: coordinate, cy: coordinate, rx: length, ry: length, style }).strict(),
  z.object({ type: z.literal('polygon'), points: z.array(point).min(3).max(256), style }).strict(),
  z.object({ type: z.literal('path'), commands: z.array(pathCommand).min(1).max(512), style }).strict(),
  z.object({ type: z.literal('line'), x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, style }).strict(),
  z
    .object({
      type: z.literal('star'),
      cx: coordinate,
      cy: coordinate,
      outerRadius: length,
      innerRadius: length,
      points: z.number().int().min(3).max(64),
      rotation: z
        .number()
        .finite()
        .min(-360)
        .max(360)
        .describe('Degrees clockwise from positive x; -90 starts at top.'),
      style,
    })
    .strict(),
  z
    .object({
      type: z.literal('text'),
      x: coordinate,
      y: coordinate.describe('Alphabetic baseline in canvas pixels.'),
      text: z.string().min(1).max(2000),
      fontFamily: z.enum(['sans-serif', 'serif', 'monospace']),
      fontSize: z.number().finite().min(1).max(512),
      fontWeight: z.enum(['normal', 'bold']),
      anchor: z.enum(['start', 'middle', 'end']),
      letterSpacing: z.number().finite().min(-32).max(128),
      rotation: z.number().finite().min(-360).max(360),
      style,
    })
    .strict(),
])

export const drawingCanvasSchema = z
  .object({ width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192) })
  .refine(({ width, height }) => width * height <= MAX_DRAWING_PIXELS, 'Drawing canvas exceeds the pixel budget.')

export const drawingSceneSchema = z
  .object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
    description: z.string().min(1).max(1200),
    requirements: z.array(z.string().min(1).max(240)).min(1).max(16),
    background: color
      .nullable()
      .describe('Canvas background for new drawings; null preserves transparency or a supplied base.'),
    eraseRegions: z
      .array(z.object({ points: z.array(point).min(3).max(256) }).strict())
      .max(32)
      .describe('Polygons to erase from the supplied base before painting; used only for localized edits.'),
    elements: z.array(drawingElementSchema).max(128),
  })
  .strict()
  .superRefine((scene, context) => {
    if (scene.width * scene.height > MAX_DRAWING_PIXELS) {
      context.addIssue({ code: 'custom', message: 'Drawing canvas exceeds the pixel budget.' })
    }
    let geometry = scene.eraseRegions.reduce((sum, region) => sum + region.points.length, 0)
    let characters = 0
    for (const element of scene.elements) {
      if (element.type === 'star' && element.innerRadius >= element.outerRadius) {
        context.addIssue({ code: 'custom', message: 'A star requires an inner radius smaller than its outer radius.' })
      }
      if (element.type === 'path') {
        geometry += element.commands.length
        if (element.commands[0]?.command !== 'move') {
          context.addIssue({ code: 'custom', message: 'A path must start with a move command.' })
        }
      }
      if (element.type === 'polygon') geometry += element.points.length
      if (element.type === 'star') geometry += element.points * 2
      if (element.type === 'text') {
        characters += element.text.length
        if (element.text.split('\n').length > 20 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(element.text)) {
          context.addIssue({ code: 'custom', message: 'Text contains unsupported controls or too many lines.' })
        }
      }
    }
    if (geometry > 4096 || characters > 16000) {
      context.addIssue({ code: 'custom', message: 'Drawing complexity exceeds the bounded geometry or text budget.' })
    }
  })

export type DrawingScene = z.infer<typeof drawingSceneSchema>
export type DrawingElement = z.infer<typeof drawingElementSchema>
export type DrawingStyle = DrawingElement['style']
