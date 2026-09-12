import sharp from 'sharp'
import { assert, test } from '#test'
import { renderDrawing } from './render.ts'
import { drawingSceneSchema } from './schema.ts'
import type { DrawingElement } from './schema.ts'
import { starPoints } from './svg.ts'
import { drawingScene, drawingStar, solidStyle } from './testHelpers.ts'

test('Native drawing computes exact star geometry and preserves requested pixels and transparency', async () => {
  const star = drawingStar()
  const points = starPoints(star)
  const image = await renderDrawing(drawingScene([star]))
  const metadata = await sharp(image.data).metadata()
  const pixels = await sharp(image.data).ensureAlpha().raw().toBuffer()
  const coverage = await sharp(image.coverage).extractChannel('alpha').raw().toBuffer()
  const center = (48 * 128 + 64) * 4
  const radii = points.map(({ x, y }) => Math.round(Math.hypot(x - star.cx, y - star.cy)))
  assert({
    given: 'an eight-point orange star on a native 128 by 96 transparent canvas',
    should: 'render mathematical geometry at exact dimensions and retain an editable SVG',
    actual: [
      points.length,
      radii,
      Math.round(Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))),
      Math.round(Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))),
      metadata.width,
      metadata.height,
      [...pixels.subarray(center, center + 4)],
      pixels[3],
      image.svg.includes('<polygon points='),
      coverage[48 * 128 + 64],
      coverage[0],
      coverage.every((value) => value === 0 || value === 255),
    ],
    expected: [
      16,
      Array.from({ length: 16 }, (_, index) => (index % 2 === 0 ? 40 : 18)),
      80,
      80,
      128,
      96,
      [255, 128, 0, 255],
      0,
      true,
      255,
      0,
      true,
    ],
  })
})

test('Editable text is escaped and typed path commands render without arbitrary markup', async () => {
  const text: DrawingElement = {
    type: 'text',
    x: 4,
    y: 30,
    text: 'Atlas <script>alert("x")</script> & \'label\'',
    fontFamily: 'sans-serif',
    fontSize: 12,
    fontWeight: 'bold',
    anchor: 'start',
    letterSpacing: 0,
    rotation: 0,
    style: solidStyle,
  }
  const image = await renderDrawing(
    drawingScene([
      {
        type: 'path',
        commands: [
          { command: 'move', x: 10, y: 70 },
          { command: 'line', x: 110, y: 70 },
          { command: 'quadratic', x1: 64, y1: 40, x: 10, y: 70 },
          { command: 'close' },
        ],
        style: solidStyle,
      },
      text,
    ]),
  )
  assert({
    given: 'literal text resembling script tags and a path described as coordinate data',
    should: 'keep text editable and escaped without allowing markup execution',
    actual: [
      image.svg.includes('<script>'),
      image.svg.includes('&lt;script&gt;'),
      image.svg.includes('&amp;'),
      image.svg.includes('&quot;'),
      image.svg.includes('&apos;'),
      image.svg.includes('<text '),
      image.svg.includes('d="M 10 70 L 110 70 Q 64 40 10 70 Z"'),
      (await sharp(image.data).metadata()).format,
    ],
    expected: [false, true, true, true, true, true, true, 'png'],
  })
})

test('Mixed drawings embed a trusted raster, support transparent erasure and retain unaffected source pixels', async () => {
  const base = await sharp({ create: { width: 128, height: 96, channels: 4, background: '#206080' } })
    .png()
    .toBuffer()
  const scene = drawingScene([{ type: 'rect', x: 40, y: 40, width: 20, height: 20, radius: 0, style: solidStyle }])
  scene.eraseRegions = [
    {
      points: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 },
      ],
    },
  ]
  const image = await renderDrawing(scene, { base })
  const pixels = await sharp(image.data).ensureAlpha().raw().toBuffer()
  const coverage = await sharp(image.coverage).extractChannel('alpha').raw().toBuffer()
  const at = (x: number, y: number) => [...pixels.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)]
  assert({
    given: 'a base raster with a region erased before painting a replacement',
    should: 'keep its outside pixels, clear the requested region and embed only a local PNG data URI',
    actual: [
      at(4, 4),
      at(30, 30)[3],
      at(50, 50),
      coverage[4 * 128 + 4],
      coverage[30 * 128 + 30],
      coverage[50 * 128 + 50],
      image.svg.includes('href="data:image/png;base64,'),
      image.svg.includes('<mask '),
    ],
    expected: [[32, 96, 128, 255], 0, [255, 128, 0, 255], 0, 255, 255, true, true],
  })
})

test('Coverage includes translucent strokes once and ignores invisible paint', async () => {
  const image = await renderDrawing(
    drawingScene([
      {
        type: 'line',
        x1: 20,
        y1: 20,
        x2: 80,
        y2: 20,
        style: { fill: 'none', stroke: '#ff000080', strokeWidth: 4, opacity: 0.5 },
      },
      { type: 'rect', x: 30, y: 40, width: 20, height: 20, radius: 0, style: { ...solidStyle, opacity: 0 } },
    ]),
  )
  const alpha = await sharp(image.data).extractChannel('alpha').raw().toBuffer()
  const coverage = await sharp(image.coverage).extractChannel('alpha').raw().toBuffer()
  assert({
    given: 'a translucent line and a fully invisible rectangle',
    should: 'retain the line alpha but mark its coverage as binary for a single final composite',
    actual: [alpha[20 * 128 + 40], coverage[20 * 128 + 40], alpha[50 * 128 + 40], coverage[50 * 128 + 40]],
    expected: [64, 255, 0, 0],
  })
})

test('Drawing schema rejects external resources, invalid geometry and excessive resource requests', async () => {
  const invalid = [
    { ...drawingScene(), elements: [{ type: 'image', href: 'https://example.com/image.svg' }] },
    { ...drawingScene([drawingStar()]), script: 'doSomething()' },
    drawingScene([drawingStar({ innerRadius: 60 })]),
    drawingScene([drawingStar({ cx: Number.POSITIVE_INFINITY })]),
    drawingScene([drawingStar({ style: { ...solidStyle, fill: 'url(https://example.com/style)' } })]),
    { ...drawingScene(), width: 8192, height: 8192 },
    drawingScene(Array.from({ length: 129 }, () => drawingStar())),
    drawingScene(Array.from({ length: 100 }, () => drawingStar({ points: 64 }))),
    drawingScene([{ type: 'path', commands: [{ command: 'line', x: 0, y: 0 }], style: solidStyle }]),
  ]
  const failures: string[] = []
  const base = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#ffffff' } })
    .png()
    .toBuffer()
  for (const check of [
    () => renderDrawing(drawingScene(), { base }),
    () => renderDrawing(drawingScene(), { signal: AbortSignal.abort(new Error('Cancelled drawing')) }),
  ]) {
    try {
      await check()
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'untrusted drawing data, a mismatched raster base and a cancelled request',
    should: 'reject each before producing a drawing',
    actual: [
      invalid.every((scene) => !drawingSceneSchema.safeParse(scene).success),
      failures.length,
      failures[0]?.includes('dimensions'),
      failures[1],
    ],
    expected: [true, 2, true, 'Cancelled drawing'],
  })
})
