import { DOC_MAX_CHARS } from '#shared/models/AI/DocumentPages/mod.ts'
import { assert, test } from '#test'
import { findLiveChats, liveChatId, readLiveChat, type LiveChat } from './liveChats.ts'
import { createReadChatTool, readChat } from './readChat.ts'

function chat(id: string, content: string, over: Partial<LiveChat> = {}): LiveChat {
  return {
    id,
    title: 'Atlas planning',
    source: `/chat/source/${id}`,
    busy: false,
    inherited: 0,
    turns: [{ role: 'user', content, when: '2026-01-27 10:00' }],
    ...over,
  }
}

test('find chats searches conversation content and ranks topic coverage before recency', () => {
  const chats = [
    chat('recent', 'Plan the Atlas launch.'),
    chat('positioning', 'Atlas positioning: make sample imports effortless.'),
    chat('unrelated', 'Order more pencils.'),
    chat('inherited', 'Atlas positioning', {
      inherited: 1,
      turns: [
        { role: 'user', content: 'Atlas positioning' },
        { role: 'user', content: 'Order pencils.' },
      ],
      title: 'Pencil colors',
    }),
    chat('hidden', '<!-- secret-positioning -->', { title: null }),
  ]
  const result = findLiveChats(() => chats, { query: 'Atlas positioning' })
  assert({
    given: 'a topic in a conversation whose title does not name it, plus recent and inherited matches',
    should: 'rank the relevant body first, label excerpts, and omit hidden comments and inherited-only matches',
    actual: {
      paths: result.chats.map((item) => item.path),
      excerpt: result.chats[0]?.excerpts[0],
      hidden: findLiveChats(() => chats, { query: 'secret' }).total,
    },
    expected: {
      paths: ['/thread/positioning', '/thread/recent', '/thread/unrelated'],
      excerpt: { role: 'user', when: '2026-01-27 10:00', text: 'Atlas positioning: make sample imports effortless.' },
      hidden: 0,
    },
  })
})

test('find chats bounds previews and pages recent conversations without a query', () => {
  const chats = Array.from({ length: 13 }, (_, index) => chat(`sample-${index}`, 'x'.repeat(2000)))
  const first = findLiveChats(() => chats, {})
  const rest = findLiveChats(() => chats, { offset: first.nextOffset })
  assert({
    given: 'more open conversations than one result page',
    should: 'return bounded previews and a continuation without dropping or duplicating chats',
    actual: [first.chats.length, first.chats[0]?.excerpts[0]?.text.length, rest.chats.length, rest.nextOffset],
    expected: [10, 400, 3, undefined],
  })
})

test('read live chat preserves speakers, includes new messages, and marks a busy source', async () => {
  const source = chat('source', 'Use a calm tone. <!-- hidden context -->')
  const access = () => [source]
  const first = await readChat({ path: '/thread/source' }, '/notebook', access)
  source.turns = [...source.turns, { role: 'assistant', content: 'A proposed Atlas introduction.' }]
  source.busy = true
  const latest = readLiveChat(access, 'source', {})
  assert({
    given: 'another open chat gains a recorded response and starts working again',
    should: 'read fresh labeled messages, remove comments, link to the source, and disclose unfinished work',
    actual: {
      first: first.success && first.text.includes('A proposed Atlas introduction.'),
      latest:
        latest.success &&
        ['### User', '### Sky', 'A proposed Atlas introduction.'].every((s) => latest.text.includes(s)),
      hidden: latest.success && latest.text.includes('hidden context'),
      source: latest.success && latest.source,
      busy: latest.success && latest.busy && latest.note.includes('not included'),
    },
    expected: { first: false, latest: true, hidden: false, source: '/chat/source/source', busy: true },
  })
})

test('live pagination refuses to splice different versions of a conversation', () => {
  const source = chat('long', 'x'.repeat(DOC_MAX_CHARS + 100))
  const access = () => [source]
  const first = readLiveChat(access, 'long', {})
  if (!first.success) throw new Error(first.error)
  const rest = readLiveChat(access, 'long', { offset: first.nextOffset, version: first.version })
  const unversioned = readLiveChat(access, 'long', { offset: first.nextOffset })
  source.turns = [...source.turns, { role: 'user', content: 'A new direction.' }]
  const stale = readLiveChat(access, 'long', { offset: first.nextOffset, version: first.version })
  const fresh = readLiveChat(access, 'long', {})
  assert({
    given: 'a long conversation changes between page reads',
    should: 'complete matching pages, reject missing or stale versions, and allow a fresh read',
    actual: [
      first.text.length,
      rest.success && first.text.length + rest.text.length === first.totalChars,
      unversioned.success,
      stale.success,
      !stale.success && stale.error.includes('offset 0'),
      fresh.success && fresh.version !== first.version,
    ],
    expected: [DOC_MAX_CHARS, true, false, false, true, true],
  })
})

test('live chat links resolve locally and unavailable chats return an actionable error', async () => {
  const missing = await readChat({ path: '/thread/closed' }, '/notebook', () => [])
  assert({
    given: 'local chat links, a remote URL, a saved path, and a closed conversation',
    should: 'recognize only local chat routes and explain how to find another available source',
    actual: {
      ids: [
        '/thread/atlas?returnTo=%2F',
        'http://localhost:9999/thread/atlas',
        '/chat/source/atlas',
        'https://example.com/thread/atlas',
        'time/2026/ai-chats/atlas.md',
      ].map(liveChatId),
      missing: !missing.success && missing.error.includes('find_chats'),
    },
    expected: { ids: ['atlas', 'atlas', 'atlas', null, null], missing: true },
  })
})

test('web chat tools discover and read a source while other hosts retain saved chat reading', async () => {
  const tools = createReadChatTool({ notebookDir: '/notebook', liveChats: () => [chat('source', 'Sample imports')] })
  const call = { toolCallId: 'sample-read', messages: [], context: {} }
  const found = (await tools.find_chats!.execute!({ query: 'imports' }, call)) as ReturnType<typeof findLiveChats>
  const read = (await tools.read_chat.execute!({ path: found.chats[0]!.path }, call)) as Awaited<
    ReturnType<typeof readChat>
  >
  const savedOnly = createReadChatTool({ notebookDir: '/notebook' })
  assert({
    given: 'tools with and without an open-conversation host',
    should: 'support discovery then reading in the web host without advertising unavailable discovery elsewhere',
    actual: [read.success && read.text.includes('Sample imports'), Object.keys(savedOnly)],
    expected: [true, ['read_chat']],
  })
})
