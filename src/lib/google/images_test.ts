import { assert, test } from '#test'
import { driveImageUrl, sniffImageMime } from './images.ts'

test('sniffImageMime', () => {
  assert({
    given: 'magic bytes of the three accepted formats plus junk',
    should: 'detect PNG/JPEG/GIF and reject everything else',
    expected: ['image/png', 'image/jpeg', 'image/gif', null, null],
    actual: [
      sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])),
      sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])),
      sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])),
      sniffImageMime(new Uint8Array([0x25, 0x50, 0x44, 0x46])), // %PDF
      sniffImageMime(new Uint8Array([0x89])),
    ],
  })
})

test('driveImageUrl', () => {
  assert({
    given: 'a Drive file id',
    should: 'build the public download URL Docs/Slides can fetch',
    expected: 'https://drive.google.com/uc?export=download&id=img-1',
    actual: driveImageUrl('img-1'),
  })
})
