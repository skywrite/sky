import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { chatActivityInput, chatActivitySources } from '#commands/all/summary/lib/chatActivity.ts'
import { makeTempDir } from '#shared/fs/mod.ts'
import { dayAIChatsDir, dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import ChatDocument, { setUserSpeakerLabel } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { chatAutosaveFilename, writeChatAutosave } from './autosave.ts'
import { chatActivityDays, createChatActivityReader } from './dayActivity.ts'

setUserSpeakerLabel('Jane')
const DAYS = ['2030-06-17', '2030-06-18', '2030-06-19', '2030-06-20', '2030-06-21']
const messages: ConversationMessage[] = DAYS.flatMap((day, index) => [
  { role: 'user', when: `${day} 10:00`, content: `Discuss Atlas milestone ${index + 1}.` },
  { role: 'assistant', when: `${day} 10:01`, content: `Consider option ${index + 1}.` },
])

test('a five-day live chat contributes only each day’s own messages and keeps its original transcript home after closing', async () => {
  const root = await makeTempDir({ prefix: 'sky-chat-days-' })
  const timeDir = path.join(root, 'time')
  const snapshotDir = path.join(root, 'state')
  const startTime = new PlainDateTime(`${DAYS[0]} 10:00`)
  const snapshot = path.join(snapshotDir, chatAutosaveFilename(startTime, 'atlas-live'))
  const saved = path.join(timeDir, dayAIChatsDir(DAYS[0]), '10-00_Atlas.md')
  const reader = createChatActivityReader({ timeDir, baseDir: root, snapshotDir })
  try {
    await mkdir(path.dirname(saved), { recursive: true })
    await writeFile(
      saved,
      ChatDocument.create({
        summary: 'Atlas',
        created: DAYS[0],
        updated: DAYS[0],
        messages: messages.slice(0, 2),
      }).toMarkdown(),
    )
    await writeChatAutosave(snapshot, {
      turns: messages,
      contextLog: [],
      resume: null,
      startTime,
      recovery: { version: 1, host: { saved: path.relative(root, saved), saves: true, title: 'Atlas' } },
    })
    const results: unknown[][] = []
    for (const [index, day] of DAYS.entries()) {
      const result = await reader(day)
      const summaryDir = path.join(timeDir, dayDir(day))
      const prompt = chatActivityInput(result.chats, summaryDir, 'http://localhost:9999')
      const sources = chatActivitySources(result.chats, summaryDir, 'http://localhost:9999')
      results.push([
        result.errors,
        result.chats.length,
        result.chats[0].messages,
        result.chats[0].filedDay,
        prompt.includes(`milestone ${index + 1}`),
        prompt.includes(`milestone ${index === 0 ? 5 : index}`),
        sources.includes(`Started ${DAYS[0]}; activity on ${day}`),
        sources.includes('/chat/source/atlas-live'),
        sources.includes('Still open'),
      ])
    }
    assert({
      given: 'one active transcript spanning five notebook days',
      should: 'select the day before budgeting and retain visible cross-day provenance',
      actual: results,
      expected: DAYS.map((day, index) => [
        [],
        1,
        messages.slice(index * 2, index * 2 + 2),
        DAYS[0],
        true,
        false,
        true,
        true,
        true,
      ]),
    })
    const after = await reader('2030-06-22')
    assert({ given: 'an untouched sixth day', should: 'supply no chat activity', actual: after.chats, expected: [] })
    await writeFile(
      saved,
      ChatDocument.create({ summary: 'Atlas', created: DAYS[0], updated: DAYS[4], messages }).toMarkdown(),
    )
    await unlink(snapshot)
    const closed = await reader(DAYS[4])
    const source = chatActivitySources(closed.chats, path.join(timeDir, dayDir(DAYS[4])), 'http://localhost:9999')
    assert({
      given: 'Save and close updates the original file and removes recovery',
      should: 'still find the fifth day without moving or copying the transcript',
      actual: [
        closed.chats[0].path,
        closed.chats[0].open,
        closed.chats[0].messages,
        source.includes('Continued conversation'),
        source.includes('Saved when summarized'),
        ChatDocument.fromMarkdown(await readFile(saved, 'utf8')).conversation.length,
      ],
      expected: [saved, false, messages.slice(8), true, true, 10],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('activity excludes temporary messages and inherited branch turns, and preserves late notebook hours', async () => {
  const root = await makeTempDir({ prefix: 'sky-chat-day-filter-' })
  const startTime = new PlainDateTime(`${DAYS[4]} 10:00`)
  const own: ConversationMessage[] = [{ role: 'user', when: `${DAYS[4]} 25:30`, content: 'Choose the branch option.' }]
  try {
    for (const [id, saves, parent] of [
      ['temporary', false, null],
      ['branch', true, { chat: path.join('time', dayAIChatsDir(DAYS[0]), '10-00_Atlas.md'), turn: 5 }],
    ] as const) {
      await writeChatAutosave(path.join(root, chatAutosaveFilename(startTime, id)), {
        turns: [...messages, ...own],
        contextLog: [],
        resume: null,
        startTime,
        parent,
        recovery: { version: 1, host: { saves } },
      })
    }
    const reader = createChatActivityReader({ timeDir: path.join(root, 'time'), baseDir: root, snapshotDir: root })
    const day = await reader(DAYS[4])
    assert({
      given: 'a temporary chat and a branch carrying five inherited exchanges',
      should: 'summarize only the branch’s new message under its written notebook date',
      actual: [
        day.errors,
        day.chats.map((chat) => [chat.id, chat.messages, chat.started, chat.filedDay]),
        chatActivityDays(own),
        (await reader(DAYS[0])).chats,
      ],
      expected: [[], [['branch', own, DAYS[4], DAYS[0]]], { '2030-06-21': { when: '25:30', turns: 1 } }, []],
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
