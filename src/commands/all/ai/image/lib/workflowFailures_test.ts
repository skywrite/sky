import sharp from 'sharp'
import { assert, test } from '#test'
import { passedReview, testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { maskFromPlan } from './mask.ts'
import type { MaskedImageEdit } from './mask.ts'
import type { ImageSelection } from './preflight.ts'
import { runImageWorkflow } from './workflow.ts'

const selection: ImageSelection = {
  method: 'image',
  layout: 'square',
  intent: 'create',
  complexity: 'simple',
  model: 'gpt-image-2.5-flare',
  quality: 'medium',
  reason: 'Synthetic test image.',
}

async function color(value: string) {
  return sharp({ create: { width: 128, height: 128, channels: 4, background: value } })
    .png()
    .toBuffer()
}

async function maskedScene(): Promise<{ edit: MaskedImageEdit; generated: Uint8Array }> {
  const canvas = { name: 'synthetic.png', mediaType: 'image/png' as const, data: await color('#204080') }
  const plan = {
    ...testMaskPlan([testRegion(300, 300, 700, 700)], [testRegion(450, 450, 550, 550)]),
    edges: 'hard' as const,
  }
  const mask = await maskFromPlan(plan, canvas)
  const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
  return {
    edit: {
      canvas,
      plan,
      mask,
      generationMask,
      complexity: 'simple',
      description: 'Replace a tile and preserve the inset.',
    },
    generated: await color('#f07820'),
  }
}

test('A failed later image does not discard completed images from the same paid batch', async () => {
  const data = await color('#f07820')
  let calls = 0
  const images = await runImageWorkflow(
    { prompt: 'Create two orange tiles.', refs: [], selection, count: 2, maxAttempts: 1, budgetMs: 5000 },
    {
      renderImages: async () => {
        calls++
        if (calls === 2) throw new Error('Synthetic provider outage on image two')
        return [{ data, generated: data, generationPrompt: 'Create an orange tile.' }]
      },
      assessImage: async () => passedReview,
    },
  )
  assert({
    given: 'a first completed image followed by a provider failure before the second image exists',
    should: 'retain the completed image and report that the batch was interrupted',
    actual: [images.length, Buffer.from(images[0].data).equals(data), !!images[0].batchWarning, calls],
    expected: [1, true, true, 2],
  })
})

test('A mixed overlay failure retains paid artwork with protected pixels intact and review marked incomplete', async () => {
  const { edit, generated } = await maskedScene()
  const images = await runImageWorkflow(
    {
      prompt: 'Replace the tile with textured orange artwork and add READY.',
      refs: [edit.canvas],
      edit,
      size: '128x128',
      selection: { ...selection, method: 'mixed', intent: 'preserve_image' },
      count: 1,
      maxAttempts: 1,
      budgetMs: 5000,
    },
    {
      planMixedImage: async () => ({
        artworkPrompt: 'Orange texture.',
        drawingPrompt: 'Add READY.',
        artworkScope: 'objects',
        regenerateArtwork: true,
        reason: 'Combine artwork and precise type.',
      }),
      renderImages: async () => [{ data: generated, generated, generationPrompt: 'Orange texture.' }],
      refineImageMask: async () => edit.generationMask!,
      planDrawing: async () => {
        throw new Error('Synthetic overlay planner outage')
      },
    },
  )
  const image = images[0]
  const source = await sharp(edit.canvas.data).ensureAlpha().raw().toBuffer()
  const output = await sharp(image.data).ensureAlpha().raw().toBuffer()
  const permission = await sharp(edit.generationMask!.data).extractChannel('alpha').raw().toBuffer()
  let damaged = 0
  for (let pixel = 0; pixel < permission.length; pixel++) {
    if (
      permission[pixel] === 255 &&
      !source.subarray(pixel * 4, pixel * 4 + 4).equals(output.subarray(pixel * 4, pixel * 4 + 4))
    )
      damaged++
  }
  const at = (x: number, y: number) => [...output.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)]
  assert({
    given: 'a completed raster repaint followed by failure to plan its precise text layer',
    should: 'keep useful bounded artwork and its evidence without claiming the requested design passed',
    actual: [
      images.length,
      damaged,
      at(30, 30),
      at(64, 64),
      image.review?.status,
      image.attempts.stopped,
      image.versions.length,
      !!image.artwork,
    ],
    expected: [1, 0, [240, 120, 32, 255], [32, 64, 128, 255], 'unavailable', 'generation_error', 1, true],
  })
})

test('Explicit cancellation during a mixed overlay still propagates after artwork was checkpointed', async () => {
  const { edit, generated } = await maskedScene()
  const controller = new AbortController()
  let message = ''
  try {
    await runImageWorkflow(
      {
        prompt: 'Create a mixed design.',
        refs: [edit.canvas],
        edit,
        size: '128x128',
        selection: { ...selection, method: 'mixed', intent: 'preserve_image' },
        count: 1,
        maxAttempts: 1,
        budgetMs: 5000,
        signal: controller.signal,
      },
      {
        planMixedImage: async () => ({
          artworkPrompt: 'Orange texture.',
          drawingPrompt: 'Add READY.',
          artworkScope: 'objects',
          regenerateArtwork: true,
          reason: 'Combine artwork and precise type.',
        }),
        renderImages: async () => [{ data: generated, generated, generationPrompt: 'Orange texture.' }],
        refineImageMask: async () => edit.generationMask!,
        planDrawing: async () => {
          controller.abort(new Error('Cancelled synthetic mixed design'))
          controller.signal.throwIfAborted()
          throw new Error('Unreachable')
        },
      },
    )
  } catch (error) {
    message = (error as Error).message
  }
  assert({
    given: 'user cancellation after the artwork was generated',
    should: 'honor cancellation rather than report a successful partial design',
    actual: message,
    expected: 'Cancelled synthetic mixed design',
  })
})
