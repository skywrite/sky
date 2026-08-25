import * as path from 'node:path'
import { exists, makeTempDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import type { MemoryEntry } from '#shared/models/Memory/mod.ts'
import type { MemoryOp } from '#shared/models/Memory/write.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ContextTurnLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { setUserSpeakerLabel } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { loadResumeSession } from './mod.ts'
import { chatFilename, type SaveEnricher, saveChat } from './save.ts'

setUserSpeakerLabel('Jane')

const DAY = new PlainDate('2026-01-27')
const START = new PlainDateTime('2026-01-27 09:30')
const END = new PlainDateTime('2026-01-27 10:05')
const FIXTURES = path.join(import.meta.dirname!, 'fixtures', 'ai-chats')

const msg = (role: 'user' | 'assistant', content: string, when?: string): ConversationMessage =>
  when ? { role, content, when } : { role, content }

const TURNS: ConversationMessage[] = [
  msg('user', 'What should I focus on for the Atlas launch?', '2026-01-27 09:30'),
  msg('assistant', 'The demo script and the pricing page copy.', '2026-01-27 09:31'),
]

/**
 * Every save in this file runs offline. The real enricher calls three
 * models; a test that reached them would be slow, flaky, and would file
 * its results against the live corpus.
 */
const stubEnricher = (over: Partial<SaveEnricher> = {}): SaveEnricher => ({
  summarize: async () => 'Atlas Launch Planning',
  chooseTags: async () => undefined,
  chooseRel: async () => undefined,
  ...over,
})

const neverCalled: SaveEnricher = {
  summarize: () => Promise.reject(new Error('summarize must not be called')),
  chooseTags: () => Promise.reject(new Error('chooseTags must not be called')),
  chooseRel: () => Promise.reject(new Error('chooseRel must not be called')),
  // Every save in this file that passes no memoryDir must never distill.
  distillMemories: () => Promise.reject(new Error('distillMemories must not be called')),
}

async function tmpNotebook(): Promise<string> {
  return makeTempDir({ prefix: 'sky-chatstore-' })
}

/** A saved new chat, plus the temp notebook it lives in. */
async function saveNew(over: Partial<Parameters<typeof saveChat>[0]> = {}) {
  const timeDir = await tmpNotebook()
  const report = await saveChat({
    turns: TURNS,
    contextLog: [],
    resume: null,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    enricher: stubEnricher(),
    ...over,
  })
  return { timeDir, report }
}

test('chatFilename - time key leads, summary slugified to seven words', () => {
  assert({
    given: 'a start time and a summary',
    should: 'name the file HH-MM_Slugified-Summary.md',
    actual: chatFilename(START, 'Atlas Launch Planning'),
    expected: '09-30_Atlas-Launch-Planning.md',
  })

  assert({
    given: 'a long summary carrying punctuation',
    should: 'strip the punctuation and stop at seven words',
    actual: chatFilename(START, "Atlas's launch: demo, pricing, and the announcement outline we owe"),
    expected: '09-30_Atlass-launch-demo-pricing-and-the-announcement.md',
  })
})

test('saveChat - a new chat files under its day and reparses whole', async () => {
  const { timeDir, report } = await saveNew()

  assert({
    given: 'a new chat with no file yet',
    should: 'file it under the day the chat belongs to',
    actual: path.relative(timeDir, report.path),
    expected: path.join(dayDir(DAY), 'actions', 'ai-chats', '09-30_Atlas-Launch-Planning.md'),
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'the transcript written to disk',
    should: 'reparse to the frontmatter and conversation it was given',
    actual: {
      created: doc.yaml['created'],
      updated: doc.yaml['updated'],
      turns: doc.yaml['turns'],
      provider: doc.provider,
      model: doc.model,
      summary: doc.summary,
      conversation: doc.conversation.map((m) => m.content),
    },
    expected: {
      created: '2026-01-27',
      updated: '2026-01-27',
      turns: 1,
      provider: 'claude',
      model: 'claude-opus-4-6',
      summary: 'Atlas Launch Planning',
      conversation: TURNS.map((m) => m.content),
    },
  })

  assert({
    given: 'a save that was not asked to log to the day file',
    should: 'report no day-log outcome at all',
    actual: report.dayLog,
    expected: undefined,
  })
})

test('saveChat - an enricher that declines to title falls back to the first words', async () => {
  const { report } = await saveNew({ enricher: stubEnricher({ summarize: async () => undefined }) })

  assert({
    given: 'a summarizer that returned nothing usable',
    should: 'title the chat from the opening message rather than leaving it blank',
    actual: report.summary,
    expected: 'What should I focus on for the Atlas launch?',
  })
})

test('saveChat - the corpus fills tags and rel only when asked', async () => {
  const { report } = await saveNew({
    autoTag: true,
    autoRel: true,
    enricher: stubEnricher({
      chooseTags: async () => 'Atlas/Launch; Atlas/Planning',
      chooseRel: async () => ['projects/Atlas/Roadmap.md'],
    }),
  })

  assert({
    given: 'a chat with no tags or rel of its own',
    should: 'report what the corpus chose so the host can echo it',
    actual: { autoTags: report.autoTags, autoRel: report.autoRel },
    expected: { autoTags: 'Atlas/Launch; Atlas/Planning', autoRel: ['projects/Atlas/Roadmap.md'] },
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'the saved transcript',
    should: 'carry the chosen tags and rel',
    actual: { tags: [...doc.tags], rel: [...doc.rel] },
    expected: { tags: ['Atlas/Launch', 'Atlas/Planning'], rel: ['projects/Atlas/Roadmap.md'] },
  })
})

test('saveChat - artifact links join rel as titled entries', async () => {
  const { report } = await saveNew({
    externalFiles: new Map([['https://docs.example.com/d/atlas-brief', 'Atlas Launch Brief']]),
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'a session whose tools touched an external file',
    should: 'record it in rel as a titled link',
    actual: [...doc.rel],
    expected: ['[Atlas Launch Brief](https://docs.example.com/d/atlas-brief)'],
  })
})

test('saveChat - resuming writes back to the same file, keeping created and growing the transcript', async () => {
  const { report: first } = await saveNew()
  const resume = await loadResumeSession(first.path)

  const continued = [
    ...TURNS,
    msg('user', 'Draft the announcement outline.', '2026-01-28 08:12'),
    msg('assistant', 'Intro, demo, pricing, call to action.', '2026-01-28 08:13'),
  ]
  const report = await saveChat({
    turns: continued,
    contextLog: [],
    resume,
    timeDir: 'unused-on-resume',
    day: DAY,
    startTime: START,
    endTime: new PlainDateTime('2026-01-28 08:20'),
    provider: 'claude',
    model: 'claude-opus-4-6',
    enricher: neverCalled,
  })

  assert({
    given: 'a resumed session',
    should: 'write back to the original path, unrefused',
    actual: { path: report.path, resumed: report.resumed, aborted: report.aborted },
    expected: { path: first.path, resumed: true, aborted: undefined },
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'the rewritten file',
    should: 'keep created, bump updated, and hold both exchanges',
    actual: {
      created: doc.yaml['created'],
      updated: doc.yaml['updated'],
      turns: doc.yaml['turns'],
      summary: doc.summary,
      conversation: doc.conversation.length,
    },
    expected: {
      created: '2026-01-27',
      updated: '2026-01-28',
      turns: 2,
      summary: 'Atlas Launch Planning',
      conversation: 4,
    },
  })
})

test('saveChat - a resume fills only the fields the file is missing', async () => {
  const { report: first } = await saveNew({
    autoTag: true,
    enricher: stubEnricher({ chooseTags: async () => 'Atlas/Launch' }),
  })
  const resume = await loadResumeSession(first.path)

  const report = await saveChat({
    turns: [...TURNS, msg('user', 'One more thing.', '2026-01-27 10:00')],
    contextLog: [],
    resume,
    timeDir: 'unused-on-resume',
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    autoTag: true,
    autoRel: true,
    enricher: {
      // The file already decided its title and tags — asking again is the bug.
      summarize: () => Promise.reject(new Error('summarize must not be called')),
      chooseTags: () => Promise.reject(new Error('chooseTags must not be called')),
      chooseRel: async () => ['projects/Atlas/Roadmap.md'],
    },
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'a resumed chat carrying a summary and tags but no rel',
    should: 'keep what it decided and fill only what it never had',
    actual: { summary: doc.summary, tags: [...doc.tags], rel: [...doc.rel] },
    expected: {
      summary: 'Atlas Launch Planning',
      tags: ['Atlas/Launch'],
      rel: ['projects/Atlas/Roadmap.md'],
    },
  })
})

test('saveChat - a resume refuses to overwrite malformed frontmatter and parks the work', async () => {
  const timeDir = await tmpNotebook()
  const original = path.join(timeDir, '16-45_Vendor-Landscape-Review.md')
  const before = await readTextFile(path.join(FIXTURES, '16-45_Vendor-Landscape-Review.md'))
  await writeTextFile(original, before)

  const resume = await loadResumeSession(original)
  const recoveryDir = path.join(timeDir, 'recovery')
  const report = await saveChat({
    turns: [...resume.state.conversation, msg('user', 'And the fourth vendor?', '2026-01-27 17:02')],
    contextLog: [],
    resume,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    recoveryDir,
    enricher: neverCalled,
  })

  assert({
    given: 'a transcript whose turns: swallowed the keys after it',
    should: 'refuse the rewrite and say why',
    actual: report.aborted,
    expected: { originalPath: original, reason: 'its frontmatter is malformed and a rewrite would lose data' },
  })

  assert({
    given: 'the original file after a refused write-back',
    should: 'be byte-for-byte untouched',
    actual: await readTextFile(original),
    expected: before,
  })

  assert({
    given: 'the refused session',
    should: 'park its transcript in the recovery directory instead of losing it',
    actual: {
      inRecoveryDir: path.dirname(report.path) === recoveryDir,
      exists: await exists(report.path),
      holdsTheNewMessage: (await readTextFile(report.path)).includes('And the fourth vendor?'),
    },
    expected: { inRecoveryDir: true, exists: true, holdsTheNewMessage: true },
  })
})

test('saveChat - a candidate that lost earlier history fails the self-check', async () => {
  const { report: first, timeDir } = await saveNew()
  const before = await readTextFile(first.path)
  const resume = await loadResumeSession(first.path)

  // Drops the opening exchange — exactly the serialization bug the gate exists to catch.
  const report = await saveChat({
    turns: [msg('user', 'Draft the announcement outline.', '2026-01-27 10:00')],
    contextLog: [],
    resume,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    recoveryDir: path.join(timeDir, 'recovery'),
    enricher: neverCalled,
  })

  assert({
    given: 'a candidate transcript missing the conversation it was resumed from',
    should: 'refuse the write-back as a failed self-check',
    actual: report.aborted?.reason.startsWith('the write-back self-check failed'),
    expected: true,
  })

  assert({
    given: 'the original file after the failed self-check',
    should: 'be byte-for-byte untouched',
    actual: await readTextFile(first.path),
    expected: before,
  })
})

test('saveChat - day-file logging is skipped on resume, never duplicated', async () => {
  const { report: first } = await saveNew()
  const resume = await loadResumeSession(first.path)

  const report = await saveChat({
    turns: [...TURNS, msg('user', 'One more thing.', '2026-01-27 10:00')],
    contextLog: [],
    resume,
    timeDir: 'unused-on-resume',
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    logToDay: { category: 'Professional' },
    enricher: neverCalled,
  })

  assert({
    given: 'a resumed chat asked to log to the day file',
    should: 'skip it — the chat was logged when it was first saved',
    actual: report.dayLog,
    expected: { logged: false, reason: 'resume' },
  })
})

// ---------------------------------------------------------------------------
// Memory distillation
// ---------------------------------------------------------------------------

const seededMemory = [
  '---',
  'created: 2026-01-05',
  'updated: 2026-01-05',
  'kind: preference',
  'summary: Use metric units',
  'source: hand-seeded',
  'lastConfirmed: 2026-01-05',
  'uses: 1',
  '---',
  '',
  'Use metric units in answers.',
  '',
].join('\n')

test('saveChat - memory ops apply, report their outcomes, and land in the context log', async () => {
  const timeDir = await tmpNotebook()
  const memoryDir = await makeTempDir({ prefix: 'sky-memory-' })
  await writeTextFile(path.join(memoryDir, 'metric-units.md'), seededMemory)

  let sawIndex: MemoryEntry[] | undefined
  let sawTranscript: string | undefined
  const distilled: MemoryOp[] = [
    {
      op: 'create',
      kind: 'glossary',
      slug: 'big-deck',
      summary: 'The big deck means the Atlas overview deck',
      body: 'When Jane says "the big deck" she means the Atlas overview deck.',
    },
    { op: 'confirm', slug: 'never-written' },
    { op: 'propose', flow: 'decision', gist: 'Atlas launch date settled' },
  ]

  const report = await saveChat({
    turns: TURNS,
    contextLog: [],
    resume: null,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    memoryDir,
    enricher: stubEnricher({
      distillMemories: async (transcript, memories) => {
        sawTranscript = transcript
        sawIndex = memories
        return distilled
      },
    }),
  })

  assert({
    given: 'a distillation returning a create, a doomed confirm, and a proposal',
    should: 'report every outcome, applied and skipped alike',
    actual: report.memoryOps,
    expected: [
      {
        op: 'create',
        slug: 'big-deck',
        kind: 'glossary',
        summary: 'The big deck means the Atlas overview deck',
        outcome: 'applied',
      },
      { op: 'confirm', slug: 'never-written', summary: 'never-written', outcome: 'skipped', reason: 'no such memory' },
      { op: 'propose', summary: 'Atlas launch date settled → decision', outcome: 'applied' },
    ],
  })

  assert({
    given: 'the distiller inputs',
    should: 'carry the current memory index and the packed conversation',
    actual: {
      slugs: (sawIndex ?? []).map((m) => m.slug),
      transcriptHasChat: Boolean(sawTranscript?.includes('Atlas launch')),
    },
    expected: { slugs: ['metric-units'], transcriptHasChat: true },
  })

  const written = await readTextFile(path.join(memoryDir, 'big-deck.md'))
  assert({
    given: 'the created memory file',
    should: 'stamp the save day and point source at the saved chat',
    actual: {
      lastConfirmed: written.includes('lastConfirmed: 2026-01-27'),
      source: written.includes(`source: ${path.relative(path.dirname(timeDir), report.path)}`),
    },
    expected: { lastConfirmed: true, source: true },
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'the saved transcript',
    should: 'record the memory outcomes as a final context-log entry',
    actual: doc.contextLog,
    expected: [{ turn: 0, queries: [], memory: report.memoryOps }],
  })
})

test('saveChat - the memory log entry appends without tripping the resume write-back gate', async () => {
  const timeDir = await tmpNotebook()
  const memoryDir = await makeTempDir({ prefix: 'sky-memory-' })
  const priorLog: ContextTurnLog[] = [{ turn: 1, queries: ['{ chats { path } }'] }]

  const first = await saveChat({
    turns: TURNS,
    contextLog: priorLog,
    resume: null,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    provider: 'claude',
    model: 'claude-opus-4-6',
    enricher: stubEnricher(),
  })

  const resume = await loadResumeSession(first.path)
  const continued = [
    ...TURNS,
    msg('user', 'Remember: the announcement outline is still in progress.', '2026-01-28 08:12'),
    msg('assistant', 'Noted.', '2026-01-28 08:13'),
  ]

  const report = await saveChat({
    turns: continued,
    contextLog: [...(resume?.state.contextLog ?? [])],
    resume,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: new PlainDateTime('2026-01-28 08:20'),
    provider: 'claude',
    model: 'claude-opus-4-6',
    memoryDir,
    enricher: stubEnricher({
      distillMemories: async () => [
        {
          op: 'create',
          kind: 'thread',
          slug: 'announcement-outline',
          summary: 'Announcement outline in progress',
          body: 'Jane is mid-draft on the Atlas announcement outline.',
        },
      ],
    }),
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'a resumed save that applied memory ops',
    should: 'write back unrefused, carried entries intact, memory as a new final entry',
    actual: {
      aborted: report.aborted,
      firstEntry: doc.contextLog[0],
      finalEntry: { turn: doc.contextLog.at(-1)?.turn, memory: doc.contextLog.at(-1)?.memory?.length },
      entries: doc.contextLog.length,
    },
    expected: {
      aborted: undefined,
      firstEntry: priorLog[0],
      finalEntry: { turn: 1, memory: 1 },
      entries: 2,
    },
  })
})
