import OpenAI from 'openai'
import sharp from 'sharp'
import { assert, test } from '#test'
import { imageMarkupSvg, isImageMarkup, type ImageMarkup } from '#universal/ai/imageMarkup.ts'
import { validateImageMarkup } from './markup.ts'
import { prepareReferenceImage } from './references.ts'
import { renderImages } from './render.ts'

const marks: ImageMarkup = {
  width: 80,
  height: 120,
  format: 'png',
  instruction: 'Keep the lighting.',
  marks: [
    {
      kind: 'circle',
      points: [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.75 },
      ],
      instruction: 'Make this blue.',
    },
  ],
}

test('Markup aligns with the oriented photo, stays transparent and reaches the edit API separately', async () => {
  const jpeg = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#c7bdac' } })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer()
  const reference = await prepareReferenceImage(jpeg, 'Atlas-room.jpg')
  const overlay = await sharp(Buffer.from(imageMarkupSvg(marks)))
    .png()
    .toBuffer()
  const requests: Request[] = []
  const client = new OpenAI({
    apiKey: 'mock-api-key',
    baseURL: 'https://example.com/v1',
    maxRetries: 0,
    fetch: async (url, init) => {
      if (url === 'data:,') return new Response('')
      requests.push(new Request(url, init))
      return Response.json({ created: 0, data: [{ b64_json: Buffer.from(reference.data).toString('base64') }] })
    },
  })
  await renderImages(
    {
      prompt: 'Make mark 1 blue.',
      refs: [reference],
      markup: overlay,
      model: 'gpt-image-2.6-sunburst',
      quality: 'max',
      count: 1,
      complexity: 'low',
    },
    client,
  )
  const request = requests[0]!
  const form = await request.formData()
  const photo = form.get('image[]') as File
  const markup = form.get('markup') as File
  const metadata = await sharp(new Uint8Array(await markup.arrayBuffer())).metadata()
  assert({
    given: 'a camera photo rotated by EXIF and a numbered overlay drawn on its upright preview',
    should: 'upload the full upright photo plus a transparent PNG at the same dimensions, without a mask',
    actual: [
      new URL(request.url).pathname,
      form.get('model'),
      form.get('quality'),
      form.get('complexity'),
      form.get('mask'),
      photo.name,
      markup.name,
      markup.type,
      metadata.width,
      metadata.height,
      (await sharp(overlay).stats()).isOpaque,
      Buffer.from(await photo.arrayBuffer()).equals(Buffer.from(reference.data)),
    ],
    expected: [
      '/v1/images/edits',
      'gpt-image-2.6-sunburst',
      'max',
      'low',
      null,
      'Atlas-room.png',
      'markup.png',
      'image/png',
      80,
      120,
      false,
      true,
    ],
  })
})

test('Markup rejects malformed geometry, excessive pixels, opaque paint and mismatched dimensions', async () => {
  const source = await prepareReferenceImage(
    await sharp({ create: { width: 80, height: 120, channels: 3, background: 'white' } })
      .png()
      .toBuffer(),
    'Atlas.png',
  )
  const bad = [
    { ...marks, width: 9000, height: 9000 },
    {
      ...marks,
      marks: [
        {
          ...marks.marks[0],
          points: [
            { x: -1, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      ],
    },
    { ...marks, marks: [{ ...marks.marks[0], points: [] }] },
  ]
  const errors: string[] = []
  for (const data of [
    await sharp({ create: { width: 80, height: 120, channels: 4, background: 'red' } })
      .png()
      .toBuffer(),
    await sharp(Buffer.from(imageMarkupSvg({ ...marks, width: 120, height: 80 })))
      .png()
      .toBuffer(),
  ]) {
    try {
      await validateImageMarkup(data, source)
    } catch (error) {
      errors.push((error as Error).message)
    }
  }
  assert({
    given: 'invalid annotations',
    should: 'reject them before a provider request',
    actual: [
      bad.map(isImageMarkup),
      errors.length,
      errors[0]?.includes('transparent pixels'),
      errors[1]?.includes('dimensions after orientation'),
    ],
    expected: [[false, false, false], 2, true, true],
  })
})
