import { createOpenAI } from '@ai-sdk/openai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { testMaskPlan } from './imageEditTestHelpers.ts'
import { planImageMask } from './maskPlan.ts'

test('Mask planning uses a detailed view, normalized structured contours and cancellation', async () => {
  let body: Record<string, unknown> = {}
  let signal: AbortSignal | null | undefined
  const decision = {
    ...testMaskPlan(),
    scope: 'localized',
    reason: 'Change the large tile; protect its inset.',
    editRegions: [
      {
        label: 'Tile',
        points: [
          { x: 200, y: 200 },
          { x: 800, y: 200 },
          { x: 800, y: 800 },
          { x: 200, y: 800 },
        ],
      },
    ],
    protectedRegions: [
      {
        label: 'Inset',
        points: [
          { x: 400, y: 400 },
          { x: 600, y: 400 },
          { x: 600, y: 600 },
          { x: 400, y: 600 },
        ],
      },
    ],
  }
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body))
      signal = init?.signal
      return Response.json({
        id: 'response-mask-test',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'message-mask-test',
            content: [{ type: 'output_text', text: JSON.stringify(decision), annotations: [] }],
          },
        ],
      })
    }) as typeof fetch,
  })
  const data = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: '#c0d0e0' } })
    .png()
    .toBuffer()
  const plan = await planImageMask(
    {
      prompt: 'Repaint the tile.',
      brief: 'Keep all surrounding texture and the inset.',
      reference: { name: 'tile.png', mediaType: 'image/png', data },
      complexity: 'complex',
    },
    { model: { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') } },
  )
  const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const content = input.find((message) => message.role === 'user')!.content
  const image = content.find((part) => part.type === 'input_image')!
  const preview = await sharp(Buffer.from(String(image.image_url).split(',')[1]!, 'base64')).metadata()
  assert({
    given: 'the mask planner receives an output canvas and preservation context',
    should: 'use Astra high with detailed previews and separate working, blending and protection contours',
    actual: [
      body.model,
      (body.reasoning as { effort: string }).effort,
      image.detail,
      preview.width,
      preview.height,
      (body.text as { format: { type: string } }).format.type,
      !!signal,
      plan,
    ],
    expected: ['gpt-6-astra', 'high', 'high', 1536, 1152, 'json_schema', true, decision],
  })
})
