import sharp from 'sharp'
import { assert, test } from '#test'
import { testMaskPlan } from './imageEditTestHelpers.ts'
import { compositeImageEdit, imageCanvas, maskFromPlan, prepareExplicitMask, validateEditMask } from './mask.ts'
import type { ImageMaskPlan } from './maskPlan.ts'
import type { ImageReference } from './references.ts'

const rectangle = (left: number, top: number, right: number, bottom: number) => ({
  label: 'Synthetic region',
  points: [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ],
})
const plan: ImageMaskPlan = {
  ...testMaskPlan(),
  scope: 'localized',
  reason: 'Replace the test tile, preserving the inset and surrounding texture.',
  editRegions: [rectangle(100, 100, 900, 900)],
  protectedRegions: [rectangle(400, 400, 600, 600)],
}

async function texture(width = 160, height = 160): Promise<ImageReference> {
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % 4 === 3 ? 255 : (i * 73) % 256
  const data = await sharp(pixels, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer()
  return { name: 'texture.png', mediaType: 'image/png', data }
}

test('Masked compositing preserves every protected pixel even when the model repaints the entire image', async () => {
  const canvas = await texture()
  const mask = await maskFromPlan(plan, canvas)
  const generated = await sharp({ create: { width: 160, height: 160, channels: 4, background: '#f03050' } })
    .png()
    .toBuffer()
  const output = await compositeImageEdit(generated, { canvas, mask, description: plan.reason })
  const original = await sharp(canvas.data).ensureAlpha().raw().toBuffer()
  const edited = await sharp(output).ensureAlpha().raw().toBuffer()
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  let protectedPixels = 0
  let changedProtectedPixels = 0
  for (let i = 0; i < alpha.length; i++) {
    if (alpha[i] !== 255) continue
    protectedPixels++
    if (!original.subarray(i * 4, i * 4 + 4).equals(edited.subarray(i * 4, i * 4 + 4))) changedProtectedPixels++
  }
  const at = (x: number, y: number) => (y * 160 + x) * 4
  assert({
    given: 'a generated replacement that also changes all supposedly untouched regions',
    should: 'copy protected pixels exactly, including holes, with feathering confined to the mask',
    actual: {
      protectedPixels: protectedPixels > 1000,
      changedProtectedPixels,
      insetProtected: alpha[80 * 160 + 80] === 255,
      editedInterior: [...edited.subarray(at(40, 40), at(40, 40) + 4)],
      softEdges: alpha.some((value) => value > 0 && value < 255),
    },
    expected: {
      protectedPixels: true,
      changedProtectedPixels: 0,
      insetProtected: true,
      editedInterior: [240, 48, 80, 255],
      softEdges: true,
    },
  })
})

test('Masked compositing can erase a background to transparency without flattening protected pixels', async () => {
  const canvas = await texture()
  const mask = await maskFromPlan(plan, canvas)
  const transparent = await sharp({
    create: { width: 160, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .toBuffer()
  const output = await compositeImageEdit(transparent, { canvas, mask, description: plan.reason })
  const alpha = await sharp(output).extractChannel('alpha').raw().toBuffer()
  assert({
    given: 'a transparent generated region surrounded by protected source pixels',
    should: 'replace alpha as well as color in editable areas',
    actual: [alpha[40 * 160 + 40], alpha[80 * 160 + 80], alpha[0]],
    expected: [0, 255, 255],
  })
})

test('Masks reject invalid geometry, missing alpha, no-op, whole-frame and mismatched inputs', async () => {
  const canvas = await texture()
  const solid = async (alpha: number, width = 160) =>
    sharp({ create: { width, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha } } })
      .png()
      .toBuffer()
  const rgb = await sharp(canvas.data).removeAlpha().png().toBuffer()
  const failures: string[] = []
  const checks = [
    async () => validateEditMask(await solid(1), canvas),
    async () => validateEditMask(await solid(0), canvas),
    async () => validateEditMask(await solid(1, 128), canvas),
    async () => validateEditMask(rgb, canvas),
    async () => maskFromPlan({ ...plan, editRegions: [] }, canvas),
    async () => maskFromPlan({ ...plan, editRegions: [rectangle(-1, 0, 200, 200)] }, canvas),
    async () => maskFromPlan({ ...plan, editRegions: [rectangle(20, 20, 20, 20)], protectedRegions: [] }, canvas),
  ]
  for (const check of checks) {
    try {
      await check()
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'unsafe or ineffective masks',
    should: 'reject every one before rendering',
    actual: failures.length,
    expected: checks.length,
  })
})

test('The source and supplied mask share the same uncropped output canvas, including padding', async () => {
  const reference = await texture(160, 80)
  const sourceMask = await maskFromPlan(plan, reference)
  const canvas = await imageCanvas(reference, '256x256')
  const mask = await prepareExplicitMask(sourceMask.data, reference, canvas)
  const base = await sharp(canvas.data).metadata()
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  const sourceAlpha = await sharp(canvas.data).extractChannel('alpha').raw().toBuffer()
  assert({
    given: 'a wide reference and matching source mask fitted to a square output',
    should: 'pad both consistently, protect padding, and keep the protected inset aligned',
    actual: [base.width, base.height, sourceAlpha[0], alpha[0], alpha[128 * 256 + 128], alpha[100 * 256 + 70] === 0],
    expected: [256, 256, 0, 255, 255, true],
  })
})

test('A differently sized result or a cancellation cannot escape as an unprotected image', async () => {
  const canvas = await texture()
  const mask = await maskFromPlan(plan, canvas)
  const wrong = await texture(80, 80)
  const controller = new AbortController()
  controller.abort(new Error('Cancelled test edit'))
  const messages: string[] = []
  for (const [data, signal] of [
    [wrong.data, undefined],
    [canvas.data, controller.signal],
  ] as const) {
    try {
      await compositeImageEdit(data, { canvas, mask, description: plan.reason }, signal)
    } catch (error) {
      messages.push((error as Error).message)
    }
  }
  assert({
    given: 'an output that does not align with the mask, and a cancelled edit',
    should: 'fail both without rescaling an unaligned generated image or dropping the mask',
    actual: [messages.length, messages[0]?.includes('cannot be aligned'), messages[1]],
    expected: [2, true, 'Cancelled test edit'],
  })
})
