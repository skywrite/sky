import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { runCommand } from '#lib/sys/mod.ts'
import { exists } from '#shared/fs/mod.ts'
import { loadImageForAI, mediaTypeFromExt } from './loadImage.ts'

// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'sky-load-image-test-'))
}

test('mediaTypeFromExt', async (t) => {
  await t.step('maps known extensions', () => {
    assert({
      given: 'jpg, jpeg, webp, gif and png paths',
      should: 'return the matching media type',
      actual: ['a.jpg', 'a.JPEG', 'a.webp', 'a.gif', 'a.png'].map(mediaTypeFromExt),
      expected: ['image/jpeg', 'image/jpeg', 'image/webp', 'image/gif', 'image/png'],
    })
  })

  await t.step('falls back to png for unknown extensions', () => {
    assert({
      given: 'an unknown extension',
      should: 'default to image/png',
      actual: mediaTypeFromExt('a.tiff'),
      expected: 'image/png',
    })
  })
})

test('loadImageForAI passes non-HEIC images through untouched', async () => {
  const dir = await makeTempDir()
  try {
    const pngPath = path.join(dir, 'plain.png')
    await writeFile(pngPath, TINY_PNG)
    const loaded = await loadImageForAI(pngPath)
    assert({
      given: 'a png file',
      should: 'return the original bytes with image/png',
      actual: { mediaType: loaded.mediaType, sameBytes: loaded.image.equals(TINY_PNG) },
      expected: { mediaType: 'image/png', sameBytes: true },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadImageForAI converts HEIC to PNG', async (t) => {
  if (process.platform !== 'darwin') return t.skip('HEIC conversion requires macOS sips')

  const dir = await makeTempDir()
  try {
    // Build a HEIC fixture with sips itself
    const pngPath = path.join(dir, 'source.png')
    const heicPath = path.join(dir, 'photo.HEIC')
    await writeFile(pngPath, TINY_PNG)
    const made = await runCommand('sips', ['-s', 'format', 'heic', pngPath, '--out', heicPath])
    if (!made.success) return t.skip(`sips could not create HEIC fixture: ${made.stderr}`)

    const loaded = await loadImageForAI(heicPath)
    assert({
      given: 'a HEIC file (uppercase extension)',
      should: 'return PNG bytes with image/png',
      actual: { mediaType: loaded.mediaType, pngMagic: loaded.image.subarray(0, 4).equals(PNG_MAGIC) },
      expected: { mediaType: 'image/png', pngMagic: true },
    })

    assert({
      given: 'a converted HEIC file',
      should: 'leave the original file in place',
      actual: await exists(heicPath),
      expected: true,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('loadImageForAI throws a clear error when conversion fails', async (t) => {
  if (process.platform !== 'darwin') return t.skip('HEIC conversion requires macOS sips')

  const dir = await makeTempDir()
  try {
    const bogusPath = path.join(dir, 'missing.heic')
    let message = ''
    try {
      await loadImageForAI(bogusPath)
    } catch (e) {
      message = (e as Error).message
    }
    assert({
      given: 'a HEIC path that does not exist',
      should: 'throw an error mentioning the failed conversion',
      actual: message.includes('HEIC → PNG conversion failed'),
      expected: true,
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
