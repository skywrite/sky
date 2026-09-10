import OpenAI from 'openai'
import sharp from 'sharp'
import { assert, test } from '#test'
import { passedReview, testMaskPlan } from './imageEditTestHelpers.ts'
import { imageCanvas, maskFromPlan } from './mask.ts'
import type { ImageReference } from './references.ts'
import { renderImages } from './render.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
)

/** Capture the SDK's encoded request, including Bun's multipart serialization. */
function imageApi(response: unknown = { created: 0, data: [{ b64_json: png.toString('base64') }] }, status = 200) {
  const requests: Request[] = []
  const client = new OpenAI({
    apiKey: 'mock-api-key',
    baseURL: 'https://example.com/v1',
    maxRetries: 0,
    fetch: async (url, init) => {
      if (url === 'data:,') return new Response('')
      requests.push(new Request(url, init))
      return Response.json(response, { status })
    },
  })
  return { client, requests }
}

test('Image edits send named multipart files with their MIME types and exact bytes', async () => {
  const jpeg: ImageReference = {
    name: 'reference-a.JPEG',
    mediaType: 'image/jpeg',
    data: new Uint8Array([255, 216, 255, 224, 0, 16]),
  }
  const refs: ImageReference[] = [
    jpeg,
    { name: 'reference-b.png', mediaType: 'image/png', data: png },
    {
      name: 'reference-c.webp',
      mediaType: 'image/webp',
      data: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]),
    },
  ]
  for (const inputs of [[jpeg], refs]) {
    const { client, requests } = imageApi()
    const images = await renderImages(
      {
        prompt: 'Change the red test tile to blue.',
        model: 'gpt-image-2.5-sunburst',
        quality: 'max',
        size: 'auto',
        background: 'auto',
        count: 1,
        refs: inputs,
      },
      client,
    )
    const request = requests[0]!
    const wire = await request.clone().text()
    const form = await request.formData()
    const files = [...(form.values() as Iterable<unknown>)].filter((value): value is File => value instanceof File)
    assert({
      given: `${inputs.length} references supplied to a high-fidelity image edit`,
      should: 'send real file parts, preserve the selected model and automatic size, and decode the returned PNG',
      actual: {
        endpoint: new URL(request.url).pathname,
        headers: wire
          .split('\r\n')
          .filter((line) => line.startsWith('Content-Disposition:') && line.includes('filename=')),
        files: await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            bytes: [...new Uint8Array(await file.arrayBuffer())],
          })),
        ),
        settings: ['model', 'quality', 'size', 'background', 'n', 'output_format'].map((field) => form.get(field)),
        output: Buffer.from(images[0]!.data).equals(png),
      },
      expected: {
        endpoint: '/v1/images/edits',
        headers: inputs.map((ref) => `Content-Disposition: form-data; name="image[]"; filename="${ref.name}"`),
        files: inputs.map((ref) => ({
          name: ref.name,
          type: ref.mediaType,
          bytes: [...ref.data],
        })),
        settings: ['gpt-image-2.5-sunburst', 'max', 'auto', 'auto', '1', 'png'],
        output: true,
      },
    })
  }
})

test('Image creation supports omitted, automatic, and explicit sizes without reference uploads', async () => {
  for (const size of [undefined, 'auto', '2048x3072']) {
    const { client, requests } = imageApi()
    await renderImages(
      {
        prompt: 'A test landscape.',
        model: 'gpt-image-2.5-flare',
        quality: 'medium',
        size,
        background: 'transparent',
        count: 2,
        refs: [],
      },
      client,
    )
    const request = requests[0]!
    assert({
      given: `image creation with size ${size ?? 'omitted'}`,
      should: 'use the generation endpoint and preserve all rendering settings',
      actual: { endpoint: new URL(request.url).pathname, body: await request.json() },
      expected: {
        endpoint: '/v1/images/generations',
        body: {
          model: 'gpt-image-2.5-flare',
          prompt: 'A test landscape.',
          n: 2,
          size: size ?? 'auto',
          quality: 'medium',
          background: 'transparent',
          output_format: 'png',
        },
      },
    })
  }
})

test('Rejected and cancelled image requests cannot become successful images', async () => {
  const rejected = imageApi({ error: { message: 'Mock upload rejected', type: 'invalid_request_error' } }, 400)
  const cancelled = imageApi()
  const abort = new AbortController()
  abort.abort(new Error('Cancelled test request'))
  const failures: string[] = []
  for (const [api, signal] of [
    [rejected, undefined],
    [cancelled, abort.signal],
  ] as const) {
    try {
      await renderImages(
        { prompt: 'A test landscape.', model: 'gpt-image-2.5-flare', quality: 'low', count: 1, refs: [], signal },
        api.client,
      )
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  assert({
    given: 'an API rejection and a request cancelled before upload',
    should: 'report both failures and never send the cancelled request',
    actual: {
      failures: failures.map(
        (message) => message.includes('Mock upload rejected') || message.includes('Cancelled test request'),
      ),
      sent: [rejected.requests.length, cancelled.requests.length],
    },
    expected: { failures: [true, true], sent: [1, 0] },
  })
})

test('Masked edits send aligned named PNG parts and return the composited image, retaining full-resolution detail input', async () => {
  const original: ImageReference = {
    name: 'synthetic-source.png',
    mediaType: 'image/png',
    data: await sharp({ create: { width: 160, height: 160, channels: 3, background: '#4080c0' } })
      .png()
      .toBuffer(),
  }
  const canvas = await imageCanvas(original, '80x80')
  const mask = await maskFromPlan(
    {
      ...testMaskPlan(),
      scope: 'localized',
      reason: 'Change the center tile.',
      protectedRegions: [],
      editRegions: [
        {
          label: 'Tile',
          points: [
            { x: 250, y: 250 },
            { x: 750, y: 250 },
            { x: 750, y: 750 },
            { x: 250, y: 750 },
          ],
        },
      ],
    },
    canvas,
  )
  const generated = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#e02040' } })
    .png()
    .toBuffer()
  const { client, requests } = imageApi({ data: [{ b64_json: generated.toString('base64') }] })
  const outputs = await renderImages(
    {
      prompt: 'Change only the center tile.',
      model: 'gpt-image-2.5-sunburst',
      quality: 'max',
      size: '80x80',
      count: 1,
      refs: [original],
      edit: { canvas, mask, description: 'Center tile.' },
    },
    client,
    async () => passedReview,
  )
  const form = await requests[0]!.formData()
  const uploadedMask = form.get('mask') as File
  const uploads = form.getAll('image[]') as File[]
  const maskInfo = await sharp(await uploadedMask.arrayBuffer()).metadata()
  const output = await sharp(outputs[0]!.data).ensureAlpha().raw().toBuffer()
  const center = (40 * 80 + 40) * 4
  assert({
    given: 'a masked edit whose provider response changed even the protected border',
    should:
      'send the named mask, editing canvas and original detail reference, and preserve the border in the returned PNG',
    actual: {
      mask: [uploadedMask.name, uploadedMask.type, maskInfo.width, maskInfo.height, maskInfo.hasAlpha],
      files: uploads.map((file) => file.name),
      maskBytes: Buffer.from(await uploadedMask.arrayBuffer()).equals(Buffer.from(mask.data)),
      size: form.get('size'),
      quality: form.get('quality'),
      alignedPrompt: String(form.get('prompt')).includes('framing and alignment'),
      border: [...output.subarray(0, 4)],
      center: [...output.subarray(center, center + 4)],
    },
    expected: {
      mask: ['generation-mask.png', 'image/png', 80, 80, true],
      files: ['edit-canvas.png', 'synthetic-source.png'],
      maskBytes: true,
      size: '80x80',
      quality: 'max',
      alignedPrompt: true,
      border: [64, 128, 192, 255],
      center: [224, 32, 64, 255],
    },
  })
})

test('Masked graphics request real output transparency without overriding opaque backgrounds', async () => {
  for (const [alpha, background, expected] of [
    [0, undefined, 'transparent'],
    [0, 'auto', 'transparent'],
    [1, undefined, null],
    [0, 'opaque', 'opaque'],
  ] as const) {
    const data = await sharp({
      create: { width: 80, height: 80, channels: 4, background: { r: 32, g: 64, b: 128, alpha } },
    })
      .png()
      .toBuffer()
    const canvas: ImageReference = { name: 'synthetic-graphic.png', mediaType: 'image/png', data }
    const mask = await maskFromPlan(testMaskPlan(), canvas)
    const { client, requests } = imageApi({ data: [{ b64_json: data.toString('base64') }] })
    const [image] = await renderImages(
      {
        prompt: 'Replace the center symbol; preserve the background.',
        refs: [canvas],
        edit: { canvas, mask, description: 'Center symbol.' },
        size: '80x80',
        model: 'gpt-image-2.5-sunburst',
        quality: 'max',
        background,
        count: 1,
      },
      client,
      async () => passedReview,
    )
    assert({
      given: `a graphic with alpha ${alpha} and background ${background ?? 'omitted'}`,
      should: 'request and retain the resolved background setting, using actual alpha rather than channel presence',
      actual: [(await requests[0]!.formData()).get('background'), image!.background ?? null],
      expected: [expected, expected],
    })
  }
})
