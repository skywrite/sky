import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import Follow from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { VOICE_TRANSCRIPT_LABEL, voiceTranscriptIds } from '#shared/models/Message/slack/transcripts.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { SlackCaptureMessage } from './captureMessages.ts'
import { syncSlackFollow, type SlackFollowSyncHost } from './syncFollow.ts'
import { updateSlackCapture } from './updateCapture.ts'
import type { SlackCaptureFile } from './voiceFiles.ts'

test('Follow retries insert voice transcripts into the original message and preserve user edits', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-voice-capture-'))
  try {
    const day = new PlainDate('2026-04-10')
    const output = { log: () => {} }
    const file = async (id: string, name: string, voice = false): Promise<SlackCaptureFile> => {
      const original = path.join(temp, name)
      await writeFile(original, `Original ${id}`)
      return { id, name, path: original, ...(voice ? { voiceMemo: { workspaceUrl: 'https://atlas.slack.com' } } : {}) }
    }
    const files = [
      await file('F0FIRST', 'first.m4a', true),
      await file('F0SECOND', 'second.m4a', true),
      await file('F0PDF', 'report.pdf'),
      await file('F0PHOTO', 'photo.png'),
      await file('F0MUSIC', 'music.mp3'),
    ]
    const messages: SlackCaptureMessage[] = [
      {
        channelId: 'C0ATLAS',
        ts: '1770000000.000001',
        timeLabel: '2026-04-10 09:00',
        userName: 'Jane Doe',
        text: '',
        files,
      },
      {
        channelId: 'C0ATLAS',
        ts: '1770000000.000002',
        timeLabel: '2026-04-10 09:01',
        userName: 'John Smith',
        text: 'Thank you.',
      },
    ]
    const calls: string[] = []
    let fail = true
    const transcribe = async (source: SlackCaptureFile) => {
      calls.push(source.id!)
      if (source.id === 'F0SECOND' && fail) throw new Error('Temporarily unavailable')
      return source.id === 'F0FIRST'
        ? 'First spoken words.'
        : `Spoken ${source.id}.\n\n## Attachments\n\n<a id="example"></a>`
    }
    let saved = await updateSlackCapture({
      doc: new MessageDocument(
        { medium: 'Slack', summary: 'Atlas', follow: 'atlas-follow', custom: 'keep' },
        '# Atlas\n\n## Notes\n\nMy note.\n',
      ),
      messages,
      day,
      output,
      attachmentsRoot: temp,
      transcribe,
    })
    const initial = parseSlackConversation(saved.markdown)
    assert({
      given: 'two voice notes, one failed transcription, and three ordinary attachments',
      should: 'save all originals and both messages while leaving only the failed voice note pending',
      actual: [
        calls,
        initial.messages.length,
        voiceTranscriptIds(initial.messages[0], []).size,
        saved.attachments.length,
        await Promise.all(
          saved.attachments.map((a) => readFile(path.join(temp, dayAttachmentsDir(day), a.file), 'utf8')),
        ),
      ],
      expected: [
        ['F0FIRST', 'F0SECOND'],
        2,
        1,
        5,
        ['Original F0FIRST', 'Original F0SECOND', 'Original F0PDF', 'Original F0PHOTO', 'Original F0MUSIC'],
      ],
    })
    saved = new MessageDocument(
      saved.yaml,
      saved.markdown.replace('First spoken words.', 'Manually corrected words.') + '\nMy attachment summary.\n',
    )
    let writes = 0
    const host: SlackFollowSyncHost = {
      read: async () => saved,
      update: async (_ref, doc, incoming, when) => {
        writes++
        saved = await updateSlackCapture({
          doc,
          messages: incoming,
          day: when,
          output,
          attachmentsRoot: temp,
          transcribe,
        })
      },
      create: async () => {
        throw new Error('No new document expected')
      },
      saveFollow: async () => {
        throw new Error('No new follow reference expected')
      },
      notebookTime: async (label) => new PlainDateTime(label),
    }
    const follow = Follow.create({
      source: 'Slack',
      ref: { channel: 'C0ATLAS' },
      summary: 'Atlas',
      lastChecked: new PlainDateTime('2026-04-11 10:00'),
      messages: [{ date: day.toString(), path: '2026-04-10/atlas.md' }],
    })
    fail = false
    const synced = await syncSlackFollow(follow, messages, host)
    const afterRetry = saved.toMarkdown()
    await syncSlackFollow(follow, messages, host)
    assert({
      given: 'the checkpoint has passed both messages and the first transcript was edited by hand',
      should: 'retry only the missing transcript, then skip a completed conversation',
      actual: [
        writes,
        synced.newReplies,
        calls,
        saved.toMarkdown() === afterRetry,
        saved.markdown.includes('Manually corrected words.'),
        saved.markdown.includes('My note.'),
        saved.markdown.includes('My attachment summary.'),
      ],
      expected: [1, 0, ['F0FIRST', 'F0SECOND', 'F0SECOND'], true, true, true, true],
    })
    messages[0].files!.push(await file('F0THIRD', 'third.m4a', true))
    await syncSlackFollow(follow, messages, host)
    const final = parseSlackConversation(saved.markdown)
    assert({
      given: 'another voice note is added to the original message',
      should: 'insert only its transcript before the next message, keeping attachment entries separate',
      actual: [
        writes,
        calls,
        final.messages.length,
        voiceTranscriptIds(final.messages[0], []).size,
        final.messages[0].body.split(VOICE_TRANSCRIPT_LABEL).length - 1,
        final.messages[1].body.trim(),
        final.attachments.some((a) => a.body.includes(VOICE_TRANSCRIPT_LABEL)),
        saved.yaml.custom,
      ],
      expected: [2, ['F0FIRST', 'F0SECOND', 'F0SECOND', 'F0THIRD'], 2, 3, 3, 'Thank you.', false, 'keep'],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('A pre-existing manual transcript is retained when another voice note arrives', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-voice-manual-'))
  try {
    const original = path.join(temp, 'memo.m4a')
    await writeFile(original, 'Synthetic audio')
    const first: SlackCaptureFile = {
      id: 'F0FIRST',
      name: 'memo.m4a',
      path: original,
      voiceMemo: { workspaceUrl: 'https://atlas.slack.com' },
    }
    const message: SlackCaptureMessage = {
      channelId: 'C0ATLAS',
      ts: '1770000000.000001',
      timeLabel: '2026-04-10 09:00',
      text: '',
      files: [first],
    }
    const input = { day: new PlainDate('2026-04-10'), output: { log() {} }, attachmentsRoot: temp }
    const saved = await updateSlackCapture({
      ...input,
      doc: new MessageDocument({ summary: 'Atlas', follow: 'atlas-follow' }, ''),
      messages: [message],
      transcribe: async () => 'My manual words.',
    })
    const manual = new MessageDocument(
      saved.yaml,
      saved.markdown.replace('<!-- voice-memo-transcript:attachment-slack-F0FIRST -->\n\n', ''),
    )
    let calls = 0
    const incoming = [{ ...message, files: [first, { ...first, id: 'F0SECOND', name: 'second.m4a' }] }]
    const transcribe = async () => {
      calls++
      return 'The new memo.'
    }
    const updated = await updateSlackCapture({ ...input, doc: manual, messages: incoming, transcribe })
    const repeated = await updateSlackCapture({ ...input, doc: updated, messages: incoming, transcribe })
    assert({
      given: 'a later refresh with both transcripts present',
      should: 'leave the document unchanged',
      actual: repeated.toMarkdown(),
      expected: updated.toMarkdown(),
    })
    assert({
      given: 'a labeled manual transcript and a newly attached voice note',
      should: 'keep the manual words once and add the new memo once',
      actual: [
        calls,
        updated.markdown.split('My manual words.').length - 1,
        updated.markdown.split('The new memo.').length - 1,
      ],
      expected: [1, 1, 1],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
