import Follow from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { pendingSlackAttachment, updateSlackConversation } from '#shared/models/Message/slack/write.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { writeMessage, type SlackCaptureMessage } from './captureMessages.ts'
import { syncSlackFollow, type SlackFollowSyncHost } from './syncFollow.ts'
import { updateSlackCapture } from './updateCapture.ts'

const source = (ts: string, timeLabel: string, text: string): SlackCaptureMessage => ({
  channelId: 'C0ATLAS',
  ts,
  timeLabel,
  userName: 'Jane Doe',
  text,
})
const root = source('1770000000.000001', '2026-04-10 09:00', 'First.')

function fixture(legacy = false) {
  const markdown = legacy
    ? '# Atlas\n\n## 2026-04-10 09:00 - **Jane Doe**\n\nFirst.\n\n## Notes\n\nKeep this note.\n'
    : updateSlackConversation('# Atlas\n\n', [writeMessage(root)])
  const docs = new Map<string, MessageDocument>([
    [
      '2026-04-10/atlas.md',
      new MessageDocument(
        { medium: 'Slack', when: root.timeLabel, summary: 'Atlas', tags: 'Atlas/Review', rel: ['projects/Atlas'] },
        markdown,
      ),
    ],
  ])
  let persisted = Follow.create({
    source: 'Slack',
    ref: { channel: root.channelId },
    summary: 'Atlas',
    lastChecked: new PlainDateTime(root.timeLabel),
    lastActivity: new PlainDateTime(root.timeLabel),
    messages: [{ date: '2026-04-10', path: '2026-04-10/atlas.md' }],
  })
  const writes: string[] = []
  let failDay: string | undefined
  const host: SlackFollowSyncHost = {
    read: async (ref) => {
      const doc = docs.get(ref)
      if (!doc) throw new Error('Saved capture missing')
      return doc
    },
    notebookTime: async (label) => new PlainDateTime(label),
    update: async (ref, doc, messages) => {
      writes.push(ref)
      docs.set(ref, new MessageDocument(doc.yaml, updateSlackConversation(doc.markdown, messages.map(writeMessage))))
    },
    create: async ({ messages, when, previous, inherit }) => {
      const day = when.plainDate.toString()
      if (day === failDay) throw new Error('Simulated save failure')
      const ref = `${day}/atlas.md`
      writes.push(ref)
      docs.set(
        ref,
        new MessageDocument(
          { ...inherit?.yaml, when: when.toString(), previous },
          updateSlackConversation('# Atlas\n\n', messages.map(writeMessage)),
        ),
      )
      return ref
    },
    saveFollow: async (follow) => {
      persisted = follow
    },
  }
  return {
    docs,
    writes,
    host,
    follow: () => persisted,
    fail: (day?: string) => {
      failDay = day
    },
  }
}

test('Slack follow saves same-minute replies once while upgrading an active legacy capture', async () => {
  const f = fixture(true)
  const reply = source('1770000000.000002', root.timeLabel, 'Second.')
  const result = await syncSlackFollow(f.follow(), [root, reply, reply], f.host)
  const saved = f.docs.get('2026-04-10/atlas.md')!
  const repeated = await syncSlackFollow(result.follow, [root, reply], f.host)
  assert({
    given: 'a reply in the checkpoint minute and a repeated export',
    should: 'capture it once, preserve notes and leave the checkpoint to the caller',
    actual: [
      result.newReplies,
      repeated.newReplies,
      f.writes.length,
      parseSlackConversation(saved.markdown).format,
      saved.markdown.includes('Keep this note.'),
      result.follow.lastChecked?.toString(),
    ],
    expected: [1, 0, 1, 'sectioned', true, root.timeLabel],
  })
})

test('Slack follow partitions a backlog by actual notebook day and retries partial saves safely', async () => {
  const f = fixture()
  const fetched = [
    root,
    source('1770100000.000001', '2026-04-11 23:00', 'Day two.'),
    source('1770200000.000001', '2026-04-12 01:00', 'Day three.'),
    source('1770200000.000002', '2026-04-12 09:00', 'Later.'),
  ]
  f.fail('2026-04-12')
  let error = ''
  try {
    await syncSlackFollow(f.follow(), fetched, f.host)
  } catch (caught) {
    error = String(caught)
  }
  assert({
    given: 'the second new day fails after the first day saved',
    should: 'persist the completed day reference but not advance the polling checkpoint',
    actual: [
      error.includes('save failure'),
      f.follow().messages.map((ref) => ref.date),
      f.follow().lastChecked?.toString(),
    ],
    expected: [true, ['2026-04-10', '2026-04-11'], root.timeLabel],
  })
  f.fail()
  const result = await syncSlackFollow(f.follow(), fetched, f.host)
  assert({
    given: 'a retry of that complete export',
    should: 'reuse the saved day and file each remaining reply on its own day with inherited metadata',
    actual: [
      f.writes,
      [...f.docs.values()].map((doc) => parseSlackConversation(doc.markdown).messages.length),
      result.lastActivity?.toString(),
      f.docs.get('2026-04-12/atlas.md')?.yaml['previous'],
      f.docs.get('2026-04-12/atlas.md')?.yaml['rel'],
    ],
    expected: [
      ['2026-04-11/atlas.md', '2026-04-12/atlas.md'],
      [1, 1, 2],
      '2026-04-12 09:00',
      '2026-04-11/atlas.md',
      ['projects/Atlas'],
    ],
  })
  const repeated = await syncSlackFollow(result.follow, fetched, f.host)
  assert({
    given: 'a crash after the final document reference was saved but before the checkpoint',
    should: 'derive real last activity from saved messages on retry',
    actual: [repeated.newReplies, repeated.lastActivity?.toString()],
    expected: [0, '2026-04-12 09:00'],
  })
})

test('Slack follow uses channel plus timestamp as identity across merged threads', async () => {
  const f = fixture()
  const reply = source('1770000000.000002', root.timeLabel, 'Reply.')
  const other = { ...reply, channelId: 'C0OTHER' }
  const result = await syncSlackFollow(f.follow(), [root, reply, other], f.host)
  assert({
    given: 'two merged channels have the same message timestamp and content',
    should: 'keep both replies',
    actual: [result.newReplies, parseSlackConversation(f.docs.get('2026-04-10/atlas.md')!.markdown).messages.length],
    expected: [2, 3],
  })
})

test('Slack follow applies the notebook timezone before the checkpoint and day comparisons', async () => {
  const f = fixture()
  f.host.notebookTime = async (label) => new PlainDateTime(label).addHours(-7).normalize()
  const reply = source('1770100000.000001', '2026-04-11 03:00', 'Evening reply.')
  const result = await syncSlackFollow(f.follow(), [root, reply], f.host)
  assert({
    given: 'a system-clock reply falls on the previous notebook day',
    should: 'update that day and keep activity in notebook time',
    actual: [f.writes, result.lastActivity?.toString()],
    expected: [['2026-04-10/atlas.md'], '2026-04-10 20:00'],
  })
})

test('Slack follow retains intentionally assigned capture days for known messages', async () => {
  const f = fixture()
  const existing = f.docs.get('2026-04-10/atlas.md')!
  const older = { ...root, timeLabel: '2026-04-09 09:00' }
  f.docs.set(
    '2026-04-10/atlas.md',
    new MessageDocument(existing.yaml, updateSlackConversation('# Atlas\n', [writeMessage(older)])),
  )
  const reply = source('1770100000.000001', '2026-04-10 09:01', 'Reply today.')
  await syncSlackFollow(f.follow(), [older, reply], f.host)
  assert({
    given: 'an older root deliberately filed on a later day',
    should: 'reuse its saved identity and original document day',
    actual: [
      f.docs.size,
      parseSlackConversation(f.docs.get('2026-04-10/atlas.md')!.markdown).messages.map((message) => message.timestamp),
    ],
    expected: [1, ['2026-04-09 09:00', '2026-04-10 09:01']],
  })
})

test('Slack follow retries pending files before the checkpoint and stops writing after recovery', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'slack-follow-file-retry-'))
  try {
    const f = fixture()
    const ref = '2026-04-10/atlas.md'
    const day = new PlainDateTime(root.timeLabel).plainDate
    const original = path.join(temp, 'report.pdf')
    const messages: SlackCaptureMessage[] = [
      {
        ...root,
        files: [
          {
            id: 'F0DECK',
            name: 'Atlas slides',
            externalUrl: 'https://example.com/slides/atlas',
            error: 'Downloaded HTML instead of file',
          },
          { id: 'F0REPORT', name: 'report.pdf', error: 'Unavailable' },
        ],
      },
    ]
    const capture = (doc: MessageDocument, incoming: SlackCaptureMessage[]) =>
      updateSlackCapture({
        doc,
        messages: incoming,
        day,
        attachmentsRoot: temp,
        output: { log() {} },
        captureSlug: 'atlas-follow',
      })
    f.docs.set(ref, await capture(f.docs.get(ref)!, messages))
    f.host.update = async (file, doc, incoming) => {
      f.writes.push(file)
      f.docs.set(file, await capture(doc, incoming))
    }
    const follow = Follow.create({
      source: 'Slack',
      ref: { channel: root.channelId },
      summary: 'Atlas',
      lastChecked: new PlainDateTime('2026-04-11 10:00'),
      messages: [{ date: day.toString(), path: ref }],
    })
    const failed = await syncSlackFollow(follow, messages, f.host)
    assert({
      given: 'a pending attachment on a message older than the checkpoint',
      should: 'retry the existing message without counting it as a new reply',
      actual: [
        f.writes.length,
        failed.newReplies,
        !!pendingSlackAttachment(parseSlackConversation(f.docs.get(ref)!.markdown).attachments[1]),
      ],
      expected: [1, 0, true],
    })
    await writeFile(original, 'Original PDF bytes')
    messages[0].files![1] = { id: 'F0REPORT', name: 'report.pdf', path: original }
    const recovered = await syncSlackFollow(follow, messages, f.host)
    const saved = f.docs.get(ref)!
    await syncSlackFollow(follow, messages, f.host)
    assert({
      given: 'a successful retry followed by another poll with no new messages',
      should: 'save the missing original once and consider both the remote link and local file complete',
      actual: [
        f.writes.length,
        recovered.newReplies,
        parseSlackConversation(saved.markdown).messages.length,
        parseSlackConversation(saved.markdown).attachments.some((a) => !!pendingSlackAttachment(a)),
        await readFile(path.join(temp, dayAttachmentsDir(day), saved.attachments[0].file), 'utf8'),
        f.docs.get(ref)!.toMarkdown(),
      ],
      expected: [2, 0, 1, false, 'Original PDF bytes', saved.toMarkdown()],
    })
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
