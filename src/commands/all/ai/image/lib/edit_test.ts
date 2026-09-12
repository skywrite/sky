import sharp from 'sharp'
import { assert, test } from '#test'
import { prepareImageEdit } from './edit.ts'
import type { ImageEditRequest, PreparedImageEdit } from './edit.ts'
import { testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { compositeImageEdit } from './mask.ts'
import type { ImageMaskPlan } from './maskPlan.ts'
import { validateSize } from './options.ts'
import { graphicEditSize, photoEditSize } from './resolution.ts'

const localized: ImageMaskPlan = {
  ...testMaskPlan(),
  scope: 'localized',
  reason: 'Change only the center tile.',
  editRegions: [
    {
      label: 'Tile',
      points: [
        { x: 300, y: 300 },
        { x: 700, y: 300 },
        { x: 700, y: 700 },
        { x: 300, y: 700 },
      ],
    },
  ],
  protectedRegions: [],
}

async function request(): Promise<ImageEditRequest> {
  const data = await sharp({ create: { width: 240, height: 320, channels: 3, background: '#d0d0d0' } })
    .png()
    .toBuffer()
  return {
    prompt: 'Repaint the center tile blue.',
    intent: 'preserve_photo',
    refs: [{ name: 'tiles.png', mediaType: 'image/png', data }],
  }
}

test('Photo edit sizing targets about 8 MP in the reference proportions within every API limit', () => {
  const sizes = [
    [3, 4],
    [4, 3],
    [1, 1],
    [16, 9],
    [9, 16],
    [3, 1],
    [1, 3],
    [8, 1],
    [1, 8],
    [2999, 1000],
  ].map(([w, h]) => photoEditSize(w!, h!))
  assert({
    given: 'portrait, landscape, square and panoramic references',
    should: 'choose large valid canvases, retain ordinary proportions and bound extreme aspect ratios',
    actual: { portrait: sizes[0], landscape: sizes[1], allValid: sizes.every((size) => validateSize(size) === null) },
    expected: { portrait: '2448x3264', landscape: '3264x2448', allValid: true },
  })
})

test('Default photo edits keep the large output size and original reference without invoking mask planning', async () => {
  const input = await request()
  const original = Buffer.from(input.refs[0]!.data)
  const results: PreparedImageEdit[] = []
  let called = false
  for (const method of [undefined, 'image'] as const) {
    for (const size of [undefined, 'auto', '768x1024']) {
      results.push(
        await prepareImageEdit({ ...input, method, size }, async () => {
          called = true
          return localized
        }),
      )
    }
  }
  const metadata = await sharp(input.refs[0]!.data).metadata()
  assert({
    given: 'ordinary photo edits with implicit or explicit image method and automatic or explicit dimensions',
    should:
      'retain the approximately 8 MP default and explicit sizes while leaving the original reference untouched and skipping masks',
    actual: [results, called, original.equals(Buffer.from(input.refs[0]!.data)), [metadata.width, metadata.height]],
    expected: [
      [
        { size: '2448x3264' },
        { size: '2448x3264' },
        { size: '768x1024' },
        { size: '2448x3264' },
        { size: '2448x3264' },
        { size: '768x1024' },
      ],
      false,
      true,
      [240, 320],
    ],
  })
})

test('Explicit automatic photo masks resolve a large canvas before the mask planner sees the reference', async () => {
  const input = await request()
  let plannerSize: number[] = []
  const result = await prepareImageEdit({ ...input, size: 'auto', mask: 'auto' }, async ({ reference }) => {
    const metadata = await sharp(reference.data).metadata()
    plannerSize = [metadata.width, metadata.height]
    return localized
  })
  assert({
    given: 'a photographic edit with automatic size and mask',
    should: 'plan against the actual 8 MP canvas and retain its mask for compositing',
    actual: [result.size, plannerSize, result.edit?.mask.mediaType, result.preservation?.includes('output resolution')],
    expected: ['2448x3264', [2448, 3264], 'image/png', true],
  })
})

test('Graphic preservation keeps a supported native grid and sends complexity to the mask planner', async () => {
  const small = await request()
  const input = {
    ...small,
    refs: [{ ...small.refs[0]!, data: await sharp(small.refs[0]!.data).resize(1024, 768).png().toBuffer() }],
  }
  let effort: string | undefined
  const result = await prepareImageEdit(
    { ...input, intent: 'preserve_image', complexity: 'complex', mask: 'auto' },
    async (request) => {
      effort = request.complexity
      return { ...localized, edges: 'hard' }
    },
  )
  const mask = await sharp(result.edit!.mask.data).extractChannel('alpha').raw().toBuffer()
  const working = await sharp(result.edit!.generationMask!.data).extractChannel('alpha').raw().toBuffer()
  const margin = 200 * 1024 + 200
  assert({
    given: 'a graphic whose original dimensions are supported and whose replacement needs more room',
    should: 'retain the native grid, use careful planning, and preserve pixels allowed only as generation context',
    actual: [result.size, effort, mask[margin], working[margin], result.edit?.plan?.edges],
    expected: ['1024x768', 'complex', 255, 0, 'hard'],
  })
  assert({
    given: 'small, unsupported or oversized graphic canvases',
    should: 'choose valid dimensions while retaining supported native dimensions exactly',
    actual: [
      graphicEditSize(1024, 768),
      [
        [32, 32],
        [513, 777],
        [8000, 9000],
        [1, 8],
      ].every(([w, h]) => validateSize(graphicEditSize(w!, h!)) === null),
    ],
    expected: ['1024x768', true],
  })
})

test('Explicit size and mask choices work independently of automatic resolution', async () => {
  const input = await request()
  const first = await prepareImageEdit({ ...input, size: '768x1024', mask: 'auto' }, async () => localized)
  let called = false
  const second = await prepareImageEdit({ ...input, size: '768x1024', mask: first.edit!.mask.data }, async () => {
    called = true
    return localized
  })
  const disabled = await prepareImageEdit({ ...input, mask: 'none' }, async () => {
    throw new Error('Mask planner must not run')
  })
  assert({
    given: 'an explicit smaller canvas, supplied mask, and deliberate whole-image edit',
    should: 'honor each choice without silently turning off the large photo default',
    actual: [first.size, second.size, !!second.edit, called, disabled.size, !!disabled.edit],
    expected: ['768x1024', '768x1024', true, false, '2448x3264', false],
  })
})

test('Drawing edits retain a small native icon grid and exact protected source pixels', async () => {
  const pixels = Buffer.alloc(64 * 64 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 17) % 256
    pixels[i + 1] = 110
    pixels[i + 2] = 190
    pixels[i + 3] = i % 28 === 0 ? 0 : i % 20 === 0 ? 100 : 255
  }
  const data = await sharp(pixels, { raw: { width: 64, height: 64, channels: 4 } })
    .png()
    .toBuffer()
  const input: ImageEditRequest = {
    prompt: 'Repaint the center icon, preserving its inset and the surrounding design.',
    intent: 'preserve_image',
    method: 'drawing',
    size: 'auto',
    refs: [{ name: 'icon.png', mediaType: 'image/png', data }],
  }
  let plannerSize: number[] = []
  const result = await prepareImageEdit(input, async ({ reference }) => {
    const metadata = await sharp(reference.data).metadata()
    plannerSize = [metadata.width, metadata.height]
    return { ...testMaskPlan([testRegion(200, 200, 800, 800)], [testRegion(450, 450, 550, 550)]), edges: 'hard' }
  })
  const generated = await sharp({ create: { width: 64, height: 64, channels: 4, background: '#e06020' } })
    .png()
    .toBuffer()
  const output = await sharp(await compositeImageEdit(generated, result.edit!))
    .ensureAlpha()
    .raw()
    .toBuffer()
  const source = await sharp(data).ensureAlpha().raw().toBuffer()
  const base = await sharp(result.edit!.canvas.data).ensureAlpha().raw().toBuffer()
  const mask = await sharp(result.edit!.mask.data).extractChannel('alpha').raw().toBuffer()
  let changedProtected = 0
  for (let i = 0; i < mask.length; i++)
    if (mask[i] === 255 && !source.subarray(i * 4, i * 4 + 4).equals(output.subarray(i * 4, i * 4 + 4)))
      changedProtected++
  const editable = (20 * 64 + 20) * 4
  assert({
    given: 'a native 64px drawing edit with transparent detail and a protected inset',
    should: 'plan and composite on the unchanged source grid while preserving every protected RGBA value',
    actual: [
      result.size,
      plannerSize,
      base.equals(source),
      changedProtected,
      [...output.subarray(editable, editable + 4)],
    ],
    expected: ['64x64', [64, 64], true, 0, [224, 96, 32, 255]],
  })
})

test('Drawing and mixed edits retain automatic preservation when the mask is omitted', async () => {
  const input = { ...(await request()), intent: 'preserve_image' as const, size: '768x1024' }
  const calls: string[] = []
  const results: PreparedImageEdit[] = []
  for (const method of ['drawing', 'mixed'] as const) {
    results.push(
      await prepareImageEdit({ ...input, method }, async () => {
        calls.push(method)
        return { ...localized, edges: 'hard' }
      }),
    )
  }
  assert({
    given: 'localized drawing and mixed edits without an explicit mask choice',
    should: 'keep their automatic preservation workflow and explicit output dimensions',
    actual: [calls, results.map((result) => [result.size, !!result.edit?.plan, !!result.edit?.generationMask])],
    expected: [
      ['drawing', 'mixed'],
      [
        ['768x1024', true, true],
        ['768x1024', true, true],
      ],
    ],
  })
})

test('Drawing edits honor explicit nongrid dimensions and supplied masks while image and mixed sizing remain unchanged', async () => {
  const input = { ...(await request()), intent: 'preserve_image' as const, method: 'drawing' as const }
  const first = await prepareImageEdit({ ...input, size: '63x65' }, async () => ({ ...localized, edges: 'hard' }))
  let planned = false
  const explicit = await prepareImageEdit({ ...input, size: '63x65', mask: first.edit!.mask.data }, async () => {
    planned = true
    return localized
  })
  const image = await prepareImageEdit({ ...input, method: 'image', mask: 'none' })
  const mixed = await prepareImageEdit({ ...input, method: 'mixed', mask: 'none' })
  const failures: string[] = []
  for (const invalid of [
    { ...input, size: '8193x1', mask: 'none' as const },
    { ...input, refs: [], size: '8192x8192' },
    { ...input, size: '64x64', mask: first.edit!.mask.data },
  ]) {
    try {
      await prepareImageEdit(invalid, async () => localized)
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'a nongrid drawing canvas, an explicit mask, raster/mixed methods and invalid drawing constraints',
    should:
      'honor drawing sizes without planning supplied masks, retain raster sizing, and reject unsafe dimensions or mask misalignment',
    actual: [
      first.size,
      explicit.size,
      planned,
      Buffer.from(explicit.edit!.mask.data).equals(Buffer.from(first.edit!.mask.data)),
      image.size,
      mixed.size,
      failures.map((message) => /1 to 8192|16,777,216 pixels|mask must match/.test(message)),
    ],
    expected: ['63x65', '63x65', false, true, graphicEditSize(240, 320), graphicEditSize(240, 320), [true, true, true]],
  })
})

test('Creation and creative transformations do not receive photographic masks or large defaults', async () => {
  const input = await request()
  const results: PreparedImageEdit[] = []
  for (const intent of ['create', 'transform', 'other_edit'] as const) {
    results.push(
      await prepareImageEdit({ ...input, intent }, async () => {
        throw new Error('Mask planner must not run')
      }),
    )
  }
  results.push(
    await prepareImageEdit({ ...input, refs: [] }, async () => {
      throw new Error('No reference to mask')
    }),
  )
  assert({
    given: 'ordinary generation and transformations',
    should: 'leave size selection to the model',
    actual: results,
    expected: [{ size: undefined }, { size: undefined }, { size: undefined }, { size: undefined }],
  })
})

test('Whole-image requests are explicit in the result; uncertain masks and planner failures stop the edit', async () => {
  const input = { ...(await request()), size: '768x1024', mask: 'auto' as const }
  const whole = await prepareImageEdit(input, async () => ({
    ...testMaskPlan(),
    scope: 'whole_image',
    reason: 'Adjust lighting throughout.',
    editRegions: [],
    protectedRegions: [],
  }))
  const errors: string[] = []
  for (const planner of [
    async (): Promise<ImageMaskPlan> => ({
      ...testMaskPlan(),
      scope: 'uncertain',
      reason: 'The requested object is ambiguous.',
      editRegions: [],
      protectedRegions: [],
    }),
    async (): Promise<ImageMaskPlan> => {
      throw new Error('Mask service unavailable')
    },
  ]) {
    try {
      await prepareImageEdit(input, planner)
    } catch (error) {
      errors.push((error as Error).message)
    }
  }
  assert({
    given: 'a global lighting change and two unsuccessful localized mask preparations',
    should: 'describe the whole-image scope and never fall back to unmasked generation after failure',
    actual: [!!whole.edit, whole.preservation, errors.length, errors[0]?.includes('Clarify'), errors[1]],
    expected: [false, 'Whole-image edit: Adjust lighting throughout.', 2, true, 'Mask service unavailable'],
  })
})

test('Cancellation after mask planning stops preparation', async () => {
  const controller = new AbortController()
  let stopped = false
  try {
    await prepareImageEdit(
      { ...(await request()), size: '768x1024', mask: 'auto', signal: controller.signal },
      async () => {
        controller.abort(new Error('Cancelled test planning'))
        return localized
      },
    )
  } catch (error) {
    stopped = (error as Error).message === 'Cancelled test planning'
  }
  assert({
    given: 'a cancelled planning request',
    should: 'stop before rasterizing or rendering',
    actual: stopped,
    expected: true,
  })
})
