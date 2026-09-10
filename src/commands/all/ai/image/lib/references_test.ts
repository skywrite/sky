import sharp from 'sharp'
import { assert, test } from '#test'
import { prepareReferenceImage, referencePreview } from './references.ts'
import { cameraJpeg } from './referencesTestHelpers.ts'

test('Camera references become upright RGB images without HDR containers or metadata', async () => {
  const original = await cameraJpeg()
  const unchanged = Buffer.from(original)
  const input = await sharp(original).metadata()
  const reference = await prepareReferenceImage(original, '/tmp/synthetic/camera.JPEG')
  const metadata = await sharp(reference.data).metadata()
  const { data, info } = await sharp(reference.data).raw().toBuffer({ resolveWithObject: true })
  const corner = (x: number, y: number) => {
    const at = (y * info.width + x) * info.channels
    return [...data.subarray(at, at + 3)].map((channel) => Math.round(channel / 255))
  }
  assert({
    given: 'a rotated P3 camera JPEG with a second image in its MPF container',
    should: 'retain every pixel, apply rotation once, convert color, and upload a matching name and MIME type',
    actual: {
      input: [input.orientation, input.hasProfile, original.includes(Buffer.from('MPF\0'))],
      originalUnchanged: original.equals(unchanged),
      file: [reference.name, reference.mediaType, metadata.format],
      pixels: [metadata.width, metadata.height, metadata.space, metadata.depth, metadata.channels],
      metadataRemoved: !metadata.exif && !metadata.icc && !metadata.xmp && !metadata.orientation,
      corners: [corner(8, 8), corner(56, 8), corner(8, 88), corner(56, 88)],
    },
    expected: {
      input: [6, true, true],
      originalUnchanged: true,
      file: ['camera.png', 'image/png', 'png'],
      pixels: [64, 96, 'srgb', 'uchar', 3],
      metadataRemoved: true,
      corners: [
        [1, 1, 0],
        [1, 0, 0],
        [0, 1, 1],
        [0, 0, 1],
      ],
    },
  })
})

test('Reference preparation preserves transparent pixels and accepts bytes despite a misleading extension', async () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0])
  for (const format of ['png', 'webp'] as const) {
    const image = sharp(pixels, { raw: { width: 3, height: 1, channels: 4 } })
    const input = await (format === 'png' ? image.png() : image.webp({ lossless: true })).toBuffer()
    const reference = await prepareReferenceImage(input, 'reference.jpeg')
    const { data, info } = await sharp(reference.data).raw().toBuffer({ resolveWithObject: true })
    assert({
      given: `a transparent ${format} supplied with a JPEG filename`,
      should: 'decode the actual format and preserve alpha without a lossy conversion',
      actual: {
        file: [reference.name, reference.mediaType],
        channels: info.channels,
        visiblePixels: [...data.subarray(0, 8)],
        transparent: data[11],
      },
      expected: {
        file: ['reference.png', 'image/png'],
        channels: 4,
        visiblePixels: [...pixels.subarray(0, 8)],
        transparent: 0,
      },
    })
  }
})

test('CMYK and grayscale references are encoded in 8-bit sRGB', async () => {
  for (const space of ['cmyk', 'b-w'] as const) {
    const original = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#808080' } })
      .toColourspace(space)
      .jpeg()
      .toBuffer()
    const reference = await prepareReferenceImage(original, 'reference.jpg')
    const metadata = await sharp(reference.data).metadata()
    assert({
      given: `an image using ${space} color`,
      should: 'supply a full-size RGB image with no unsupported color mode',
      actual: [metadata.width, metadata.height, metadata.space, metadata.depth, metadata.channels],
      expected: [32, 16, 'srgb', 'uchar', 3],
    })
  }
})

test('Preflight uses a small upright preview while image edits retain full reference resolution', async () => {
  const reference = await prepareReferenceImage(await cameraJpeg(4800, 3200), 'reference.jpg')
  const preview = await referencePreview(reference)
  const [full, small] = await Promise.all([sharp(reference.data).metadata(), sharp(preview).metadata()])
  assert({
    given: 'a high-resolution camera reference larger than the output canvas limit',
    should: 'keep its full resolution for editing and use only a thumbnail for model selection',
    actual: {
      full: [full.width, full.height],
      preview: [small.width, small.height],
      compact: preview.length < 100_000,
    },
    expected: { full: [3200, 4800], preview: [341, 512], compact: true },
  })
})

test('Malformed and cancelled references fail before any model request', async () => {
  const cancelled = AbortSignal.abort(new Error('Cancelled test request'))
  const failures: boolean[] = []
  for (const [data, signal] of [
    [Buffer.from('not an image'), undefined],
    [(await cameraJpeg()).subarray(0, 200), undefined],
    [Buffer.from('not an image'), cancelled],
  ] as const) {
    try {
      await prepareReferenceImage(data, 'reference.jpeg', signal)
      failures.push(false)
    } catch {
      failures.push(true)
    }
  }
  assert({
    given: 'invalid bytes, a truncated camera image, and cancellation before decoding',
    should: 'reject all three locally',
    actual: failures,
    expected: [true, true, true],
  })
})
