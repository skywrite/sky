import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, makeTempDir, readDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { type ContextLogDetails, type ContextTurnLog, serializeContextLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { setUserSpeakerLabel } from '../document/mod.ts'
import { chatLogDirOf, chatLogPath, moveChatLogOut, readChatLog, writeChatLog } from './logFile.ts'
import { loadResumeSession } from './mod.ts'

setUserSpeakerLabel('Jane')

const CHAT = 'time/2026/W05/01-27/actions/ai-chats/09-30_Atlas-Launch-Planning.md'
const TRANSCRIPT = '# Atlas Launch Planning\n\n## Conversation\n\n### **Jane**\n\nWhat should I focus on?\n'

const LOG: ContextTurnLog[] = [
  {
    turn: 1,
    queries: ['{ chats { path } }'],
    universe: [{ path: 'projects/open/Atlas/plan.md', tokens: 120, score: 9 }],
  },
  { turn: 2, queries: [], usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 4 } },
]

const DETAILS: ContextLogDetails = {
  statistics: {
    messages: 4,
    replies: 2,
    wallMs: 0,
    usage: { input: 10, cacheRead: 0, cacheWrite: 0, output: 4 },
    models: {},
    tools: {},
  },
  // A comment closer in a value: a file needs no escaping for it, a trailing comment does.
  session: { version: 1, historyKey: 'atlas-key', host: { title: 'Atlas --> launch' } },
}

/** A temp notebook with its chats' log folder beside it, under a state folder. */
async function notebook() {
  const root = await makeTempDir({ prefix: 'sky-chat-log-' })
  const baseDir = path.join(root, 'notebook')
  const home = { baseDir, chatLogDir: chatLogDirOf(path.join(root, 'state', 'ai', 'chats')) }
  return { root, baseDir, home, chat: path.join(baseDir, CHAT) }
}

test('chatLogPath - a log is keyed by its transcript place in the notebook', async () => {
  const { root, baseDir, home, chat } = await notebook()
  assert({
    given: 'a transcript in the notebook, one outside it, and the notebook root itself',
    should: 'mirror the notebook path under the log folder as JSON, and key nothing outside the notebook',
    actual: [
      path.relative(root, chatLogPath(chat, home)!),
      chatLogPath(path.join(root, 'elsewhere', 'chat.md'), home),
      chatLogPath(baseDir, home),
    ],
    expected: ['state/ai/chats/logs/time/2026/W05/01-27/actions/ai-chats/09-30_Atlas-Launch-Planning.json', null, null],
  })
})

test('writeChatLog - a log written to its file reads back whole, and replaces the one before', async () => {
  const { home, chat } = await notebook()
  await writeChatLog(chat, home, [LOG[0]!])
  const file = await writeChatLog(chat, home, LOG, DETAILS)
  const beside: string[] = []
  for await (const entry of readDir(path.dirname(file!))) beside.push(entry.name)

  assert({
    given: 'a log written twice for one transcript, the second time with statistics and a session',
    should: 'read back the second whole, with the comment closer as written, and leave no temp file',
    actual: {
      log: await readChatLog(chat, TRANSCRIPT, home),
      closerAsWritten: (await readTextFile(file!)).includes('Atlas --> launch'),
      beside,
    },
    expected: {
      log: { entries: LOG, details: DETAILS },
      closerAsWritten: true,
      beside: ['09-30_Atlas-Launch-Planning.json'],
    },
  })
})

test('readChatLog - a transcript that carries its own log is read from it, whatever its log file says', async () => {
  const { home, chat } = await notebook()
  await writeChatLog(chat, home, [{ turn: 9, queries: ['from the log file'] }])

  assert({
    given: 'a transcript saved with its log as a trailing comment, and a log file at its key',
    should: 'read the log the transcript carries',
    actual: await readChatLog(chat, TRANSCRIPT + serializeContextLog(LOG, DETAILS), home),
    expected: { entries: LOG, details: DETAILS },
  })
})

test('readChatLog - a chat with no log still reads', async () => {
  const { home, chat } = await notebook()
  const unreadable = path.join(home.baseDir, 'time/2026/W05/01-27/actions/ai-chats/10-00_Damaged.md')
  const damaged = chatLogPath(unreadable, home)!
  await mkdir(path.dirname(damaged), { recursive: true })
  await writeTextFile(damaged, '{ "version": 2, "turns": [')
  await writeChatLog(chat, home, LOG)

  assert({
    given: 'no log file, a log file that does not parse, a transcript outside the notebook, and no log folder given',
    should: 'read each as a chat without a log',
    actual: [
      await readChatLog(
        path.join(home.baseDir, 'time/2026/W05/01-27/actions/ai-chats/11-00_None.md'),
        TRANSCRIPT,
        home,
      ),
      await readChatLog(unreadable, TRANSCRIPT, home),
      await readChatLog(path.join(home.baseDir, '..', 'elsewhere.md'), TRANSCRIPT, home),
      await readChatLog(chat, TRANSCRIPT),
    ],
    expected: [{ entries: [] }, { entries: [] }, { entries: [] }, { entries: [] }],
  })
})

test('writeChatLog - a transcript outside the notebook has no log file', async () => {
  const { root, home } = await notebook()
  assert({
    given: 'a transcript that is not under the notebook root',
    should: 'write nothing and say so, leaving the caller to keep the log with the transcript',
    actual: await writeChatLog(path.join(root, 'elsewhere', 'chat.md'), home, LOG),
    expected: null,
  })
})

// ---------------------------------------------------------------------------
// Moving a log out of a transcript saved the earlier way
// ---------------------------------------------------------------------------

/** A transcript as a save wrote it: frontmatter and the conversation, nothing after. */
const SAVED = ChatDocument.create({
  summary: 'Atlas Launch Planning',
  created: '2026-01-27',
  updated: '2026-01-27',
  messages: [
    { role: 'user', content: 'What should I focus on for the Atlas launch?', when: '2026-01-27 09:30' },
    { role: 'assistant', content: 'The demo script and the pricing page copy.', when: '2026-01-27 09:31' },
  ],
}).toMarkdown()

/** The same chat saved the earlier way, its log a trailing comment. */
const WITH_LOG = SAVED + serializeContextLog(LOG, DETAILS)

async function savedTheEarlierWay(text = WITH_LOG) {
  const book = await notebook()
  await mkdir(path.dirname(book.chat), { recursive: true })
  await writeTextFile(book.chat, text)
  return book
}

test('moveChatLogOut - the log leaves the transcript whole, and the chat loads as it did', async () => {
  const { home, chat } = await savedTheEarlierWay()
  const before = await loadResumeSession(chat, home)
  const move = await moveChatLogOut(chat, home)
  const after = await loadResumeSession(chat, home)

  assert({
    given: 'a transcript carrying its log as a trailing comment',
    should: 'leave the conversation alone in the transcript, the log in its file, and load the same chat',
    actual: {
      move,
      transcript: (await readTextFile(chat)) === SAVED,
      log: await readChatLog(chat, SAVED, home),
      sameState: JSON.stringify(after.state) === JSON.stringify(before.state),
      sameRecovery: JSON.stringify(after.recovery) === JSON.stringify(before.recovery),
      temp: await exists(path.join(path.dirname(chat), `.${path.basename(chat)}.log-move-tmp`)),
    },
    expected: {
      move: { outcome: 'moved', bytes: Buffer.byteLength(WITH_LOG, 'utf8') - Buffer.byteLength(SAVED, 'utf8') },
      transcript: true,
      log: { entries: LOG, details: DETAILS },
      sameState: true,
      sameRecovery: true,
      temp: false,
    },
  })
})

test('moveChatLogOut - the log is copied as written, keys this version does not know included', async () => {
  const json = JSON.stringify({ version: 2, turns: [{ turn: 1, queries: [] }], session: { version: 1, later: true } })
  const { home, chat } = await savedTheEarlierWay(`${SAVED}\n\n<!-- CONTEXT-LOG\n${json}\n-->\n`)
  await moveChatLogOut(chat, home)

  assert({
    given: 'a log holding a key added by a later version',
    should: 'write the log file with the text the comment held',
    actual: await readTextFile(chatLogPath(chat, home)!),
    expected: `${json}\n`,
  })
})

test('moveChatLogOut - a dry run changes nothing and says what would leave', async () => {
  const { home, chat } = await savedTheEarlierWay()
  const move = await moveChatLogOut(chat, home, { dryRun: true })

  assert({
    given: 'a dry run over a transcript carrying its log',
    should: 'report the move and write neither file',
    actual: {
      outcome: move.outcome,
      transcript: (await readTextFile(chat)) === WITH_LOG,
      logFile: await exists(chatLogPath(chat, home)!),
    },
    expected: { outcome: 'moved', transcript: true, logFile: false },
  })
})

test('moveChatLogOut - a move that stopped after writing the log file finishes', async () => {
  const { home, chat } = await savedTheEarlierWay()
  // The first half of a move: the log file is in place, the transcript not yet rewritten.
  await moveChatLogOut(chat, home)
  await writeTextFile(chat, WITH_LOG)

  assert({
    given: 'a transcript still carrying the log its log file already holds',
    should: 'finish the move',
    actual: [(await moveChatLogOut(chat, home)).outcome, (await readTextFile(chat)) === SAVED],
    expected: ['moved', true],
  })
})

test('moveChatLogOut - a transcript it cannot move safely is left exactly as it was', async () => {
  const later = `${SAVED}\n\n<!-- CONTEXT-LOG\n{ "version": 99, "turns": [] }\n-->\n`
  const twice = `${SAVED}${serializeContextLog([LOG[0]!])}`.trimEnd() + serializeContextLog(LOG)
  const cases: [string, string, (home: Awaited<ReturnType<typeof notebook>>) => Promise<void>][] = [
    ['no log', SAVED, async () => {}],
    ['a log of another version', later, async () => {}],
    ['two logs', twice, async () => {}],
    [
      'another log file at its key',
      WITH_LOG,
      async (book) => void (await writeChatLog(book.chat, book.home, [LOG[0]!])),
    ],
  ]
  const outcomes: unknown[][] = []
  for (const [name, text, prepare] of cases) {
    const book = await savedTheEarlierWay(text)
    await prepare(book)
    const move = await moveChatLogOut(book.chat, book.home)
    outcomes.push([name, move, (await readTextFile(book.chat)) === text])
  }
  const outside = await notebook()
  const stray = path.join(outside.root, 'elsewhere', 'chat.md')
  await mkdir(path.dirname(stray), { recursive: true })
  await writeTextFile(stray, WITH_LOG)
  outcomes.push([
    'outside the notebook',
    await moveChatLogOut(stray, outside.home),
    (await readTextFile(stray)) === WITH_LOG,
  ])

  assert({
    given: 'transcripts with nothing to move, or whose log may be the only copy',
    should: 'change none of them and give the reason',
    actual: outcomes,
    expected: [
      ['no log', { outcome: 'none' }, true],
      ['a log of another version', { outcome: 'kept', reason: 'its log does not read as the current version' }, true],
      ['two logs', { outcome: 'kept', reason: 'it carries more than one log' }, true],
      ['another log file at its key', { outcome: 'kept', reason: 'a different log file is already at its key' }, true],
      [
        'outside the notebook',
        { outcome: 'kept', reason: 'it is outside the notebook, with nowhere to key a log file' },
        true,
      ],
    ],
  })
})
