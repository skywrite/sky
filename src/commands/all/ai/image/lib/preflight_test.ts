import { createOpenAI } from '@ai-sdk/openai'
import { aiModelByProfile } from '#shared/ai/models.ts'
import { assert, test } from '#test'
import { preflightImage, selectImageSettings } from './preflight.ts'
import type { ImageDecision, ImageSelectionRequest } from './preflight.ts'

// Synthetic one-pixel PNG; no user photographs enter fixtures.
const png = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
)
const request: ImageSelectionRequest = { prompt: 'A watercolor lighthouse at dawn.', refs: [], count: 1 }
const ordinary: ImageDecision = {
  intent: 'create',
  complexity: 'simple',
  model: 'flare',
  quality: 'high',
  reason: 'An everyday illustration.',
}

test('Fidelity-preserving photo edits enforce Sunburst/max after classification', async () => {
  const selected = await selectImageSettings(
    { ...request, prompt: 'Remove the background; keep the original product exactly.', refs: [png] },
    async () => ({ ...ordinary, intent: 'preserve_photo' }),
  )
  assert({
    given: 'a preservation classification paired with an insufficient model recommendation',
    should: 'enforce Sunburst/max and explain the preservation requirement',
    actual: [selected.model, selected.quality, selected.reason.includes('fidelity')],
    expected: ['gpt-image-2.5-sunburst', 'max', true],
  })
})

test('Graphic preservation retains its own quality selection and geometric complexity', async () => {
  const selected = await selectImageSettings(
    { ...request, prompt: 'Replace the badge icon; preserve the lettering and transparent background.', refs: [png] },
    async () => ({ ...ordinary, intent: 'preserve_image', complexity: 'complex', model: 'sunburst', quality: 'xhigh' }),
  )
  assert({
    given: 'a precise graphic edit that needs preservation and careful geometry',
    should: 'enable preservation without forcing the photo quality rule',
    actual: [selected.intent, selected.complexity, selected.model, selected.quality],
    expected: ['preserve_image', 'complex', 'gpt-image-2.5-sunburst', 'xhigh'],
  })
})

test('Photo-to-illustration transformations use the general selection', async () => {
  const selected = await selectImageSettings(
    { ...request, prompt: 'Turn this photo into a Ghibli-style illustration.', refs: [png] },
    async () => ({ ...ordinary, intent: 'transform', reason: 'A creative reinterpretation in a new medium.' }),
  )
  assert({
    given: 'a photo reference intended for creative transformation',
    should: 'keep Flare/high instead of forcing photographic fidelity',
    actual: [selected.model, selected.quality],
    expected: ['gpt-image-2.5-flare', 'high'],
  })
})

test('General selection supports drafts and demanding creations', async () => {
  for (const decision of [
    { ...ordinary, quality: 'medium' as const },
    { ...ordinary, model: 'sunburst' as const, quality: 'xhigh' as const },
    { ...ordinary, model: 'sunburst' as const, quality: 'max' as const },
  ]) {
    const selected = await selectImageSettings(request, async () => decision)
    assert({
      given: `a creative brief judged to need ${decision.model}/${decision.quality}`,
      should: 'use that concrete choice and its reason',
      actual: [selected.model, selected.quality, selected.reason],
      expected: [`gpt-image-2.5-${decision.model}`, decision.quality, decision.reason],
    })
  }
})

test('A preservation classification without an original cannot trigger the photo rule', async () => {
  const selected = await selectImageSettings(request, async () => ({ ...ordinary, intent: 'preserve_photo' }))
  assert({
    given: 'a prompt without a reference photograph',
    should: 'avoid promoting it solely on the preservation classification',
    actual: [selected.model, selected.quality],
    expected: ['gpt-image-2.5-flare', 'high'],
  })
})

test('Explicit settings override automatic preservation settings independently', async () => {
  const preflight = async () => ({ ...ordinary, intent: 'preserve_photo' as const })
  const model = await selectImageSettings({ ...request, refs: [png], model: 'flare' }, preflight)
  const quality = await selectImageSettings({ ...request, refs: [png], quality: 'medium' }, preflight)
  assert({
    given: 'a deliberate model or quality choice on a preservation edit',
    should: 'honor that choice while selecting the remaining setting',
    actual: [model.model, model.quality, quality.model, quality.quality],
    expected: ['gpt-image-2.5-flare', 'max', 'gpt-image-2.5-sunburst', 'medium'],
  })
  assert({
    given: 'an override of the default preservation recommendation',
    should: 'explain the deliberate override',
    actual: [
      model.reason.includes('Explicit model flare honored'),
      quality.reason.includes('Explicit quality medium honored'),
    ],
    expected: [true, true],
  })
})

test('Two explicit settings skip the paid preflight', async () => {
  const selected = await selectImageSettings({ ...request, model: 'flare', quality: 'low' }, async () => {
    throw new Error('Preflight must not run')
  })
  assert({
    given: 'both settings chosen explicitly',
    should: 'return them without calling the selector',
    actual: [selected.model, selected.quality, selected.reason.includes('skipped')],
    expected: ['gpt-image-2.5-flare', 'low', true],
  })
})

test('Explicit model and quality still classify reference edits for resolution and masking', async () => {
  let called = false
  const selected = await selectImageSettings(
    { ...request, refs: [png], model: 'flare', quality: 'medium' },
    async () => {
      called = true
      return { ...ordinary, intent: 'preserve_photo' }
    },
  )
  assert({
    given: 'both model settings explicitly selected for an edit with a reference',
    should: 'honor the settings while still identifying the photo preservation workflow',
    actual: [called, selected.intent, selected.model, selected.quality],
    expected: [true, 'preserve_photo', 'gpt-image-2.5-flare', 'medium'],
  })
})

test('Selection failure and cancellation stop before rendering can begin', async () => {
  const controller = new AbortController()
  const failed = new Error('Preflight unavailable')
  const cancelled = new Error('Cancelled')
  const errors: unknown[] = []
  try {
    await selectImageSettings(request, async () => {
      throw failed
    })
  } catch (error) {
    errors.push(error)
  }
  try {
    await selectImageSettings({ ...request, signal: controller.signal }, async () => {
      controller.abort(cancelled)
      return ordinary
    })
  } catch (error) {
    errors.push(error)
  }
  try {
    await selectImageSettings({ ...request, signal: controller.signal, model: 'flare', quality: 'low' })
  } catch (error) {
    errors.push(error)
  }
  assert({
    given: 'an unavailable selector, a cancelled preflight, or a cancelled explicit request',
    should: 'propagate the failure instead of inventing fallback settings',
    actual: errors,
    expected: [failed, cancelled, cancelled],
  })
})

function response(decision: unknown): Response {
  return Response.json({
    id: 'response-test',
    model: 'gpt-6-astra',
    output: [
      {
        type: 'message',
        role: 'assistant',
        id: 'message-test',
        content: [{ type: 'output_text', text: JSON.stringify(decision), annotations: [] }],
      },
    ],
  })
}

test('Astra preflight sends constraints and reference images through the Responses API', async () => {
  let body: Record<string, unknown> = {}
  let endpoint = ''
  let signal: AbortSignal | null | undefined
  const provider = createOpenAI({
    apiKey: 'synthetic-test-key',
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      endpoint = String(url)
      body = JSON.parse(String(init?.body))
      signal = init?.signal
      return response(ordinary)
    }) as typeof fetch,
  })
  const selected = await preflightImage(
    {
      ...request,
      refs: [png, png],
      brief: 'A quick concept; the previous composition was too crowded.',
      quality: 'medium',
      size: '1536x1024',
      background: 'opaque',
    },
    {
      model: { ...aiModelByProfile('default-gpt-6-astra-low'), model: provider('gpt-6-astra') },
      instructions: 'Select the image model and quality.',
    },
  )
  const input = body.input as Array<{ role: string; content: Array<Record<string, unknown>> }>
  const content = input.find((item) => item.role === 'user')!.content
  const brief = JSON.parse(content[0]!.text as string)
  assert({
    given: 'a request with references and prior-edit context',
    should: 'use Astra low, structured output, concrete constraints, and every reference at low detail',
    actual: [
      endpoint.endsWith('/responses'),
      body.model,
      (body.reasoning as { effort: string }).effort,
      (body.text as { format: { type: string } }).format.type,
      brief.brief,
      brief.explicitQuality,
      brief.size,
      brief.background,
      content
        .slice(1)
        .map((part) => [part.type, part.detail, String(part.image_url).startsWith('data:image/png;base64,')]),
      !!signal,
      selected,
    ],
    expected: [
      true,
      'gpt-6-astra',
      'low',
      'json_schema',
      'A quick concept; the previous composition was too crowded.',
      'medium',
      '1536x1024',
      'opaque',
      [
        ['input_image', 'low', true],
        ['input_image', 'low', true],
      ],
      true,
      ordinary,
    ],
  })
})

test('An invalid structured preflight decision fails instead of selecting an unsupported model', async () => {
  const provider = createOpenAI({
    apiKey: 'synthetic-test-key',
    fetch: (async (_url: RequestInfo | URL, _init?: RequestInit) =>
      response({ ...ordinary, model: 'unknown' })) as typeof fetch,
  })
  let failed = false
  try {
    await preflightImage(request, { model: { model: provider('gpt-6-astra') }, instructions: 'Choose.' })
  } catch {
    failed = true
  }
  assert({ given: 'an invalid model in the response', should: 'reject it', actual: failed, expected: true })
})
