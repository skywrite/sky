import { createOpenAI } from '@ai-sdk/openai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { compositeImageEdit, maskFromPlan } from './mask.ts'
import { refineImageMask, refineMaskFromContours } from './refine.ts'
import type { ImageMaskRefinement } from './refine.ts'

async function fixture() {
  const pixels = Buffer.alloc(128 * 128 * 4)
  for (let y = 40; y < 70; y++) for (let x = 30; x < 55; x++) pixels.set([40, 100, 200, 255], (y * 128 + x) * 4)
  const canvas = {
    name: 'transparent-icon.png',
    mediaType: 'image/png' as const,
    data: await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } })
      .png()
      .toBuffer(),
  }
  const replacement = Buffer.alloc(pixels.length)
  for (let y = 40; y < 70; y++)
    for (let x = 60; x < 90; x++) replacement.set([230, 60, 30, x === 60 ? 128 : 255], (y * 128 + x) * 4)
  const generated = await sharp(replacement, { raw: { width: 128, height: 128, channels: 4 } })
    .png()
    .toBuffer()
  const plan = {
    ...testMaskPlan([testRegion(200, 300, 500, 600)], [testRegion(560, 400, 620, 500)]),
    edges: 'hard' as const,
  }
  const mask = await maskFromPlan(plan, canvas)
  const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
  return {
    edit: { canvas, mask, generationMask, plan, complexity: 'complex' as const, description: plan.changes },
    generated,
    prompt: 'Move the icon right, preserving the protected inset.',
  }
}

const refinement: ImageMaskRefinement = {
  confidence: 'high',
  reason: 'The old and new icon silhouettes are identifiable on transparent backgrounds.',
  edges: 'transparent_object',
  editRegions: [testRegion(0, 0, 1000, 1000)],
}

test('Transparent edge refinement removes the old silhouette and uses new alpha without disturbing protected holes', async () => {
  const request = await fixture()
  const mask = await refineMaskFromContours(request, refinement)
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  const output = await sharp(await compositeImageEdit(request.generated, { ...request.edit, mask }))
    .ensureAlpha()
    .raw()
    .toBuffer()
  const pixel = (x: number, y: number) => [...output.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)]
  assert({
    given: 'new transparent artwork, a wider-than-permitted contour and an immutable protected inset',
    should: 'erase old artwork, retain the new edge alpha and preserve the untouched empty background and inset',
    actual: [
      alpha[50 * 128 + 40],
      alpha[50 * 128 + 65],
      alpha[55 * 128 + 75],
      alpha[20 * 128 + 20],
      alpha[0],
      pixel(40, 50),
      pixel(60, 50),
      pixel(75, 55),
    ],
    expected: [0, 0, 255, 255, 255, [0, 0, 0, 0], [230, 60, 30, 128], [0, 0, 0, 0]],
  })
})

test('Opaque scenes use bounded contours, and uncertain or explicit masks remain fixed', async () => {
  const request = await fixture()
  const opaque = await sharp({ create: { width: 128, height: 128, channels: 4, background: '#d09060' } })
    .png()
    .toBuffer()
  request.generated = opaque
  const result = await refineMaskFromContours(request, refinement)
  const contours = await refineMaskFromContours(request, { ...refinement, edges: 'contours' })
  const uncertain = await refineMaskFromContours(request, { ...refinement, confidence: 'uncertain' })
  const explicit = await refineImageMask({ ...request, edit: { ...request.edit, plan: undefined } })
  const alpha = await sharp(result.data).extractChannel('alpha').raw().toBuffer()
  const limit = await sharp(request.edit.generationMask.data).extractChannel('alpha').raw().toBuffer()
  let widened = 0
  for (let i = 0; i < alpha.length; i++) if (alpha[i]! < limit[i]!) widened++
  assert({
    given: 'an opaque generated background, uncertain contours and a supplied user mask',
    should: 'avoid alpha segmentation of opaque images, never widen working permissions, and retain fixed masks',
    actual: [
      Buffer.from(result.data).equals(Buffer.from(contours.data)),
      widened,
      uncertain === request.edit.mask,
      explicit === request.edit.mask,
    ],
    expected: [true, 0, true, true],
  })
})

test('Vision contour refinement sees original and aligned generation with the immutable plan', async () => {
  let body: Record<string, unknown> = {}
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: 'refinement-test',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'refinement-message',
            content: [{ type: 'output_text', text: JSON.stringify(refinement), annotations: [] }],
          },
        ],
      })
    }) as typeof fetch,
  })
  const request = await fixture()
  const result = await refineImageMask(request, {
    model: { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') },
  })
  const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const content = input.find((message) => message.role === 'user')!.content
  const context = JSON.parse(String(content[0]!.text))
  assert({
    given: 'a complex artwork edit ready for final-footprint refinement',
    should: 'use detailed source and generated views, original protected constraints and high reasoning',
    actual: [
      context.imageOrder,
      context.plan.protectedRegions,
      content.slice(1).map((part) => [part.type, part.detail]),
      (body.reasoning as { effort: string }).effort,
      result.name,
    ],
    expected: [
      ['original full canvas', 'raw generation aligned to the full canvas'],
      request.edit.plan.protectedRegions,
      [
        ['input_image', 'high'],
        ['input_image', 'high'],
      ],
      'high',
      'refined-mask.png',
    ],
  })
})

test('Refinement inference failures keep the original mask while user cancellation propagates', async () => {
  const controller = new AbortController()
  let abort = false
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, _init?: RequestInit) => {
      if (abort) controller.abort(new Error('Cancelled refinement'))
      return Response.json({ error: { message: 'Mock refinement unavailable' } }, { status: 400 })
    }) as typeof fetch,
  })
  const request = await fixture()
  const options = { model: { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') } }
  const result = await refineImageMask(request, options)
  abort = true
  let cancelled = false
  try {
    await refineImageMask({ ...request, signal: controller.signal }, options)
  } catch (error) {
    cancelled = (error as Error).message === 'Cancelled refinement'
  }
  assert({
    given: 'a failed optional contour service and an explicit user cancellation',
    should: 'keep the existing preservation mask after failure but stop a cancelled request',
    actual: [result === request.edit.mask, cancelled],
    expected: [true, true],
  })
})
