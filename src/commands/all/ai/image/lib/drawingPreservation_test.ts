import sharp from 'sharp'
import { assert, test } from '#test'
import { renderDrawing } from './drawing/mod.ts'
import { drawingScene, solidStyle } from './drawing/testHelpers.ts'
import { preserveDrawing } from './drawingPreservation.ts'
import { testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { maskFromPlan } from './mask.ts'

async function fixture() {
  const pixels = Buffer.alloc(64 * 64 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 17) % 256
    pixels[i + 1] = 90
    pixels[i + 2] = 170
    pixels[i + 3] = i % 28 === 0 ? 0 : i % 20 === 0 ? 128 : 255
  }
  const canvas = {
    name: 'source-graphic.png',
    mediaType: 'image/png' as const,
    data: await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
      .png()
      .toBuffer(),
  }
  const plan = {
    ...testMaskPlan([testRegion(200, 200, 600, 600)], [testRegion(450, 450, 550, 550)]),
    edges: 'hard' as const,
    generationRegions: [testRegion(187.5, 187.5, 687.5, 687.5)],
  }
  const mask = await maskFromPlan(plan, canvas)
  const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
  const permission = await sharp(generationMask.data).ensureAlpha().raw().toBuffer()
  permission[(13 * 64 + 13) * 4 + 3] = 128
  generationMask.data = await sharp(permission, { raw: { width: 64, height: 64, channels: 4 } })
    .png()
    .toBuffer()
  const edit = { canvas, mask, generationMask, plan, description: plan.changes }
  const scene = {
    ...drawingScene([{ type: 'rect', x: 24, y: 16, width: 32, height: 32, radius: 0, style: solidStyle }]),
    width: 64,
    height: 64,
    eraseRegions: [
      {
        points: [
          { x: 8, y: 8 },
          { x: 40, y: 8 },
          { x: 40, y: 40 },
          { x: 8, y: 40 },
        ],
      },
    ],
  }
  const drawing = await renderDrawing(scene, { base: canvas.data })
  return { edit, drawing, scene }
}

test('Drawing preservation keeps protected RGBA exact, permits erasure and refuses partial permission pixels', async () => {
  const { edit, drawing } = await fixture()
  const result = await preserveDrawing(drawing, edit)
  const original = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer()
  const output = await sharp(result.data).ensureAlpha().raw().toBuffer()
  const permission = await sharp(edit.generationMask.data).extractChannel('alpha').raw().toBuffer()
  const coverage = await sharp(drawing.coverage).extractChannel('alpha').raw().toBuffer()
  const final = await sharp(result.mask.data).extractChannel('alpha').raw().toBuffer()
  let changedProtected = 0
  let incorrectPermissions = 0
  for (let i = 0; i < final.length; i++) {
    const allowed = coverage[i]! > 0 && permission[i] === 0
    if (final[i] !== (allowed ? 0 : 255)) incorrectPermissions++
    if (!allowed && !original.subarray(i * 4, i * 4 + 4).equals(output.subarray(i * 4, i * 4 + 4))) changedProtected++
  }
  const pixel = (x: number, y: number) => [...output.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)]
  assert({
    given:
      'paint and erasure extending outside working space, including a protected hole and fractional permission edge',
    should: 'apply only covered, fully permitted pixels and preserve all other original RGBA bytes',
    actual: [
      changedProtected,
      incorrectPermissions,
      pixel(18, 18),
      pixel(40, 20),
      final[13 * 64 + 13],
      final[32 * 64 + 32],
    ],
    expected: [0, 0, [0, 0, 0, 0], [255, 128, 0, 255], 255, 255],
  })
})

test('Retained editable SVG visibly matches the protected PNG, including transparent erasure', async () => {
  const { edit, drawing } = await fixture()
  const result = await preserveDrawing(drawing, edit)
  const png = await sharp(result.data).ensureAlpha().raw().toBuffer()
  const svg = await sharp(Buffer.from(result.svg)).ensureAlpha().raw().toBuffer()
  let changedAlpha = 0
  let largestVisibleDifference = 0
  for (let i = 0; i < png.length; i += 4) {
    if (png[i + 3] !== svg[i + 3]) changedAlpha++
    // SVG rasterizers quantize premultiplied colors. Invisible RGB is immaterial; compare visible color contribution.
    for (let channel = 0; channel < 3; channel++) {
      largestVisibleDifference = Math.max(
        largestVisibleDifference,
        Math.abs((png[i + channel]! * png[i + 3]!) / 255 - (svg[i + channel]! * svg[i + 3]!) / 255),
      )
    }
  }
  assert({
    given: 'an editable SVG containing source pixels, clipped paint and a transparent erased region',
    should:
      'show the same protected result without revealing changes outside allowed pixels or filling erasure from below',
    actual: [
      changedAlpha,
      largestVisibleDifference <= 1,
      svg[(18 * 64 + 18) * 4 + 3],
      result.svg.includes('<rect x="24"'),
      result.svg.includes('sky-preserve-source'),
      result.svg.includes('sky-preserve-drawing'),
    ],
    expected: [0, true, 0, true, true, true],
  })
})

test('Entirely clipped drawings return the original, and explicit masks remain authoritative', async () => {
  const { edit } = await fixture()
  const outside = await renderDrawing(
    {
      ...drawingScene([{ type: 'rect', x: 0, y: 0, width: 8, height: 8, radius: 0, style: solidStyle }]),
      width: 64,
      height: 64,
    },
    { base: edit.canvas.data },
  )
  const clipped = await preserveDrawing(outside, edit)
  const original = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer()
  const clippedPixels = await sharp(clipped.data).ensureAlpha().raw().toBuffer()
  const clippedMask = await sharp(clipped.mask.data).extractChannel('alpha').raw().toBuffer()
  const { drawing } = await fixture()
  const explicit = await preserveDrawing(drawing, { ...edit, plan: undefined })
  const explicitMask = await sharp(explicit.mask.data).extractChannel('alpha').raw().toBuffer()
  const allowed = await sharp(edit.mask.data).extractChannel('alpha').raw().toBuffer()
  let widened = 0
  for (let i = 0; i < allowed.length; i++) if (explicitMask[i] === 0 && allowed[i] !== 0) widened++
  assert({
    given:
      'a proposed shape completely outside permitted space and an explicit mask narrower than the generation workspace',
    should:
      'return an unchanged image for review and obey the supplied mask even when a broader generation mask exists',
    actual: [clippedPixels.equals(original), clippedMask.every((a) => a === 255), widened, explicitMask[20 * 64 + 40]],
    expected: [true, true, 0, 255],
  })
})

test('Drawing preservation rejects dimension mismatch and propagates cancellation', async () => {
  const { edit, drawing } = await fixture()
  const wrong = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#ffffff' } })
    .png()
    .toBuffer()
  const failures: string[] = []
  for (const [input, signal] of [
    [{ ...drawing, coverage: wrong }, undefined],
    [{ ...drawing, data: wrong }, undefined],
    [drawing, AbortSignal.abort(new Error('Cancelled drawing preservation'))],
  ] as const) {
    try {
      await preserveDrawing(input, edit, signal)
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'misaligned coverage or image data and a cancelled preservation request',
    should: 'refuse unsafe alignment and stop cancellation before returning any result',
    actual: [failures.slice(0, 2).every((message) => message.includes('dimensions')), failures[2]],
    expected: [true, 'Cancelled drawing preservation'],
  })
})
