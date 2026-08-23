import * as path from 'node:path'
import { exists, makeTempDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
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
