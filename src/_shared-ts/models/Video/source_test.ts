import { assert, test } from '#test'
import VideoDocument from './mod.ts'
import { videoSource, videoSourceReferences } from './source.ts'

const FIRST = 'https://www.loom.com/share/0123456789abcdef0123456789abcdef'
const SECOND = `https://www.loom.com/share/${'1'.repeat(32)}`

test('video sources recognize single-recording legacy headers without rewriting them', () => {
  const headers = [
    { video: { url: FIRST } },
    { video: FIRST },
    { video: { loom: { url: FIRST }, backup: { url: 'https://example.com/backup' } } },
    { video: { loom: FIRST } },
    { url: FIRST },
    { video: [{ url: FIRST }] },
    { video: { url: [FIRST, FIRST.replace('/share/', '/embed/') + '?source=sample'] } },
  ]
  assert({
    given: 'equivalent single-recording metadata in old and current shapes',
    should: 'expose the recording while preserving the stored metadata',
    actual: headers.map((yaml) => {
      const doc = new VideoDocument(yaml, '')
      return {
        sources: videoSourceReferences(doc.yaml),
        url: doc.videoUrl,
        unchanged: JSON.stringify(doc.yaml) === JSON.stringify(yaml),
      }
    }),
    expected: headers.map(() => ({ sources: { urls: [FIRST], grouped: false }, url: FIRST, unchanged: true })),
  })
})

test('aliases identify one recording and primary URL lists identify collections', () => {
  assert({
    given: 'a verified alias and two legacy collection formats',
    should: 'keep aliases on one entry and expose collections without choosing one clip',
    actual: [
      { video: { url: FIRST, aliases: [SECOND] } },
      { video: { url: [FIRST, SECOND] } },
      { video: [{ url: FIRST }, { url: SECOND }] },
    ].map((yaml) => {
      const doc = new VideoDocument(yaml, '')
      return { ...videoSourceReferences(doc.yaml), displayUrl: doc.videoUrl ?? null }
    }),
    expected: [
      { urls: [FIRST, SECOND], grouped: false, displayUrl: FIRST },
      { urls: [FIRST, SECOND], grouped: true, displayUrl: null },
      { urls: [FIRST, SECOND], grouped: true, displayUrl: null },
    ],
  })
  assert({
    given: 'a general note URL or unrelated backup URL',
    should: 'not infer a video entry from unrelated metadata',
    actual: [
      videoSourceReferences({ url: 'https://example.com/article' }),
      videoSourceReferences({ video: { backup: { url: FIRST } } }),
    ],
    expected: [
      { urls: [], grouped: false },
      { urls: [], grouped: false },
    ],
  })
  assert({
    given: 'a Loom embed URL with a UUID-style recording ID',
    should: 'normalize it to the share identity',
    actual: videoSource('https://loom.com/embed/01234567-89ab-cdef-0123-456789abcdef?source=sample').url,
    expected: FIRST,
  })
})
