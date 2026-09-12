import { createOpenAI } from '@ai-sdk/openai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { passedReview, testMaskPlan } from './imageEditTestHelpers.ts'
import { maskFromPlan } from './mask.ts'
import { reviewImageEdit } from './review.ts'

test('Visual review sees the source, raw generation, final composite and permitted workspace in a declared order', async () => {
  let body: Record<string, unknown> = {}
  let signal: AbortSignal | null | undefined
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      signal = init?.signal
      return Response.json({
        id: 'review-test',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'review-message',
            content: [{ type: 'output_text', text: JSON.stringify(passedReview), annotations: [] }],
          },
        ],
      })
    }) as typeof fetch,
  })
  const data = await sharp({ create: { width: 160, height: 128, channels: 4, background: '#206080' } })
    .png()
    .toBuffer()
  const canvas = { name: 'graphic.png', mediaType: 'image/png' as const, data }
  const plan = { ...testMaskPlan(), edges: 'hard' as const }
  const mask = await maskFromPlan(plan, canvas)
  const result = await reviewImageEdit(
    {
      prompt: 'Replace the center icon, preserving the lettering.',
      brief: 'Keep the flat graphic style and sharp outlines.',
      generated: data,
      composite: data,
      edit: { canvas, mask, generationMask: mask, plan, complexity: 'complex', description: plan.changes },
      allowMaskRevision: true,
    },
    { model: { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') } },
  )
  const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const content = input.find((message) => message.role === 'user')!.content
  const context = JSON.parse(String(content[0]!.text))
  assert({
    given: 'a complex graphic edit with preservation constraints',
    should: 'review the actual composite and its evidence with structured checks and high image detail',
    actual: [
      context.imageOrder,
      context.brief,
      context.allowMaskRevision,
      context.finalImageFacts,
      content.slice(1).map((part) => [part.type, part.detail]),
      (body.reasoning as { effort: string }).effort,
      !!signal,
      result,
    ],
    expected: [
      ['original', 'raw generation', 'final composite to review', 'original with permitted working area in cyan'],
      'Keep the flat graphic style and sharp outlines.',
      true,
      { width: 160, height: 128, transparentPixels: 0, fractionalAlphaPixels: 0, opaquePixels: 20480 },
      Array.from({ length: 4 }, () => ['input_image', 'high']),
      'high',
      true,
      passedReview,
    ],
  })
})

test('Mixed review labels and transmits actual raw artwork separately from composed overlays and the previous best', async () => {
  let body: Record<string, unknown> = {}
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      return Response.json({
        id: 'mixed-review-test',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'mixed-review-message',
            content: [
              { type: 'output_text', text: JSON.stringify({ ...passedReview, comparison: 'better' }), annotations: [] },
            ],
          },
        ],
      })
    }) as typeof fetch,
  })
  const [source, preparedWithOverlays, composite, rawArtwork, previousBest] = await Promise.all(
    ['#204060', '#406080', '#608020', '#802040', '#a04060'].map((background) =>
      sharp({ create: { width: 160, height: 128, channels: 4, background } })
        .png()
        .toBuffer(),
    ),
  )
  const canvas = { name: 'panel.png', mediaType: 'image/png' as const, data: source! }
  const plan = { ...testMaskPlan(), edges: 'hard' as const }
  const mask = await maskFromPlan(plan, canvas)
  const previousAssessment = { ...passedReview, score: 70, comparison: 'first' as const }
  await reviewImageEdit(
    {
      prompt: 'Repaint the panel and add exact lettering.',
      generated: preparedWithOverlays!,
      composite: composite!,
      rawArtwork: rawArtwork!,
      edit: { canvas, mask, generationMask: mask, plan, complexity: 'complex', description: plan.changes },
      allowMaskRevision: false,
      previous: { data: previousBest!, assessment: previousAssessment },
    },
    { model: { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') } },
  )
  const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const content = input.find((message) => message.role === 'user')!.content
  const context = JSON.parse(String(content[0]!.text))
  const pixels = await Promise.all(
    content.slice(1).map(async (part) => {
      const data = Buffer.from(String(part.image_url).split(',')[1]!, 'base64')
      const pixel = await sharp(data).extract({ left: 0, top: 0, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()
      return [...pixel]
    }),
  )
  assert({
    given:
      'the actual paid artwork, prepared overlay candidate, preserved result and previous best contain different pixels',
    should: 'make their evidence roles explicit and transmit the matching image bytes in exactly that order',
    actual: [
      context.imageOrder,
      pixels,
      context.previousAssessment,
      context.allowMaskRevision,
      content.slice(1).map((part) => [part.type, part.detail]),
    ],
    expected: [
      [
        'original',
        'prepared artwork with drawing overlays before final preservation',
        'final composite to review',
        'original with permitted working area in cyan',
        'actual raw artwork generation, before any compositing or vector overlays',
        'previous best composite',
      ],
      [
        [32, 64, 96, 255],
        [64, 96, 128, 255],
        [96, 128, 32, 255],
        [32, 64, 96, 255],
        [128, 32, 64, 255],
        [160, 64, 96, 255],
      ],
      previousAssessment,
      false,
      Array.from({ length: 6 }, () => ['input_image', 'high']),
    ],
  })
})
