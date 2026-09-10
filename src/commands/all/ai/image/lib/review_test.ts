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
      content.slice(1).map((part) => [part.type, part.detail]),
      (body.reasoning as { effort: string }).effort,
      !!signal,
      result,
    ],
    expected: [
      ['original', 'raw generation', 'final composite to review', 'original with permitted working area in cyan'],
      'Keep the flat graphic style and sharp outlines.',
      true,
      Array.from({ length: 4 }, () => ['input_image', 'high']),
      'high',
      true,
      passedReview,
    ],
  })
})
