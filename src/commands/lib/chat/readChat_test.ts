import { mkdir, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { makeTempDir } from '#shared/fs/mod.ts'
import { assert, test } from '#test'
import { MAX_TEXT_CHARS } from './fileTools.ts'
import { readChat, resolveChatPath } from './readChat.ts'

const CHAT = 'time/2026/W05/01-26/actions/ai-chats/16-00_Atlas-Launch-Plan.md'
const NOTE = 'time/2026/W05/01-26/actions/notes/Atlas-Plan.md'

async function notebook(chat: string): Promise<string> {
  const dir = await makeTempDir({ prefix: 'sky-read-chat-' })
  for (const [rel, text] of [
    [CHAT, chat],
    [NOTE, '# Atlas plan\n'],
  ] as const) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true })
    await writeFile(path.join(dir, rel), text)
  }
  return dir
}

const SAVED = [
  '---',
  'summary: Atlas launch plan',
  '---',
  '',
  '# Atlas launch plan',
  '',
  '## Summary (Opus 5.5, High)',
  '',
  '- Jane chose a May launch.',
  '',
  '## Conversation',
  '',
  '### 2026-01-26 16:00 - **Jane**',
  '',
  'When should Atlas launch?',
  '',
  '### 2026-01-26 16:01 - **Sky**',
  '',
  'May, after the escrow closes.',
  '',
  '<!-- CONTEXT-LOG',
  '{"v":2,"turns":[]}',
  '-->',
  '',
].join('\n')

test('readChat - a saved chat by the path its card came under', async () => {
  const dir = await notebook(SAVED)
  const read = await readChat({ path: CHAT }, dir)
  const slashed = await readChat({ path: `/${CHAT}` }, dir)
  assert({
    given: 'a saved chat named by its notebook path, bare and with a leading slash',
    should: 'return the whole chat without its context log, under its notebook path',
    actual: {
      success: read.success && slashed.success,
      path: read.success ? read.path : undefined,
      conversation: read.success && read.text.includes('May, after the escrow closes.'),
      summary: read.success && read.text.includes('- Jane chose a May launch.'),
      log: read.success && read.text.includes('CONTEXT-LOG'),
      paged: read.success && read.nextOffset !== undefined,
    },
    expected: { success: true, path: CHAT, conversation: true, summary: true, log: false, paged: false },
  })
})

test('readChat - anything but a saved chat in the notebook', async () => {
  const dir = await notebook(SAVED)
  const results = await Promise.all(
    [NOTE, '../outside/ai-chats/x.md', CHAT.replace('16-00', '17-00')].map((p) => readChat({ path: p }, dir)),
  )
  assert({
    given: 'a note, a path that leaves the notebook, and a chat that does not exist',
    should: 'refuse each with a reason and read nothing',
    actual: results.map((r) =>
      r.success
        ? 'read'
        : r.error.includes('is not a saved chat')
          ? 'not a chat'
          : r.error.startsWith('There is no')
            ? 'missing'
            : r.error,
    ),
    expected: ['not a chat', 'not a chat', 'missing'],
  })
})

test('readChat - a chat longer than one read continues from nextOffset', async () => {
  const dir = await notebook(SAVED.replace('May, after the escrow closes.', 'x'.repeat(MAX_TEXT_CHARS)))
  const first = await readChat({ path: CHAT }, dir)
  const rest = first.success && first.nextOffset ? await readChat({ path: CHAT, offset: first.nextOffset }, dir) : first
  assert({
    given: 'a chat whose text runs past one read',
    should: 'return the first part with where to continue, then the rest from there',
    actual: {
      firstLength: first.success ? first.text.length : 0,
      nextOffset: first.success ? first.nextOffset : undefined,
      whole: first.success && rest.success && first.text.length + rest.text.length === first.totalChars,
      restDone: rest.success && rest.nextOffset === undefined,
    },
    expected: { firstLength: MAX_TEXT_CHARS, nextOffset: MAX_TEXT_CHARS, whole: true, restDone: true },
  })
})

test('resolveChatPath - inside the notebook, in a chats folder, markdown', () => {
  const dir = '/notebook'
  assert({
    given: 'a chat path, an absolute one inside, one outside, and a chats folder itself',
    should: 'resolve only the saved chat files inside the notebook',
    actual: [
      resolveChatPath(CHAT, dir),
      resolveChatPath(`/notebook/${CHAT}`, dir),
      resolveChatPath(`./${CHAT}`, dir),
      resolveChatPath('/elsewhere/../../etc/ai-chats/x.md', dir),
      resolveChatPath('time/2026/W05/01-26/actions/ai-chats', dir),
    ],
    expected: [`/notebook/${CHAT}`, `/notebook/${CHAT}`, `/notebook/${CHAT}`, null, null],
  })
})
