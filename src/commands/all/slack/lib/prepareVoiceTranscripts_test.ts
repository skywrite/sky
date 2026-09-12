import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import MessageDocument from '#shared/models/Message/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { captureText, type SlackCaptureMessage } from './captureMessages.ts'
import { buildTranscript, fallbackSummary } from './summarize.ts'
import { prepareSlackVoiceTranscripts } from './transcribeVoiceMemo.ts'
import { updateSlackCapture } from './updateCapture.ts'

test('Speech informs metadata and is reused when originals are saved; failed speech retries on the next fetch', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-voice-metadata-'))
  try {
    const day = new PlainDate('2026-04-10')
    const audio = path.join(temp, 'voice.m4a')
    const pdf = path.join(temp, 'report.pdf')
    await writeFile(audio, 'original recording')
    await writeFile(pdf, 'original PDF')
    const voice = { workspaceUrl: 'https://atlas.slack.com' }
    const messages: SlackCaptureMessage[] = [
      {
        channelId: 'C0ATLAS',
        ts: '1770000000.000001',
        timeLabel: '2026-04-10 09:00',
        userName: 'Jane Doe',
        text: 'A quick question.',
      },
      {
        channelId: 'C0ATLAS',
        ts: '1770000000.000002',
        timeLabel: '2026-04-10 09:01',
        userName: 'John Smith',
        text: '',
        files: [
          { id: 'F0VOICE', name: 'voice.m4a', path: audio, voiceMemo: voice },
          { id: 'F0PENDING', name: 'pending.m4a', path: audio, voiceMemo: voice },
          { id: 'F0PDF', name: 'report.pdf', path: pdf },
        ],
      },
    ]
    const calls: string[] = []
    const output = { log: () => {} }
    const prepared = await prepareSlackVoiceTranscripts(messages, {
      output,
      transcribe: async (file) => {
        calls.push(file.id!)
        if (file.id === 'F0PENDING') throw new Error('Recognition unavailable')
        return 'Atlas launch ownership and approvals.'
      },
    })
    assert({
      given: 'a textless reply containing speech and an ordinary attachment',
      should: 'include the spoken topic and speaker in summary and tag context without altering source text',
      actual: [
        buildTranscript(prepared[0], prepared.slice(1)),
        captureText(prepared).includes('Atlas launch ownership and approvals.'),
        fallbackSummary(prepared[1]),
        messages[1].files![0].voiceTranscript,
        prepared[1].text,
        calls,
      ],
      expected: [
        'Jane Doe: A quick question.\n\nJohn Smith: *(voice memo transcript)*\n\nAtlas launch ownership and approvals.',
        true,
        'Atlas launch ownership and approvals.',
        undefined,
        '',
        ['F0VOICE', 'F0PENDING'],
      ],
    })
    const unexpected = async () => {
      throw new Error('Prepared speech must not be recognized again')
    }
    const carried = await prepareSlackVoiceTranscripts(JSON.parse(JSON.stringify(prepared)), {
      output,
      transcribe: unexpected,
    })
    let doc = await updateSlackCapture({
      doc: new MessageDocument({ medium: 'Slack', summary: 'Atlas launch ownership', follow: 'atlas-follow' }),
      messages: carried,
      day,
      output,
      attachmentsRoot: temp,
      transcribe: unexpected,
    })
    assert({
      given: 'prepared results passed through the command JSON boundary',
      should: 'save the successful transcript once, keep originals, and leave failed speech pending',
      actual: [
        doc.markdown.split('Atlas launch ownership and approvals.').length - 1,
        parseSlackConversation(doc.markdown).messages.length,
        doc.attachments.length,
        await readFile(path.join(temp, dayAttachmentsDir(day), doc.attachments[0].file), 'utf8'),
      ],
      expected: [1, 2, 2, 'original recording'],
    })
    const retries: string[] = []
    doc = await updateSlackCapture({
      doc,
      messages,
      day,
      output,
      attachmentsRoot: temp,
      transcribe: async (file) => {
        retries.push(file.id!)
        return 'The missing spoken reply.'
      },
    })
    assert({
      given: 'the next export has no preparation status from the previous capture',
      should: 'retry only the missing transcript and retain completed speech',
      actual: [
        retries,
        doc.markdown.includes('The missing spoken reply.'),
        doc.markdown.includes('Atlas launch ownership and approvals.'),
      ],
      expected: [['F0PENDING'], true, true],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})

test('Voice preparation deduplicates shared files and stops on cancellation', async () => {
  const message: SlackCaptureMessage = {
    channelId: 'C0ATLAS',
    ts: '1770000000.000001',
    timeLabel: '2026-04-10 09:00',
    text: '',
    files: [{ id: 'F0VOICE', path: '/mock/voice.m4a', voiceMemo: { workspaceUrl: 'https://atlas.slack.com' } }],
  }
  let calls = 0
  const prepared = await prepareSlackVoiceTranscripts([message, { ...message, ts: '1770000000.000002' }], {
    output: { log() {} },
    transcribe: async () => {
      calls++
      return 'Shared spoken words.'
    },
  })
  const controller = new AbortController()
  controller.abort(new Error('Cancelled'))
  let error: unknown
  try {
    await prepareSlackVoiceTranscripts([message], { output: { log() {} }, signal: controller.signal })
  } catch (caught) {
    error = caught
  }
  assert({
    given: 'two references to one voice file, then an aborted capture',
    should: 'recognize once and propagate cancellation',
    actual: [calls, prepared.map((m) => m.files![0].voiceTranscript), error instanceof Error ? error.message : error],
    expected: [1, ['Shared spoken words.', 'Shared spoken words.'], 'Cancelled'],
  })
})
