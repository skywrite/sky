import { createOpenAI } from '@ai-sdk/openai'
import sharp from 'sharp'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { planMixedImage } from './mixed.ts'
import type { MixedImagePlan } from './mixed.ts'
import { MAX_REF_IMAGES } from './options.ts'

const initialPlan: MixedImagePlan = {
  artworkPrompt:
    'Paint an ocean scene below y=250 on a 1280 by 1024 canvas. Reserve the top region for an overlay. Render no new text, logos or labels; a separate drawing renderer adds them.',
  drawingPrompt:
    'Add the exact title "ATLAS: OPEN DAY" centered at x=640, baseline y=150 in bold sans-serif. Add "Saturday • 10:00" beneath it. Keep the ocean artwork visible.',
  artworkScope: 'objects',
  regenerateArtwork: true,
  reason: 'Generate the painted ocean and add precise text in its reserved title region.',
}

function mockPlan(
  plan: MixedImagePlan,
  onRequest?: (body: Record<string, unknown>, signal: AbortSignal | null | undefined) => void,
) {
  const provider = createOpenAI({
    apiKey: 'mock-api-key',
    fetch: (async (_url: RequestInfo | URL, init?: RequestInit) => {
      onRequest?.(JSON.parse(String(init?.body)), init?.signal)
      return Response.json({
        id: 'mixed-plan-test',
        model: 'gpt-6-astra',
        output: [
          {
            type: 'message',
            role: 'assistant',
            id: 'mixed-plan-message',
            content: [{ type: 'output_text', text: JSON.stringify(plan), annotations: [] }],
          },
        ],
      })
    }) as typeof fetch,
  })
  return { ...aiModelByProfile('default-gpt-6-astra-high'), model: provider('gpt-6-astra') }
}

test('Mixed planning separates artwork and exact text with the complete request and detailed reference context', async () => {
  let body: Record<string, unknown> = {}
  let signal: AbortSignal | null | undefined
  const data = await sharp({ create: { width: 2048, height: 1536, channels: 3, background: '#206080' } })
    .png()
    .toBuffer()
  const prompt = 'Create an ocean event poster titled "ATLAS: OPEN DAY" with "Saturday • 10:00" below.'
  const result = await planMixedImage(
    {
      prompt,
      brief: 'Use the reference palette and keep lettering out of the painted artwork.',
      width: 1280,
      height: 1024,
      refs: [{ name: 'palette.png', mediaType: 'image/png', data }],
    },
    {
      model: mockPlan(initialPlan, (request, requestSignal) => {
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
  assert({
    given: 'a mixed poster request with exact wording and a visual reference',
    should: 'supply complete instructions and canvas dimensions to a structured high-detail planning request',
    actual: [
      context.prompt,
      context.brief,
      context.width,
      context.height,
      context.artworkAvailable,
      context.imageOrder,
      (body.reasoning as { effort: string }).effort,
      (body.text as { format: { type: string } }).format.type,
      image.detail,
      preview.width,
      preview.height,
      !!signal,
      result,
    ],
    expected: [
      prompt,
      'Use the reference palette and keep lettering out of the painted artwork.',
      1280,
      1024,
      false,
      [{ name: 'palette.png', role: 'original or style reference' }],
      'high',
      'json_schema',
      'high',
      1536,
      1152,
      true,
      initialPlan,
    ],
  })
})

test('A first mixed plan cannot skip artwork that does not exist', async () => {
  const result = await planMixedImage(
    { prompt: 'Create an illustrated event card.', width: 1280, height: 1024, refs: [] },
    {
      model: mockPlan({ ...initialPlan, regenerateArtwork: false }),
    },
  )
  assert({
    given: 'the planner incorrectly proposes reuse without a previous plan or generated base',
    should: 'require initial artwork generation while retaining its otherwise useful division of prompts',
    actual: [result.regenerateArtwork, result.artworkPrompt, result.drawingPrompt],
    expected: [true, initialPlan.artworkPrompt, initialPlan.drawingPrompt],
  })
})

test('An overlay-only correction retains the exact prompt for existing artwork and forwards original wording', async () => {
  let context: Record<string, unknown> = {}
  const data = await sharp({ create: { width: 1280, height: 1024, channels: 3, background: '#206080' } })
    .png()
    .toBuffer()
  const revised: MixedImagePlan = {
    ...initialPlan,
    artworkPrompt: 'A changed prompt that must not be recorded for an unchanged raster.',
    drawingPrompt: `${initialPlan.drawingPrompt} Reduce the title width and correct its punctuation.`,
    artworkScope: 'objects',
    regenerateArtwork: false,
    reason: 'Only the title needs correction; reuse the approved ocean.',
  }
  const prompt = 'Keep the title exactly "ATLAS: OPEN DAY" and the subtitle "Saturday • 10:00".'
  const result = await planMixedImage(
    {
      prompt,
      width: 1280,
      height: 1024,
      refs: [{ name: 'current-artwork.png', mediaType: 'image/png', data }],
      feedback: 'The title overlaps the margin and its colon is missing.',
      previousPlan: initialPlan,
    },
    {
      model: mockPlan(revised, (body) => {
        const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
        context = JSON.parse(String(input.find((message) => message.role === 'user')!.content[0]!.text))
      }),
    },
  )
  assert({
    given: 'typography feedback on a completed artwork base',
    should: 'send original exact wording, label the reusable base and avoid changing the recorded artwork prompt',
    actual: [
      context.prompt,
      context.feedback,
      context.previousPlan,
      context.artworkAvailable,
      context.imageOrder,
      result.regenerateArtwork,
      result.artworkPrompt,
      result.drawingPrompt,
    ],
    expected: [
      prompt,
      'The title overlaps the margin and its colon is missing.',
      initialPlan,
      true,
      [{ name: 'current-artwork.png', role: 'current artwork available for reuse' }],
      false,
      initialPlan.artworkPrompt,
      revised.drawingPrompt,
    ],
  })
})

test('An artwork defect may regenerate the base while retaining the exact overlay requirements', async () => {
  const revised: MixedImagePlan = {
    ...initialPlan,
    artworkPrompt: `${initialPlan.artworkPrompt} Add the requested lighthouse on the right and keep its top below y=300.`,
    artworkScope: 'objects',
    regenerateArtwork: true,
    reason: 'The requested lighthouse is missing from the artwork.',
  }
  const result = await planMixedImage(
    {
      prompt: 'Include a lighthouse in the ocean scene.',
      width: 1280,
      height: 1024,
      refs: [],
      feedback: 'The lighthouse is absent.',
      previousPlan: initialPlan,
    },
    { model: mockPlan(revised) },
  )
  assert({
    given: 'a correction requiring a missing painted subject',
    should: 'retain the complete corrected artwork prompt and original exact text instructions',
    actual: result,
    expected: revised,
  })
})

test('Mixed planning bounds and cancellation reject requests before provider calls', async () => {
  let calls = 0
  let failures = 0
  const model = mockPlan(initialPlan, () => {
    calls++
  })
  const baseRequest = { prompt: 'Create a card.', width: 1280, height: 1024, refs: [] }
  const reference = { name: 'mock.png', mediaType: 'image/png' as const, data: new Uint8Array() }
  const requests = [
    { ...baseRequest, width: 0 },
    { ...baseRequest, width: 8192, height: 8192 },
    { ...baseRequest, refs: Array.from({ length: MAX_REF_IMAGES + 2 }, () => reference) },
    { ...baseRequest, prompt: 'x'.repeat(32001) },
    { ...baseRequest, signal: AbortSignal.abort(new Error('Cancelled mixed plan.')) },
  ]
  for (const request of requests) {
    try {
      await planMixedImage(request, { model })
    } catch {
      failures++
    }
  }
  assert({
    given: 'oversized contexts, invalid canvases, too many references or an aborted request',
    should: 'reject each without making an API call',
    actual: [failures, calls],
    expected: [requests.length, 0],
  })
})

test('Mixed corrections accept every original reference plus the current artwork', async () => {
  const data = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#206080' } })
    .png()
    .toBuffer()
  const refs = Array.from({ length: MAX_REF_IMAGES + 1 }, () => ({
    name: 'reference.png',
    mediaType: 'image/png' as const,
    data,
  }))
  const result = await planMixedImage(
    { prompt: 'Correct the title alignment.', width: 1280, height: 1024, refs, previousPlan: initialPlan },
    {
      model: mockPlan({ ...initialPlan, regenerateArtwork: false }),
    },
  )
  assert({
    given: 'sixteen original references and the current artwork base',
    should: 'plan an overlay correction without dropping references or forcing regeneration',
    actual: result.regenerateArtwork,
    expected: false,
  })
})

test('A coherent surface scope survives planning and overlay-only reuse without becoming a subject silhouette', async () => {
  const surfacePlan: MixedImagePlan = {
    ...initialPlan,
    artworkScope: 'surface',
    artworkPrompt:
      'Repaint the whole illustrated panel, including its sky and negative space. The overlay renderer supplies text.',
  }
  const initial = await planMixedImage(
    { prompt: 'Replace the complete illustrated panel and add a title.', width: 1280, height: 1024, refs: [] },
    { model: mockPlan(surfacePlan) },
  )
  const corrected = await planMixedImage(
    {
      prompt: 'Replace the complete illustrated panel and add a title.',
      width: 1280,
      height: 1024,
      refs: [],
      previousPlan: initial,
      feedback: 'The title is misaligned; keep the artwork.',
    },
    { model: mockPlan({ ...surfacePlan, artworkScope: 'objects', regenerateArtwork: false }) },
  )
  assert({
    given: 'a full panel was repainted as one coherent surface and later needs only typography correction',
    should: 'keep its surface boundary contract together with the reused artwork prompt',
    actual: [
      initial.artworkScope,
      initial.regenerateArtwork,
      corrected.artworkScope,
      corrected.regenerateArtwork,
      corrected.artworkPrompt,
    ],
    expected: ['surface', true, 'surface', false, surfacePlan.artworkPrompt],
  })
})
