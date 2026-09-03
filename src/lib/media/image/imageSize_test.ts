import { rm, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { imageSize, imageSizeOf } from './mod.ts'

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** A PNG header stating any size: the signature and an IHDR chunk. */
function pngOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

/** A JPEG whose start-of-frame comes after an APP1 segment, as a camera writes it. */
function jpegOf(width: number, height: number): Buffer {
  const app1 = Buffer.alloc(2 + 2 + 30)
  app1.writeUInt16BE(0xffe1, 0)
  app1.writeUInt16BE(32, 2)
  const sof = Buffer.alloc(2 + 2 + 15)
  sof.writeUInt16BE(0xffc0, 0)
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xda])])
}

function gifOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(13)
  b.write('GIF89a', 0, 'latin1')
  b.writeUInt16LE(width, 6)
  b.writeUInt16LE(height, 8)
  return b
}

function webpOf(width: number, height: number): Buffer {
  const b = Buffer.alloc(30)
  b.write('RIFF', 0, 'latin1')
  b.writeUInt32LE(22, 4)
  b.write('WEBPVP8X', 8, 'latin1')
  b.writeUInt32LE(10, 16)
  b.writeUIntLE(width - 1, 24, 3)
  b.writeUIntLE(height - 1, 27, 3)
  return b
}

test('imageSizeOf', () => {
  assert({
    given: 'the headers of each kind',
    should: 'read the size each states',
    actual: [pngOf(1170, 2532), jpegOf(4032, 3024), gifOf(640, 480), webpOf(1920, 1080)].map(imageSizeOf),
    expected: [
      { width: 1170, height: 2532 },
      { width: 4032, height: 3024 },
      { width: 640, height: 480 },
      { width: 1920, height: 1080 },
    ],
  })
  assert({
    given: 'bytes that are not an image, or not enough of one',
    should: 'say nothing rather than guess',
    actual: [Buffer.from('%PDF-1.7 hello'), pngOf(1170, 2532).subarray(0, 20), Buffer.alloc(0)].map(imageSizeOf),
    expected: [null, null, null],
  })
})

test('imageSize reads a file', async () => {
  const dir = await makeTempDir()
  try {
    const file = path.join(dir, 'dot.png')
    await writeFile(file, TINY_PNG)
    assert({
      given: 'a real one-pixel PNG on disk',
      should: 'read 1 × 1',
      actual: await imageSize(file),
      expected: { width: 1, height: 1 },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
