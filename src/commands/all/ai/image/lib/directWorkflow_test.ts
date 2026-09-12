import OpenAI from 'openai'
import sharp from 'sharp'
import { assert, test } from '#test'
import { prepareImageEdit } from './edit.ts'
import { passedReview } from './imageEditTestHelpers.ts'
import type { ImageSelection } from './preflight.ts'
import { prepareReferenceImage } from './references.ts'
import { renderImages } from './render.ts'
import { runImageWorkflow } from './workflow.ts'
import type { ImageWorkflowDependencies } from './workflow.ts'

function selection(intent: ImageSelection['intent'] = 'preserve_photo'): ImageSelection {
  return {
    method: 'image',
    layout: 'portrait',
    intent,
    complexity: 'complex',
    model: 'gpt-image-2.5-sunburst',
    quality: 'max',
    reason: 'Synthetic photographic edit.',
  }
}

function noAdditionalModels(calls: string[]): Partial<ImageWorkflowDependencies> {
  const unexpected = (name: string) => async () => {
    calls.push(name)
    throw new Error(`Unexpected ${name} call.`)
  }
  return {
    assessImage: unexpected('review'),
    finishImageEdit: unexpected('masked review'),
    refineImageMask: unexpected('mask refinement'),
    planDrawing: unexpected('drawing planner'),
    planMixedImage: unexpected('mixed planner'),
  }
}

async function pixels(color: string, width = 48, height = 64): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer()
}

test('Default photographic editing sends the complete normalized reference and returns the provider image unchanged', async () => {
  const prompt = 'Repaint the blue test vase green.'
  const original = await sharp(await pixels('#2255bb', 300, 400))
    .jpeg()
    .toBuffer()
  const reference = await prepareReferenceImage(original, 'synthetic-vase.jpeg')
  const generated = await pixels('#337744', 2448, 3264)
  const modelCalls: string[] = []
  const requests: Request[] = []
  const prepared = await prepareImageEdit(
    { prompt, refs: [reference], intent: 'preserve_photo', method: 'image', complexity: 'complex' },
    async () => {
      modelCalls.push('mask planner')
      throw new Error('Default photograph editing must not plan a mask.')
    },
  )
  const client = new OpenAI({
    apiKey: 'mock-api-key',
    baseURL: 'https://example.com/v1',
    maxRetries: 0,
    fetch: async (url, init) => {
      if (url === 'data:,') return new Response('')
      requests.push(new Request(url, init))
      return Response.json({ data: [{ b64_json: generated.toString('base64') }] })
    },
  })
  const [result] = await runImageWorkflow(
    { prompt, selection: selection(), refs: [reference], count: 1, ...prepared },
    { ...noAdditionalModels(modelCalls), renderImages: (request) => renderImages(request, client) },
  )
  const form = await requests[0]!.formData()
  const uploads = form.getAll('image[]') as File[]
  const upload = Buffer.from(await uploads[0]!.arrayBuffer())
  const metadata = await sharp(upload).metadata()
  assert({
    given: 'a normalized photo, a short edit prompt, and no request for masks or iterative review',
    should: 'make one full-frame request at the high-quality output size without rewriting or compositing its result',
    actual: {
      prepared,
      requestCount: requests.length,
      endpoint: new URL(requests[0]!.url).pathname,
      prompt: form.get('prompt'),
      settings: ['model', 'quality', 'size', 'n', 'output_format'].map((key) => form.get(key)),
      mask: form.get('mask'),
      uploads: uploads.map((file) => [file.name, file.type]),
      referenceUnchanged: upload.equals(Buffer.from(reference.data)),
      sourceSize: [metadata.width, metadata.height],
      additionalModels: modelCalls,
      providerBytesUnchanged: generated.equals(Buffer.from(result!.data)),
      rawBytesUnchanged: generated.equals(Buffer.from(result!.generated)),
      promptUnchanged: result!.generationPrompt,
      focus: result!.focus,
      review: result!.review,
      attempts: [result!.attempts.limit, result!.attempts.used, result!.attempts.selected, result!.attempts.stopped],
      versions: result!.versions.length,
    },
    expected: {
      prepared: { size: '2448x3264' },
      requestCount: 1,
      endpoint: '/v1/images/edits',
      prompt,
      settings: ['gpt-image-2.5-sunburst', 'max', '2448x3264', '1', 'png'],
      mask: null,
      uploads: [['synthetic-vase.png', 'image/png']],
      referenceUnchanged: true,
      sourceSize: [300, 400],
      additionalModels: [],
      providerBytesUnchanged: true,
      rawBytesUnchanged: true,
      promptUnchanged: prompt,
      focus: undefined,
      review: undefined,
      attempts: [1, 1, 1, 'completed'],
      versions: 1,
    },
  })
})

test('Default image creation generates each requested image once without visual review', async () => {
  const modelCalls: string[] = []
  const generated = await pixels('#5544aa')
  const counts: number[] = []
  const outputs = await runImageWorkflow(
    { prompt: 'Create a purple test vase.', selection: selection('create'), refs: [], count: 3 },
    {
      ...noAdditionalModels(modelCalls),
      renderImages: async (request) => {
        counts.push(request.count)
        return [{ data: generated, generated, generationPrompt: request.prompt }]
      },
    },
  )
  assert({
    given: 'three requested images with complex classification and no explicit review budget',
    should: 'produce three independent raw images with completed, unreviewed attempt metadata',
    actual: {
      counts,
      modelCalls,
      outputs: outputs.map((image) => [
        image.data === generated,
        image.review,
        image.attempts.stopped,
        image.versions.length,
      ]),
    },
    expected: {
      counts: [1, 1, 1],
      modelCalls: [],
      outputs: [
        [true, undefined, 'completed', 1],
        [true, undefined, 'completed', 1],
        [true, undefined, 'completed', 1],
      ],
    },
  })
})

test('An explicit attempt budget retains the opt-in image review workflow even when limited to one attempt', async () => {
  const generated = await pixels('#bb7722')
  const observed: Array<[number, number, string, string | undefined]> = []
  for (const maxAttempts of [1, 3]) {
    let reviews = 0
    const [result] = await runImageWorkflow(
      { prompt: 'Create an orange test vase.', selection: selection('create'), refs: [], count: 1, maxAttempts },
      {
        ...noAdditionalModels([]),
        renderImages: async (request) => [{ data: generated, generated, generationPrompt: request.prompt }],
        assessImage: async () => {
          reviews++
          return passedReview
        },
      },
    )
    observed.push([maxAttempts, reviews, result!.attempts.stopped, result!.review?.status])
  }
  assert({
    given: 'the caller deliberately supplies an attempt budget',
    should: 'still review the first image and stop immediately when it passes',
    actual: observed,
    expected: [
      [1, 1, 'passed', 'passed'],
      [3, 1, 'passed', 'passed'],
    ],
  })
})

test('Default image batches retain completed images when a later provider request fails', async () => {
  const generated = await pixels('#aa2255')
  const modelCalls: string[] = []
  let renders = 0
  const outputs = await runImageWorkflow(
    { prompt: 'Create a red test vase.', selection: selection('create'), refs: [], count: 3 },
    {
      ...noAdditionalModels(modelCalls),
      renderImages: async (request) => {
        if (++renders === 2) throw new Error('Synthetic provider failure.')
        return [{ data: generated, generated, generationPrompt: request.prompt }]
      },
    },
  )
  assert({
    given: 'the first direct image succeeds and the second provider request fails',
    should: 'retain the successful raw image and disclose the incomplete batch without attempting a third image',
    actual: [
      renders,
      outputs.length,
      outputs[0]!.data === generated,
      outputs[0]!.attempts.stopped,
      outputs[0]!.batchWarning?.includes('Created 1 of 3 images'),
      outputs[0]!.batchWarning?.includes('Synthetic provider failure.'),
      modelCalls,
    ],
    expected: [2, 1, true, 'completed', true, true, []],
  })
})

test('Cancellation of direct image generation propagates instead of returning a completed result', async () => {
  const generated = await pixels('#227755')
  const failures: string[] = []
  const counts: number[] = []
  for (const cancelBefore of [true, false]) {
    const controller = new AbortController()
    const reason = new Error('Synthetic image cancellation.')
    let renders = 0
    if (cancelBefore) controller.abort(reason)
    try {
      await runImageWorkflow(
        {
          prompt: 'Create a green test vase.',
          selection: selection('create'),
          refs: [],
          count: 2,
          signal: controller.signal,
        },
        {
          ...noAdditionalModels([]),
          renderImages: async (request) => {
            renders++
            controller.abort(reason)
            return [{ data: generated, generated, generationPrompt: request.prompt }]
          },
        },
      )
    } catch (error) {
      failures.push((error as Error).message)
    }
    counts.push(renders)
  }
  assert({
    given: 'cancellation before upload or while a direct provider request is pending',
    should: 'propagate cancellation and stop every later request',
    actual: { counts, failures },
    expected: { counts: [0, 1], failures: ['Synthetic image cancellation.', 'Synthetic image cancellation.'] },
  })
})
