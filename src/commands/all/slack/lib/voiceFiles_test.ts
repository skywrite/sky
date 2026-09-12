import { assert, test } from '#test'
import { enrichSlackFiles } from './voiceFiles.ts'

test('Slack voice classification uses provider metadata and never treats truncated previews as transcripts', async () => {
  const lookups: string[] = []
  const files = await enrichSlackFiles(
    [
      { id: 'F0SHORT', mimetype: 'audio/mp4' },
      { id: 'F0LONG', mimetype: 'audio/mp4' },
      { id: 'F0MUSIC', mimetype: 'audio/mpeg' },
      { id: 'F0PHOTO', mimetype: 'image/png' },
      { id: 'F0PDF', mimetype: 'application/pdf' },
      { id: 'F0SHORT', mimetype: 'audio/mp4' },
    ],
    'https://atlas.slack.com',
    async (_workspace, id) => {
      lookups.push(id)
      return {
        id,
        subtype: id === 'F0MUSIC' ? undefined : 'slack_audio',
        vtt: 'https://files.slack.com/example.vtt',
        transcription: { status: 'complete', preview: { content: 'Spoken words.', has_more: id !== 'F0SHORT' } },
      }
    },
  )
  assert({
    given: 'short and long voice notes, an ordinary audio upload, a photo, a PDF, and a repeated file',
    should: 'request audio metadata once per ID and expose only a complete native transcript',
    actual: [lookups, files.map((f) => [!!f.voiceMemo, f.voiceMemo?.transcript])],
    expected: [
      ['F0SHORT', 'F0LONG', 'F0MUSIC'],
      [
        [true, 'Spoken words.'],
        [true, undefined],
        [false, undefined],
        [false, undefined],
        [false, undefined],
        [true, 'Spoken words.'],
      ],
    ],
  })
})

test('Missing Slack audio metadata remains retryable', async () => {
  let failed = false
  try {
    await enrichSlackFiles([{ id: 'F0MEMO', mimetype: 'audio/mp4' }], 'https://atlas.slack.com', async () => undefined)
  } catch {
    failed = true
  }
  assert({
    given: 'an unavailable file lookup',
    should: 'stop the export before a voice note is silently classified as an ordinary attachment',
    actual: failed,
    expected: true,
  })
})

test('Slack file enrichment restores external links and tolerates failed attachment lookups', async () => {
  const calls: string[] = []
  const files = await enrichSlackFiles(
    [
      { id: 'F0DECK', name: 'Atlas slides', mode: 'external', error: 'Downloaded HTML instead of file' },
      { id: 'F0REMOTE', name: 'Linked report', error: 'Downloaded HTML instead of file' },
      { id: 'F0PDF', name: 'report.pdf', error: 'Unauthorized' },
      { id: 'F0UNKNOWN', mode: 'external', error: 'Unavailable' },
      { id: 'F0UNKNOWN', mode: 'external', error: 'Unavailable' },
      { id: 'F0UNSAFE', mode: 'external' },
      { id: 'F0MEMO', mimetype: 'audio/mp4', error: 'Unavailable' },
      { id: 'F0DECK', name: 'Atlas slides', path: '/tmp/mock-slack/F0DECK.html' },
    ],
    'https://atlas.slack.com',
    async (_workspace, id) => {
      calls.push(id)
      if (id === 'F0UNKNOWN' || id === 'F0MEMO') throw new Error('Metadata unavailable')
      if (id === 'F0PDF') return { id, permalink: 'https://atlas.slack.com/files/F0PDF' }
      if (id === 'F0UNSAFE') return { id, external_url: 'javascript:alert(1)' }
      return {
        id,
        is_external: true,
        external_url: `https://example.com/docs/${id}`,
        permalink: `https://atlas.slack.com/files/${id}`,
      }
    },
  )
  assert({
    given: 'remote documents, an unavailable PDF and a failed metadata lookup',
    should: 'identify named external links without inventing links or aborting on failed downloads',
    actual: [files.map((file) => [file.externalUrl, file.sourceUrl, !!file.voiceMemo]), calls],
    expected: [
      [
        ['https://example.com/docs/F0DECK', 'https://atlas.slack.com/files/F0DECK', false],
        ['https://example.com/docs/F0REMOTE', 'https://atlas.slack.com/files/F0REMOTE', false],
        [undefined, 'https://atlas.slack.com/files/F0PDF', false],
        [undefined, undefined, false],
        [undefined, undefined, false],
        [undefined, undefined, false],
        [undefined, undefined, false],
        ['https://example.com/docs/F0DECK', 'https://atlas.slack.com/files/F0DECK', false],
      ],
      ['F0DECK', 'F0REMOTE', 'F0PDF', 'F0UNKNOWN', 'F0UNSAFE', 'F0MEMO'],
    ],
  })
})
