/**
 * An image's pixel size, read from its header: instant, local, and free of
 * any decoder. Enough to say "Screenshot · 1170 × 2532" before a model sees
 * the file. PNG, JPEG, GIF and WebP; anything else, or a header too short to
 * read, is null rather than a guess.
 */

import { readFile } from 'node:fs/promises'

export interface ImageSize {
  width: number
  height: number
}

/** The size of the image at `filePath`, or null when its header does not say. */
export async function imageSize(filePath: string): Promise<ImageSize | null> {
  return imageSizeOf(await readFile(filePath))
}

/** The size an image header states, or null when the bytes are not an image this reads. */
export function imageSizeOf(bytes: Uint8Array): ImageSize | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return png(b) ?? gif(b) ?? jpeg(b) ?? webp(b)
}

function valid(width: number, height: number): ImageSize | null {
  return width > 0 && height > 0 ? { width, height } : null
}

// PNG: an eight-byte signature, then the IHDR chunk with width and height big-endian.
function png(b: Buffer): ImageSize | null {
  if (b.length < 24 || b.toString('latin1', 1, 4) !== 'PNG' || b[0] !== 0x89) return null
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null
  return valid(b.readUInt32BE(16), b.readUInt32BE(20))
}

// GIF: "GIF87a" or "GIF89a", then the logical screen size little-endian.
function gif(b: Buffer): ImageSize | null {
  if (b.length < 10 || !/^GIF8[79]a$/.test(b.toString('latin1', 0, 6))) return null
  return valid(b.readUInt16LE(6), b.readUInt16LE(8))
}

// JPEG: segments of marker + length, until a start-of-frame marker carries the size.
function jpeg(b: Buffer): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null
  let at = 2
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return null
    const marker = b[at + 1]
    // Padding between segments, and the markers that carry no length.
    if (marker === 0xff) {
      at += 1
      continue
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2
      continue
    }
    if (marker === 0xd9 || marker === 0xda) return null
    const length = b.readUInt16BE(at + 2)
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (startOfFrame) {
      if (at + 9 > b.length) return null
      return valid(b.readUInt16BE(at + 7), b.readUInt16BE(at + 5))
    }
    at += 2 + length
  }
  return null
}

// WebP: a RIFF container whose first chunk is VP8 (lossy), VP8L (lossless) or VP8X (extended).
function webp(b: Buffer): ImageSize | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null
  const chunk = b.toString('latin1', 12, 16)
  if (chunk === 'VP8 ') return valid(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
  if (chunk === 'VP8L') {
    const bits = b.readUInt32LE(21)
    return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') return valid(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1)
  return null
}
