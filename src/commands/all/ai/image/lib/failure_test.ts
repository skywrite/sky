import OpenAI from 'openai'
import { assert, test } from '#test'
import { imageFailureMessage, ImageStageError } from './failure.ts'
import type { ImageSelection } from './preflight.ts'
import { renderImages } from './render.ts'
import { runImageWorkflow } from './workflow.ts'

const selection: ImageSelection = {
  method: 'drawing',
  layout: 'landscape',
  intent: 'create',
  complexity: 'complex',
  model: 'gpt-image-2.5-flare',
  quality: 'high',
  reason: 'Explicit vector request.',
}

test('A drawing planner timeout identifies SVG planning and does not masquerade as an image-provider failure', async () => {
  const timeout = new DOMException('The operation timed out.', 'TimeoutError')
  let imageCalls = 0
  let failure: unknown
  try {
    await runImageWorkflow(
      { prompt: 'Draw an editable Atlas diagram.', selection, refs: [], count: 1 },
      {
        planDrawing: async () => {
          throw timeout
        },
        renderImages: async () => {
          imageCalls++
          throw new Error('Unexpected image fallback')
        },
      },
    )
  } catch (error) {
    failure = error
  }
  const message = imageFailureMessage(failure, 'drawing', 15, false)
  assert({
    given: 'an internal drawing timeout before any candidate exists',
    should: 'retain the failed stage and original cause without claiming the full request budget expired',
    actual: [
      failure instanceof ImageStageError ? failure.stage : undefined,
      failure instanceof Error ? failure.cause : undefined,
      message.includes('SVG drawing planning'),
      message.includes('No image was returned'),
      message.includes('15'),
      imageCalls,
    ],
    expected: ['drawing:plan', timeout, true, true, false, 0],
  })
})

test('OpenAI generation and editing errors retain the real provider stage and diagnostic cause', async () => {
  const observed: Array<[string | undefined, boolean, boolean]> = []
  for (const editing of [false, true]) {
    const client = new OpenAI({
      apiKey: 'mock-api-key',
      maxRetries: 0,
      fetch: async () => Response.json({ error: { message: 'Synthetic rate limit' } }, { status: 429 }),
    })
    let failure: unknown
    try {
      await renderImages(
        {
          prompt: 'Create a beautiful Atlas illustration.',
          model: 'gpt-image-2.5-flare',
          quality: 'high',
          count: 1,
          refs: editing ? [{ name: 'synthetic.png', mediaType: 'image/png', data: new Uint8Array([1]) }] : [],
        },
        client,
      )
    } catch (error) {
      failure = error
    }
    observed.push([
      failure instanceof ImageStageError ? failure.stage : undefined,
      failure instanceof Error && failure.cause instanceof OpenAI.RateLimitError,
      imageFailureMessage(failure, 'image', 15, false).includes('Synthetic rate limit'),
    ])
  }
  assert({
    given: 'provider errors from the generation and editing endpoints',
    should: 'name the endpoint that failed and retain the SDK error for diagnosis',
    actual: observed,
    expected: [
      ['image:generate', true, true],
      ['image:edit', true, true],
    ],
  })
})

test('Provider timeouts are distinguished from expiration of the total request budget', () => {
  const failure = new ImageStageError('image:generate', new OpenAI.APIConnectionTimeoutError())
  const provider = imageFailureMessage(failure, 'image', 15, false)
  const budget = imageFailureMessage(failure, 'image', 15, true)
  assert({
    given: 'a provider timeout with and without expiration of the command budget',
    should: 'report the fifteen-minute limit only when that limit actually expired',
    actual: [provider.includes('15'), budget.includes('15-minute request budget expired'), budget.includes('OpenAI')],
    expected: [false, true, true],
  })
})
