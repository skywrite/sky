import * as path from 'node:path'
import type { SlackCaptureMessage } from '#commands/all/slack/lib/captureMessages.ts'
import { writeMessage } from '#commands/all/slack/lib/captureMessages.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import MessageDocument from '#shared/models/Message/mod.ts'
import { updateSlackConversation } from '#shared/models/Message/slack/write.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import {
  type DmRecord,
  parseDmRecord,
  readDmRecord,
  recipientOf,
  serializeDmRecord,
  syncDmRecord,
  writeDmRecord,
} from './dms.ts'

const message = (ts: string, timeLabel: string, text: string, userName: string): SlackCaptureMessage => ({
  channelId: 'D0ATLAS0001',
  ts,
  timeLabel,
  text,
  userName,
})

test('a conversation record round-trips and reads back without its optional parts', async () => {
  const record: DmRecord = {
    id: 'D0ATLAS0001',
    kind: 'dm',
    label: 'Jane Doe',
    cursor: '1760000000.000100',
    docs: [{ date: '2026-10-19', path: 'time/2026-10-19/messages/x.md' }],
    lastActivity: '2026-10-19 09:14',
  }
  assert({
    given: 'a record with everything',
    should: 'read back the same',
    actual: parseDmRecord(serializeDmRecord(record), record.id),
    expected: record,
  })
  assert({
    given: 'an empty file, and a bare record',
    should: 'read as nothing, and as a dm with no docs',
    actual: [parseDmRecord(undefined, 'D0X'), parseDmRecord('label: Someone\n', 'D0X')],
    expected: [undefined, { id: 'D0X', kind: 'dm', label: 'Someone', docs: [] }],
  })
  const dir = await makeTempDir({ prefix: 'sky-slack-dms-' })
  await writeDmRecord(dir, record)
  assert({
    given: 'the record written and a missing one',
    should: 'read back, and read as nothing',
    actual: [await readDmRecord(dir, record.id), await readDmRecord(dir, 'D0NONE')],
    expected: [record, undefined],
  })
  assert({
    given: 'the file name',
    should: 'be the id',
    actual: path.basename(path.join(dir, `${record.id}.yaml`)),
    expected: 'D0ATLAS0001.yaml',
  })
})

test('the recipient is the other side of the conversation', () => {
  const dm = { kind: 'dm' as const, label: 'Jane Doe' }
  const group = { kind: 'group' as const, label: 'Jane Doe, Joe Bloggs' }
  assert({
    given: 'a dm written by the owner, by the partner, with and without the owner’s name, and a group',
    should: 'address the partner, the owner, the partner again, and the others',
    actual: [
      recipientOf(dm, ['Jane Doe'], 'Sam Owner', 'Sam Owner'),
      recipientOf(dm, ['Jane Doe'], 'Jane Doe', 'Sam Owner'),
      recipientOf(dm, ['Jane Doe'], 'Jane Doe'),
      recipientOf(group, ['Jane Doe', 'Joe Bloggs'], 'Joe Bloggs', 'Sam Owner'),
      recipientOf(group, [], 'Joe Bloggs'),
    ],
    expected: ['Jane Doe', 'Sam Owner', 'Jane Doe', 'Jane Doe', 'Jane Doe, Joe Bloggs'],
  })
})

test('syncDmRecord lands a day per document, appends to a day it already has, and moves the cursor', async () => {
  const docs = new Map<string, MessageDocument>()
  const calls: string[] = []
  const host = {
    read: async (ref: string) => docs.get(ref)!,
    notebookTime: async (label: string) => PlainDateTime.fromString(label),
    update: async (ref: string, doc: MessageDocument, messages: SlackCaptureMessage[]) => {
      calls.push(`update ${ref} +${messages.length}`)
      docs.set(ref, new MessageDocument(doc.yaml, updateSlackConversation(doc.markdown, messages.map(writeMessage))))
    },
    create: async ({ messages, when }: { messages: SlackCaptureMessage[]; when: PlainDateTime }) => {
      const ref = `time/${when.plainDate}/messages/dm.md`
      calls.push(`create ${ref} ${messages.length}`)
      docs.set(ref, new MessageDocument({}, updateSlackConversation('# DM\n\n', messages.map(writeMessage))))
      return ref
    },
  }
  const first = await syncDmRecord(
    { id: 'D0ATLAS0001', kind: 'dm', label: 'Jane Doe', docs: [] },
    [
      message('1760000000.000100', '2026-10-19 09:00', 'Hi', 'Jane Doe'),
      message('1760003600.000100', '2026-10-19 10:00', 'Hello', 'Sam Owner'),
      message('1760090000.000100', '2026-10-20 10:00', 'Next day', 'Jane Doe'),
    ],
    host,
  )
  assert({
    given: 'three messages over two days, nothing landed yet',
    should: 'create a document per day and remember both, the cursor and the last activity',
    actual: [calls, first.newMessages, first.record],
    expected: [
      ['create time/2026-10-19/messages/dm.md 2', 'create time/2026-10-20/messages/dm.md 1'],
      3,
      {
        id: 'D0ATLAS0001',
        kind: 'dm',
        label: 'Jane Doe',
        cursor: '1760090000.000100',
        lastActivity: '2026-10-20 10:00',
        docs: [
          { date: '2026-10-19', path: 'time/2026-10-19/messages/dm.md' },
          { date: '2026-10-20', path: 'time/2026-10-20/messages/dm.md' },
        ],
      },
    ],
  })
  calls.length = 0
  const second = await syncDmRecord(
    first.record,
    [
      message('1760090000.000100', '2026-10-20 10:00', 'Next day', 'Jane Doe'),
      message('1760093600.000100', '2026-10-20 11:00', 'And more', 'Sam Owner'),
    ],
    host,
  )
  assert({
    given: 'the same day again with one new message',
    should: 'append to that day’s document only',
    actual: [calls, second.newMessages, second.record.cursor, second.record.docs.length],
    expected: [['update time/2026-10-20/messages/dm.md +2'], 1, '1760093600.000100', 2],
  })
})
