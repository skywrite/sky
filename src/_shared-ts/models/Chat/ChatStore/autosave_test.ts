import * as path from 'node:path'
import { exists, makeTempDir, readDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ContextTurnLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { setUserSpeakerLabel } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { chatAutosaveFilename, clearChatAutosave, sweepChatAutosaves, writeChatAutosave } from './autosave.ts'
import { loadResumeSession, type ResumeSession } from './mod.ts'

setUserSpeakerLabel('Jane')

const START = new PlainDateTime('2026-01-27 09:30')

const msg = (role: 'user' | 'assistant', content: string, when?: string): ConversationMessage =>
  when ? { role, content, when } : { role, content }

const TURNS: ConversationMessage[] = [
  msg('user', 'What should I focus on for the Atlas launch?', '2026-01-27 09:30'),
  msg('assistant', 'The demo script and the pricing page copy.', '2026-01-27 09:31'),
]

const LOG: ContextTurnLog[] = [{ turn: 1, queries: ['project = "Atlas"'] }]

async function tmpStateDir(): Promise<string> {
  return makeTempDir({ prefix: 'sky-chat-autosave-' })
}

function autosaveInput(over: Partial<Parameters<typeof writeChatAutosave>[1]> = {}) {
  return {
    turns: TURNS,
    contextLog: LOG,
    resume: null,
    startTime: START,
    provider: 'claude',
    model: 'claude-opus-4-6',
    ...over,
  }
}

async function listNames(dir: string): Promise<string[]> {
  const names: string[] = []
  for await (const entry of readDir(dir)) names.push(entry.name)
  return names.sort()
}

test('chatAutosaveFilename - date and start time lead, pid disambiguates', () => {
  assert({
    given: 'a session start time and a pid',
    should: 'name the snapshot YYYY-MM-DD_HH-MM_pid.md',
    actual: chatAutosaveFilename(START, 4242),
    expected: '2026-01-27_09-30_4242.md',
  })
})

test('writeChatAutosave - a snapshot loads back like a saved transcript', async () => {
  const dir = await tmpStateDir()
  const filePath = path.join(dir, chatAutosaveFilename(START, 4242))

  await writeChatAutosave(filePath, autosaveInput())
  const session = await loadResumeSession(filePath)

  assert({
    given: 'a snapshot written after a completed turn',
    should: 'load through loadResumeSession with conversation, log, and stamps intact',
    actual: {
      summary: session.summary,
      created: session.created,
      healthy: session.frontmatterHealthy,
      conversation: session.state.conversation.map((m) => [m.role, m.content, m.when]),
      contextLog: session.state.contextLog.map((e) => ({ turn: e.turn, queries: e.queries })),
    },
    expected: {
      summary: 'What should I focus on for the Atlas launch?',
      created: '2026-01-27',
      healthy: true,
      conversation: TURNS.map((m) => [m.role, m.content, m.when]),
      contextLog: [{ turn: 1, queries: ['project = "Atlas"'] }],
    },
  })
})

test('writeChatAutosave - updated: tracks the latest turn stamp', async () => {
  const dir = await tmpStateDir()
  const filePath = path.join(dir, chatAutosaveFilename(START, 4242))

  const grown = [
    ...TURNS,
    msg('user', 'And the beta invite list?', '2026-01-28 08:00'),
    msg('assistant', 'Draft it from the waitlist.', '2026-01-28 08:01'),
  ]
  await writeChatAutosave(filePath, autosaveInput({ turns: grown }))
  const doc = ChatDocument.fromMarkdown(await readTextFile(filePath))

  assert({
    given: 'a conversation whose last turn landed on a later day',
    should: 'keep created: at the session start and move updated: to that day',
    actual: { created: doc.yaml['created'], updated: doc.yaml['updated'] },
    expected: { created: '2026-01-27', updated: '2026-01-28' },
  })
})

test('writeChatAutosave - a rewrite replaces the snapshot and leaves no temp file', async () => {
  const dir = await tmpStateDir()
  const filePath = path.join(dir, chatAutosaveFilename(START, 4242))

  await writeChatAutosave(filePath, autosaveInput())
  const grown = [
    ...TURNS,
    msg('user', 'And the beta invite list?', '2026-01-27 09:40'),
    msg('assistant', 'Draft it from the waitlist.', '2026-01-27 09:41'),
  ]
  await writeChatAutosave(filePath, autosaveInput({ turns: grown }))

  assert({
    given: 'two snapshots of the same session',
    should: 'leave exactly one file — no temp residue, no second snapshot',
    actual: await listNames(dir),
    expected: [path.basename(filePath)],
  })

  const session = await loadResumeSession(filePath)
  assert({
    given: 'the rewritten snapshot',
    should: 'hold the grown conversation',
    actual: session.state.conversation.length,
    expected: 4,
  })
})

test('writeChatAutosave - a resumed session keeps its file identity', async () => {
  const dir = await tmpStateDir()
  const filePath = path.join(dir, chatAutosaveFilename(START, 4242))

  const resume: ResumeSession = {
    filePath: '/notebook/time/2026-W04/2026-01-20-tue/actions/ai-chats/10-00_Atlas-Kickoff.md',
    created: '2026-01-20',
    summary: 'Atlas Kickoff',
    rel: ['projects/Atlas'],
    tags: ['planning'],
    attachments: [],
    approvals: [],
    frontmatterHealthy: true,
    state: { conversation: [], universePaths: [], queries: [], lastTurn: 0, contextLog: [] },
  }
  const externalFiles = new Map([['https://example.com/doc/atlas-plan', 'Launch Plan']])
  await writeChatAutosave(filePath, autosaveInput({ resume, externalFiles }))
  const session = await loadResumeSession(filePath)

  assert({
    given: 'a snapshot of a resumed session with an external artifact',
    should: 'carry the original summary, created, and tags, with the artifact joining rel',
    actual: { summary: session.summary, created: session.created, tags: session.tags, rel: session.rel },
    expected: {
      summary: 'Atlas Kickoff',
      created: '2026-01-20',
      tags: ['planning'],
      rel: ['projects/Atlas', '[Launch Plan](https://example.com/doc/atlas-plan)'],
    },
  })
})

test('writeChatAutosave - files read this session join the resumed file’s attachments once', async () => {
  const dir = await tmpStateDir()
  const filePath = path.join(dir, chatAutosaveFilename(START, 4242))

  const resume: ResumeSession = {
    filePath: '/notebook/time/2026-W04/2026-01-20-tue/actions/ai-chats/10-00_Atlas-Kickoff.md',
    created: '2026-01-20',
    summary: 'Atlas Kickoff',
    rel: [],
    tags: [],
    attachments: [{ file: '2026-01-20_Chat_Atlas-Brief.pdf' }],
    approvals: [],
    frontmatterHealthy: true,
    state: { conversation: [], universePaths: [], queries: [], lastTurn: 0, contextLog: [] },
  }
  await writeChatAutosave(
    filePath,
    autosaveInput({
      resume,
      attachments: [{ file: '2026-01-27_Chat_Atlas-MSA.pdf' }, { file: '2026-01-20_Chat_Atlas-Brief.pdf' }],
    }),
  )
  const session = await loadResumeSession(filePath)

  assert({
    given: 'a snapshot of a resumed session that read a new document and re-read the old one',
    should: 'list the earlier attachment first and the new one once',
    actual: session.attachments,
    expected: [{ file: '2026-01-20_Chat_Atlas-Brief.pdf' }, { file: '2026-01-27_Chat_Atlas-MSA.pdf' }],
  })
})

test('clearChatAutosave - removes the snapshot and tolerates absence', async () => {
  const dir = await tmpStateDir()
  const filePath = path.join(dir, chatAutosaveFilename(START, 4242))

  await writeChatAutosave(filePath, autosaveInput())
  await clearChatAutosave(filePath)
  await clearChatAutosave(filePath)

  assert({
    given: 'a snapshot cleared twice',
    should: 'be gone after the first clear and not error on the second',
    actual: await exists(filePath),
    expected: false,
  })
})

test('sweepChatAutosaves - reaps only dated files older than the cutoff', async () => {
  const dir = await tmpStateDir()
  await writeTextFile(path.join(dir, '2026-01-01_09-00_11.md'), 'old snapshot')
  await writeTextFile(path.join(dir, '.2026-01-01_09-00_11.md.tmp'), 'old temp residue')
  await writeTextFile(path.join(dir, '2026-01-26_09-00_22.md'), 'fresh snapshot')
  await writeTextFile(path.join(dir, 'notes.txt'), 'not an autosave')

  const removed = await sweepChatAutosaves(dir, new PlainDate('2026-01-27'), 14)

  assert({
    given: 'old snapshots, temp residue, a fresh snapshot, and a foreign file',
    should: 'remove only the dated files past the cutoff',
    actual: { removed, remaining: await listNames(dir) },
    expected: { removed: 2, remaining: ['2026-01-26_09-00_22.md', 'notes.txt'] },
  })
})

test('sweepChatAutosaves - a missing directory is an empty one', async () => {
  const dir = await tmpStateDir()

  assert({
    given: 'a state dir that was never created',
    should: 'sweep nothing and not error',
    actual: await sweepChatAutosaves(path.join(dir, 'never-created'), new PlainDate('2026-01-27')),
    expected: 0,
  })
})
