import { createOpenAI } from '@ai-sdk/openai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { MAX_REF_IMAGES } from '../options.ts'
import { planDrawing } from './planner.ts'
import type { DrawingScene } from './schema.ts'
import { drawingScene, drawingStar } from './testHelpers.ts'

function mockPlanner(
  scene: DrawingScene,
  onRequest?: (body: Record<string, unknown>, signal: AbortSignal | null | undefined) => void,
) {
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      onRequest?.(JSON.parse(String(init?.body)), init?.signal)
      return Response.json({
        id: 'drawing-test',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'drawing-message',
            content: [{ type: 'output_text', text: JSON.stringify(scene), annotations: [] }],
          },
        ],
      })
    }) as typeof fetch,
  })
  return { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') }
}

test('Drawing planning receives reference context, constraints and corrections with true pixel coordinates', async () => {
  let body: Record<string, unknown> = {}
  let signal: AbortSignal | null | undefined
  const scene = {
    ...drawingScene([drawingStar({ cx: 320, cy: 256, outerRadius: 150, innerRadius: 70 })]),
    width: 2048,
    height: 1536,
  }
  const data = await sharp({ create: { width: 2048, height: 1536, channels: 4, background: '#206080' } })
    .png()
    .toBuffer()
  const previousScene = {
    ...scene,
    elements: [drawingStar({ cx: 320, cy: 256, outerRadius: 150, innerRadius: 70, points: 6 })],
  }
  const result = await planDrawing(
    {
      prompt: 'Add an eight-point orange star.',
      brief: 'Keep the Atlas label.',
      width: 2048,
      height: 1536,
      refs: [{ name: 'design.png', mediaType: 'image/png', data }],
      mode: 'overlay',
      complexity: 'complex',
      constraints: 'Preserve existing lettering.',
      feedback: 'Move the star clear of the title.',
      previousScene,
    },
    {
      model: mockPlanner(scene, (request, requestSignal) => {
        body = request
        signal = requestSignal
      }),
    },
  )
  const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const content = input.find((message) => message.role === 'user')!.content
  const context = JSON.parse(String(content[0]!.text))
  const image = content[1]!
  const preview = await sharp(Buffer.from(String(image.image_url).split(',')[1]!, 'base64')).metadata()
  const schema = (body.text as { format: { schema: unknown } }).format.schema
  assert({
    given: 'a complex mixed design with a correction and reference look',
    should: 'request a structured scene with exact canvas pixels and detailed reference imagery',
    actual: [
      context.width,
      context.height,
      context.mode,
      context.constraints,
      context.feedback,
      context.previousScene,
      context.imageOrder,
      (body.reasoning as { effort: string }).effort,
      (body.text as { format: { type: string } }).format.type,
      JSON.stringify(schema).includes('"oneOf"'),
      JSON.stringify(schema).includes('"anyOf"'),
      image.detail,
      preview.width,
      preview.height,
      !!signal,
      result,
    ],
    expected: [
      2048,
      1536,
      'overlay',
      'Preserve existing lettering.',
      'Move the star clear of the title.',
      previousScene,
      ['design.png'],
      'high',
      'json_schema',
      false,
      true,
      'high',
      1536,
      1152,
      true,
      scene,
    ],
  })
})

test('Drawing planning rejects changed dimensions or destructive overlay instructions', async () => {
  const scenes = [
    { ...drawingScene([drawingStar()]), width: 256 },
    { ...drawingScene([drawingStar()]), background: '#ffffff' },
    {
      ...drawingScene([drawingStar()]),
      eraseRegions: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 128, y: 0 },
            { x: 128, y: 96 },
          ],
        },
      ],
    },
  ]
  const failures: string[] = []
  for (const scene of scenes) {
    try {
      await planDrawing(
        { prompt: 'Add a star.', width: 128, height: 96, mode: 'overlay' },
        { model: mockPlanner(scene) },
      )
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'a model result that changes the canvas, replaces the background or erases the overlay base',
    should: 'reject all three rather than silently changing the scene contract',
    actual: failures.map((message) => message.startsWith('Drawing')),
    expected: [true, true, true],
  })
})

test('Drawing planning accepts the same reference count as the image tool and rejects overflow', async () => {
  const data = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#206080' } })
    .png()
    .toBuffer()
  const refs = Array.from({ length: MAX_REF_IMAGES }, () => ({
    name: 'reference.png',
    mediaType: 'image/png' as const,
    data,
  }))
  const scene = drawingScene([drawingStar()])
  const result = await planDrawing(
    { prompt: 'Create an icon.', width: 128, height: 96, refs, mode: 'create' },
    { model: mockPlanner(scene) },
  )
  let rejected = false
  try {
    await planDrawing(
      { prompt: 'Create an icon.', width: 128, height: 96, refs: [...refs, refs[0]!], mode: 'create' },
      { model: mockPlanner(scene) },
    )
  } catch (error) {
    rejected = (error as Error).message.includes('reference images')
  }
  assert({
    given: 'the maximum supported reference set and one additional reference',
    should: 'accept all supported references and reject the overflow',
    actual: [result, rejected],
    expected: [scene, true],
  })
})
