import sharp from 'sharp'

/** A synthetic two-image JPEG container, like a camera's main image plus HDR gain map. */
export function withGainMapContainer(jpeg: Uint8Array, gainMap: Uint8Array): Buffer {
  const tiff = Buffer.alloc(82)
  tiff.write('II', 0)
  tiff.writeUInt16LE(42, 2)
  tiff.writeUInt32LE(8, 4)
  tiff.writeUInt16LE(3, 8)
  // MPF version, number of images, and the two MP entries.
  for (const [i, tag, type, count, value] of [
    [0, 0xb000, 7, 4, 0x30303130],
    [1, 0xb001, 4, 1, 2],
    [2, 0xb002, 7, 32, 50],
  ]) {
    const at = 10 + i * 12
    tiff.writeUInt16LE(tag, at)
    tiff.writeUInt16LE(type, at + 2)
    tiff.writeUInt32LE(count, at + 4)
    tiff.writeUInt32LE(value, at + 8)
  }
  const segment = Buffer.concat([Buffer.from([0xff, 0xe2, 0, 88]), Buffer.from('MPF\0'), tiff])
  const mainLength = jpeg.length + segment.length
  tiff.writeUInt32LE(0x20030000, 50)
  tiff.writeUInt32LE(mainLength, 54)
  tiff.writeUInt32LE(gainMap.length, 70)
  tiff.writeUInt32LE(mainLength - 10, 74)
  tiff.copy(segment, 8)
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2), gainMap])
}

/** All pixels and metadata are generated here; never use a real photograph as a fixture. */
export async function cameraJpeg(width = 96, height = 64): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 3
      pixels[at] = x < width / 2 ? 255 : 0
      pixels[at + 1] = y >= height / 2 ? 255 : 0
      pixels[at + 2] = x >= width / 2 ? 255 : 0
    }
  }
  const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .withMetadata({ orientation: 6 })
    .withIccProfile('p3')
    .withXmp(
      '<x:xmpmeta xmlns:x="adobe:ns:meta/"><test:gain-map xmlns:test="https://example.com/hdr">synthetic</test:gain-map></x:xmpmeta>',
    )
    .jpeg({ quality: 100, chromaSubsampling: '4:4:4' })
    .toBuffer()
  const gainMap = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#808080' } })
    .jpeg()
    .toBuffer()
  return withGainMapContainer(jpeg, gainMap)
}
