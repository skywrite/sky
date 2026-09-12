import OpenAI from 'openai'
import sharp from 'sharp'
import { assert, test } from '#test'
import { focusImageEdit } from './focus.ts'
import { testMaskPlan, testRegion } from './imageEditTestHelpers.ts'
import { compositeImageEdit, maskFromPlan } from './mask.ts'
import { renderImages } from './render.ts'

test('Focused rendering uploads a crop-aligned mask, retains full context and restores source coordinates exactly', async () => {
  const pixels = Buffer.alloc(2048 * 1536 * 4)
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = (i * 17) % 256
    pixels[i + 1] = 80
    pixels[i + 2] = 120
    pixels[i + 3] = i % 28 === 0 ? 0 : 255
  }
  const canvas = {
    name: 'source-canvas.png',
    mediaType: 'image/png' as const,
    data: await sharp(pixels, { raw: { width: 2048, height: 1536, channels: 4 } })
      .png()
      .toBuffer(),
  }
  const style = {
    name: 'style-reference.png',
    mediaType: 'image/png' as const,
    data: await sharp({ create: { width: 64, height: 64, channels: 4, background: '#e08020' } })
      .png()
      .toBuffer(),
  }
  const plan = {
    ...testMaskPlan([testRegion(300, 300, 400, 400)], [testRegion(320, 320, 340, 340)]),
    generationRegions: [testRegion(200, 200, 500, 500)],
    edges: 'hard' as const,
  }
  const mask = await maskFromPlan(plan, canvas)
  const generationMask = await maskFromPlan({ ...plan, editRegions: plan.generationRegions }, canvas)
  const edit = { canvas, mask, generationMask, plan, description: plan.changes }
  const expectedFocus = (await focusImageEdit(edit))!
  let form: FormData | undefined
  let providerGenerated = Buffer.alloc(0)
  const client = new OpenAI({
    apiKey: 'mock-api-key',
    baseURL: 'https://example.com/v1',
    maxRetries: 0,
    fetch: async (url, init) => {
      if (url === 'data:,') return new Response('')
      form = await new Request(url, init).formData()
      const [width, height] = String(form.get('size')).split('x').map(Number)
      providerGenerated = await sharp({
        create: { width, height, channels: 4, background: { r: 240, g: 60, b: 20, alpha: 0.5 } },
      })
        .png()
        .toBuffer()
      return Response.json({ data: [{ b64_json: providerGenerated.toString('base64') }] })
    },
  })
  const [output] = await renderImages(
    {
      prompt: 'Change the tile centered near (717, 538) in the full source canvas.',
      brief: 'Retain the surrounding pattern and use the style reference palette.',
      refs: [canvas, style],
      edit,
      model: 'gpt-image-2.5-sunburst',
      quality: 'max',
      count: 1,
      size: '2048x1536',
      focus: true,
      finish: false,
    },
    client,
  )
  const images = form!.getAll('image[]') as File[]
  const uploadedMask = form!.get('mask') as File
  const uploadSizes = await Promise.all(
    images.map(async (file) => {
      const metadata = await sharp(await file.arrayBuffer()).metadata()
      return [metadata.width, metadata.height]
    }),
  )
  const maskInfo = await sharp(await uploadedMask.arrayBuffer()).metadata()
  const restored = await sharp(output!.data).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const original = await sharp(canvas.data).ensureAlpha().raw().toBuffer()
  const source = expectedFocus.geometry.source
  let changedOutside = 0
  for (let y = 0; y < 1536; y++)
    for (let x = 0; x < 2048; x++) {
      if (x >= source.left && x < source.left + source.width && y >= source.top && y < source.top + source.height)
        continue
      const offset = (y * 2048 + x) * 4
      if (!restored.data.subarray(offset, offset + 4).equals(original.subarray(offset, offset + 4))) changedOutside++
    }
  const protectedResult = await sharp(await compositeImageEdit(output!.generated, edit))
    .ensureAlpha()
    .raw()
    .toBuffer()
  const alpha = await sharp(mask.data).extractChannel('alpha').raw().toBuffer()
  let changedProtected = 0
  for (let i = 0; i < alpha.length; i++)
    if (alpha[i] === 255 && !protectedResult.subarray(i * 4, i * 4 + 4).equals(original.subarray(i * 4, i * 4 + 4)))
      changedProtected++
  const center = (538 * 2048 + 717) * 4
  const prompt = String(form!.get('prompt'))
  assert({
    given: 'a focused request with source coordinates, transparency, a separate style reference and protected inset',
    should:
      'send the matching crop and mask, preserve full context ordering, and restore a full frame before bounded compositing',
    actual: {
      files: images.map((file) => file.name),
      uploadSizes,
      mask: [uploadedMask.name, uploadedMask.type, maskInfo.width, maskInfo.height],
      cropMatches: Buffer.from(await images[0]!.arrayBuffer()).equals(Buffer.from(expectedFocus.canvas.data)),
      maskMatches: Buffer.from(await uploadedMask.arrayBuffer()).equals(Buffer.from(expectedFocus.mask.data)),
      contextMatches: Buffer.from(await images[2]!.arrayBuffer()).equals(Buffer.from(canvas.data)),
      size: form!.get('size'),
      background: form!.get('background'),
      instructions: [
        prompt.includes('Image 1 is a focused editing crop'),
        prompt.includes('Image 3 is the complete original canvas for context only'),
        prompt.includes(`Return the crop at exactly ${expectedFocus.size}`),
      ],
      restoredSize: [restored.info.width, restored.info.height],
      retainedProvider: Buffer.from(output!.providerGenerated!).equals(providerGenerated),
      generatedAndResultMatch: Buffer.from(output!.generated).equals(Buffer.from(output!.data)),
      center: [...restored.data.subarray(center, center + 4)],
      changedOutside,
      changedProtected,
    },
    expected: {
      files: ['focused-canvas.png', 'style-reference.png', 'source-canvas.png'],
      uploadSizes: [expectedFocus.size.split('x').map(Number), [64, 64], [2048, 1536]],
      mask: ['generation-mask.png', 'image/png', ...expectedFocus.size.split('x').map(Number)],
      cropMatches: true,
      maskMatches: true,
      contextMatches: true,
      size: expectedFocus.size,
      background: 'transparent',
      instructions: [true, true, true],
      restoredSize: [2048, 1536],
      retainedProvider: true,
      generatedAndResultMatch: true,
      center: [240, 60, 20, 128],
      changedOutside: 0,
      changedProtected: 0,
    },
  })
})
