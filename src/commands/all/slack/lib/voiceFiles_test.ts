import { assert, test } from '#test'
import { enrichSlackVoiceFiles } from './voiceFiles.ts'

test('Slack voice classification uses provider metadata and never treats truncated previews as transcripts', async () => {
  const lookups: string[] = []
  const files = await enrichSlackVoiceFiles(
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
    await enrichSlackVoiceFiles(
      [{ id: 'F0MEMO', mimetype: 'audio/mp4' }],
      'https://atlas.slack.com',
      async () => undefined,
    )
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
