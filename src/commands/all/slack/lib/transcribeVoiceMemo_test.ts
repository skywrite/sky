import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { assert, test } from '#test'
import { slackVttText, transcribeSlackVoiceMemo } from './transcribeVoiceMemo.ts'

test('Slack VTT keeps the spoken text without timestamps or speaker inference', () => {
  assert({
    given: 'a native transcript with multiple cues and a colon inside the speech',
    should: 'retain all the words and reject non-transcript downloads',
    actual: [
      slackVttText(
        'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nNext step: review Atlas.\n\n2\n00:00:01.000 --> 00:00:02.000\nThen ship it.\n',
      ),
      slackVttText('<html>Sign in</html>'),
    ],
    expected: ['Next step: review Atlas. Then ship it.', undefined],
  })
})

test('A complete native Slack transcript needs no recognition call', async () => {
  let calls = 0
  const text = await transcribeSlackVoiceMemo(
    { voiceMemo: { workspaceUrl: 'https://atlas.slack.com', transcript: 'The complete memo.' } },
    '/not-read/memo.m4a',
    {
      recognize: async () => {
        calls++
        throw new Error('Must not transcribe')
      },
    },
  )
  assert({
    given: 'a complete native transcript',
    should: 'use it directly',
    actual: [text, calls],
    expected: ['The complete memo.', 0],
  })
})

test('Voice recognition survives failed saves and attachment moves without paying twice', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-voice-retry-'))
  try {
    const original = path.join(temp, 'memo.m4a')
    await writeFile(original, 'Synthetic audio bytes')
    const runs = new Set<string>()
    let calls = 0
    const options = {
      runs,
      runOptions: { dir: path.join(temp, 'runs'), now: () => '2026-04-10 09:00' },
      native: async () => undefined,
      recognize: async () => {
        calls++
        if (calls === 1) throw new Error('Temporary failure')
        return { text: 'Review Atlas tomorrow.' }
      },
    }
    const file = { voiceMemo: { workspaceUrl: 'https://atlas.slack.com' } }
    let failed = false
    try {
      await transcribeSlackVoiceMemo(file, original, options)
    } catch {
      failed = true
    }
    const first = await transcribeSlackVoiceMemo(file, original, options)
    const renamed = path.join(temp, 'renamed.m4a')
    await rename(original, renamed)
    const retry = await transcribeSlackVoiceMemo(file, renamed, options)
    assert({
      given: 'recognition fails once, then succeeds before a document save fails and its audio moves',
      should: 'reuse the completed transcription by audio bytes and preserve the original',
      actual: [failed, first, retry, calls, runs.size, await readFile(renamed, 'utf8')],
      expected: [true, 'Review Atlas tomorrow.', 'Review Atlas tomorrow.', 2, 1, 'Synthetic audio bytes'],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
