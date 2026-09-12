import sharp from 'sharp'
import { assert, test } from '#test'
import { imageVisualFacts } from './visualFacts.ts'

test('Visual facts count actual transparent, fractional and opaque pixels independently of visible RGB', async () => {
  const pixels = Buffer.from([
    0, 0, 0, 255, 0, 0, 0, 0, 120, 60, 30, 1, 120, 60, 30, 254, 255, 255, 255, 0, 255, 255, 255, 255, 255, 0, 0, 128, 0,
    255, 0, 255,
  ])
  const data = await sharp(pixels, { raw: { width: 4, height: 2, channels: 4 } })
    .png()
    .toBuffer()
  assert({
    given: 'a PNG with opaque black, invisible white, and several fractional alpha values',
    should: 'report exact dimensions and alpha categories rather than infer transparency from color',
    actual: await imageVisualFacts(data),
    expected: { width: 4, height: 2, transparentPixels: 2, fractionalAlphaPixels: 3, opaquePixels: 3 },
  })
})

test('Visual facts correctly handle RGB images and fully transparent PNGs', async () => {
  const opaque = await sharp({ create: { width: 7, height: 3, channels: 3, background: '#000000' } })
    .png()
    .toBuffer()
  const clear = await sharp({
    create: { width: 2, height: 5, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } },
  })
    .png()
    .toBuffer()
  assert({
    given: 'a black RGB image without an alpha channel and a transparent image',
    should: 'count all RGB pixels as opaque and all transparent pixels as transparent',
    actual: [await imageVisualFacts(opaque), await imageVisualFacts(clear)],
    expected: [
      { width: 7, height: 3, transparentPixels: 0, fractionalAlphaPixels: 0, opaquePixels: 21 },
      { width: 2, height: 5, transparentPixels: 10, fractionalAlphaPixels: 0, opaquePixels: 0 },
    ],
  })
})

test('Visual facts reject undecodable image bytes without inventing measurements', async () => {
  let rejected = 0
  for (const data of [new Uint8Array(), new Uint8Array([1, 2, 3, 4])]) {
    try {
      await imageVisualFacts(data)
    } catch {
      rejected++
    }
  }
  assert({
    given: 'empty or invalid image bytes',
    should: 'fail measurement so callers cannot report fabricated dimensions or transparency',
    actual: rejected,
    expected: 2,
  })
})
