import sharp from 'sharp'
import { assert, test } from '#test'
import { focusImageEdit } from './focus.ts'
import { testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { compositeImageEdit, maskFromPlan } from './mask.ts'
import { validateSize } from './options.ts'

async function fixture(width = 2048, height = 1536, region = testRegion(400, 350, 600, 650)) {
  const pixels = Buffer.alloc(width * height * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 17) % 256
    pixels[i + 1] = (i * 31) % 256
    pixels[i + 2] = 150
    pixels[i + 3] = i % 28 === 0 ? 0 : i % 20 === 0 ? 100 : 255
  }
  const canvas = {
    name: 'source.png',
    mediaType: 'image/png' as const,
    data: await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
  }
  const plan = { ...testMaskPlan([region]), edges: 'hard' as const, generationRegions: [region] }
  const mask = await maskFromPlan(plan, canvas)
  return { canvas, mask, generationMask: mask, plan, description: plan.changes }
}

test('Focused edits preserve source scale, full mask coverage and enough context', async () => {
  const edit = await fixture()
  const focused = (await focusImageEdit(edit))!
  const actual = await sharp(focused.canvas.data).ensureAlpha().raw().toBuffer()
  const expected = await sharp(edit.canvas.data).extract(focused.geometry.source).ensureAlpha().raw().toBuffer()
  const { width, height } = await sharp(focused.canvas.data).metadata()
  const alpha = await sharp(focused.mask.data).extractChannel('alpha').raw().toBuffer()
  const originalAlpha = await sharp(edit.mask.data).extractChannel('alpha').raw().toBuffer()
  assert({
    given: 'a localized change on a larger output canvas with transparency and fine source detail',
    should: 'provide a supported, smaller view at exactly the same pixel scale and retain every editable pixel',
    actual: [
      validateSize(focused.size),
      width * height < 2048 * 1536 * 0.85,
      actual.equals(expected),
      alpha.filter((a) => a < 255).length,
      focused.geometry.source.left < 2048 * 0.4 - 64,
      focused.geometry.source.top < 1536 * 0.35 - 64,
    ],
    expected: [null, true, true, originalAlpha.filter((a) => a < 255).length, true, true],
  })
})

test('Focused restoration copies RGBA exactly outside the crop and retains generated transparency inside it', async () => {
  const edit = await fixture()
  const focused = (await focusImageEdit(edit))!
  const [width, height] = focused.size.split('x').map(Number)
  const generated = await sharp({
    create: { width, height, channels: 4, background: { r: 220, g: 40, b: 10, alpha: 0.5 } },
  })
    .png()
    .toBuffer()
  const restored = await focused.restore(generated)
  const raw = await sharp(restored).ensureAlpha().raw().toBuffer()
  const original = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer()
  const source = focused.geometry.source
  let changedOutside = 0
  for (let y = 0; y < 1536; y++)
    for (let x = 0; x < 2048; x++) {
      if (x >= source.left && x < source.left + source.width && y >= source.top && y < source.top + source.height)
        continue
      const offset = (y * 2048 + x) * 4
      if (!raw.subarray(offset, offset + 4).equals(original.subarray(offset, offset + 4))) changedOutside++
    }
  const center = (768 * 2048 + 1024) * 4
  const final = await sharp(await compositeImageEdit(restored, edit))
    .ensureAlpha()
    .raw()
    .toBuffer()
  const alpha = await sharp(edit.mask.data).extractChannel('alpha').raw().toBuffer()
  let changedProtected = 0
  for (let i = 0; i < alpha.length; i++)
    if (alpha[i] === 255 && !final.subarray(i * 4, i * 4 + 4).equals(original.subarray(i * 4, i * 4 + 4)))
      changedProtected++
  assert({
    given: 'a generated crop with partly transparent replacement pixels',
    should: 'restore without scaling or alpha-over blending, then preserve all protected source pixels',
    actual: [changedOutside, [...raw.subarray(center, center + 4)], changedProtected],
    expected: [0, [220, 40, 10, 128], 0],
  })
})

test('Focused views handle tall, wide and edge targets without losing their editable bounds', async () => {
  const results: unknown[] = []
  for (const [width, height, region] of [
    [768, 3072, testRegion(20, 10, 450, 160)],
    [3072, 768, testRegion(820, 600, 990, 980)],
    [400, 3840, testRegion(20, 10, 980, 60)],
  ] as const) {
    const edit = await fixture(width, height, region)
    const focus = (await focusImageEdit(edit))!
    const original = await sharp(edit.mask.data).extractChannel('alpha').raw().toBuffer()
    const focused = await sharp(focus.mask.data).extractChannel('alpha').raw().toBuffer()
    const restored = await sharp(await focus.restore(focus.canvas.data))
      .ensureAlpha()
      .raw()
      .toBuffer()
    const expected = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer()
    results.push([
      validateSize(focus.size),
      focused.filter((a) => a < 255).length === original.filter((a) => a < 255).length,
      restored.equals(expected),
      focus.geometry.source.left >= 0,
      focus.geometry.source.top >= 0,
    ])
  }
  assert({
    given: 'targets near canvas edges, including an extreme portrait needing protected padding',
    should: 'retain all editable pixels and round-trip the original exactly through supported focused canvases',
    actual: results,
    expected: Array.from({ length: 3 }, () => [null, true, true, true, true]),
  })
})

test('Focus skips near-full edits and rejects misaligned results and cancellation', async () => {
  const edit = await fixture()
  const focus = (await focusImageEdit(edit))!
  const full = await fixture(2048, 1536, testRegion(10, 10, 990, 990))
  let mismatch = false
  try {
    await focus.restore(edit.canvas.data)
  } catch (error) {
    mismatch = (error as Error).message.includes('dimensions changed')
  }
  const controller = new AbortController()
  controller.abort(new Error('Cancelled focus'))
  let cancelled = false
  try {
    await focusImageEdit(edit, { signal: controller.signal })
  } catch (error) {
    cancelled = (error as Error).message === 'Cancelled focus'
  }
  assert({
    given: 'a broad edit, disabled focus, a wrongly sized result and a cancelled request',
    should: 'retain full framing when appropriate and refuse unsafe or cancelled restoration',
    actual: [await focusImageEdit(full), await focusImageEdit(edit, { enabled: false }), mismatch, cancelled],
    expected: [undefined, undefined, true, true],
  })
})
