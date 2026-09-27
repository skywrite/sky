import { assert, test } from '#test'
import { CAF_TEST_HEADER, silentCaf } from '../../test/audioFixtures.ts'
import { audioContainerFromHeader, inspectAudioBlob } from './audioHeader.ts'

test('audio headers determine routing regardless of filename or MIME type', async () => {
  const caf = silentCaf()
  const m4a = new TextEncoder().encode('\0\0\0\u0018ftypM4A \0\0\0\0M4A mp42')
  assert({
    given: 'CAF disguised as M4A, MPEG-4 disguised as CAF, and an extensionless recording',
    should: 'identify the actual containers without trusting the names or MIME types',
    actual: await Promise.all([
      inspectAudioBlob(new File([caf], 'reply.m4a', { type: 'audio/mp4' })),
      inspectAudioBlob(new File([m4a], 'memo.caf', { type: 'audio/x-caf' })),
      inspectAudioBlob(new File([caf], 'recording')),
    ]),
    expected: ['caf', 'mp4', 'caf'],
  })
  assert({
    given: 'truncated headers, ordinary text, a HEIC image, and an unsupported CAF version',
    should: 'avoid mistaking them for supported audio containers',
    actual: ['', 'caff', CAF_TEST_HEADER.slice(0, 7), 'A conversation', '\0\0\0\u0018ftypheic', 'caff\0\u0002\0\0'].map(
      (value) => audioContainerFromHeader(new TextEncoder().encode(value)),
    ),
    expected: [null, null, null, null, null, null],
  })
})
