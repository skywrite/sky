import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { exists, makeTempDir, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import type { MemoryEntry } from '#shared/models/Memory/mod.ts'
import type { MemoryOp } from '#shared/models/Memory/write.ts'
import { dayDir, dayFile, readDay } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ContextTurnLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { setUserSpeakerLabel } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { loadResumeSession } from './mod.ts'
import { chatFilename, type EnrichSubject, type SaveEnricher, saveChat } from './save.ts'

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
  // Every save in this file that passes no memoryDir/peopleDirs must never distill.
  distillMemories: () => Promise.reject(new Error('distillMemories must not be called')),
  distillPersonFacts: () => Promise.reject(new Error('distillPersonFacts must not be called')),
  writeSummary: () => Promise.reject(new Error('writeSummary must not be called')),
  chooseDayCategory: () => Promise.reject(new Error('chooseDayCategory must not be called')),
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
    should: 'reparse to the frontmatter and conversation it was given, with no model in the header',
    actual: {
      created: doc.yaml['created'],
      updated: doc.yaml['updated'],
      turns: doc.yaml['turns'],
      namesAModel: 'model' in doc.yaml || 'provider' in doc.yaml,
      summary: doc.summary,
      conversation: doc.conversation.map((m) => m.content),
    },
    expected: {
      created: '2026-01-27',
      updated: '2026-01-27',
      turns: 1,
      namesAModel: false,
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

test('saveChat - referenced notebook records join entity and artifact relationships', async () => {
  const meeting = '2026-01-23/actions/meetings/10-00_Atlas-Review'
  const turns = [msg('user', `${'Some background. '.repeat(800)}About my meeting with Jane…`, '2026-01-27 09:30')]
  let received: unknown
  const { report } = await saveNew({
    turns,
    autoRel: true,
    contextLog: [{ turn: 1, queries: [], universe: [{ path: `${meeting}.md`, tokens: 200 }] }],
    externalFiles: new Map([['https://docs.example.com/brief', 'Brief']]),
    enricher: stubEnricher({
      chooseRel: async () => ['projects/Atlas'],
      chooseDocumentRel: async (input) => {
        received = { turns: input.turns, contextPaths: input.contextPaths, today: input.today }
        return [meeting]
      },
    }),
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'a notebook reference late in a long message',
    should: 'resolve against the complete conversation and its known paths',
    actual: received,
    expected: { turns, contextPaths: [`${meeting}.md`], today: '2026-01-27' },
  })
  assert({
    given: 'a chat discussing a meeting, an entity, and an external artifact',
    should: 'save the meeting ref without its extension alongside the other relationships',
    actual: { rel: [...doc.rel], reported: report.autoRel },
    expected: {
      rel: ['projects/Atlas', '[Brief](https://docs.example.com/brief)', meeting],
      reported: ['projects/Atlas', meeting],
    },
  })
})

test('saveChat - a resume adds newly referenced documents despite existing rel', async () => {
  const meeting = '2026-01-23/actions/meetings/10-00_Atlas-Review'
  const later = '2026-01-26/actions/notes/Atlas-Budget'
  const { report: first, timeDir } = await saveNew({
    autoRel: true,
    enricher: stubEnricher({ chooseRel: async () => ['projects/Atlas', meeting.slice(8)] }),
  })
  const resume = await loadResumeSession(first.path)
  const report = await saveChat({
    turns: [...TURNS, msg('user', 'Compare the meeting with the budget note.', '2026-01-27 10:30')],
    contextLog: [],
    resume,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    autoRel: true,
    enricher: {
      ...neverCalled,
      chooseDocumentRel: async (input) => {
        assert({
          given: 'a resumed chat',
          should: 'exclude its own saved file from candidates',
          actual: input.excludePaths,
          expected: [first.path],
        })
        return [meeting, later]
      },
    },
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'an existing project rel and a hand-written short meeting ref',
    should: 'keep those entries and append the new note once',
    actual: { rel: [...doc.rel], aborted: report.aborted },
    expected: { rel: ['projects/Atlas', meeting.slice(8), later], aborted: undefined },
  })
})

test('saveChat - disabling auto-rel also disables conversational document lookup', async () => {
  let called = false
  await saveNew({
    autoRel: false,
    enricher: stubEnricher({
      chooseDocumentRel: async () => {
        called = true
        return []
      },
    }),
  })
  assert({
    given: 'a save with auto-rel disabled',
    should: 'perform no document-reference lookup',
    actual: called,
    expected: false,
  })
})

test('saveChat - new place subjects append on resume and respect disabled auto-rel', async () => {
  const { report: first, timeDir } = await saveNew({
    autoRel: true,
    enricher: stubEnricher({ chooseRel: async () => ['projects/Atlas'] }),
  })
  const resume = await loadResumeSession(first.path)
  let calls = 0
  const save = (autoRel: boolean) =>
    saveChat({
      turns: [...TURNS, msg('user', 'What about visiting France?', '2026-01-27 10:30')],
      contextLog: [],
      resume,
      timeDir,
      day: DAY,
      startTime: START,
      endTime: END,
      autoRel,
      enricher: {
        ...neverCalled,
        choosePlaceRel: async (subject) => {
          calls++
          assert({
            given: 'a resumed chat with an existing project link',
            should: 'pass its existing relationships to place deduplication',
            actual: subject.existingRel,
            expected: ['projects/Atlas'],
          })
          return ['places/FR']
        },
      },
    })
  await save(false)
  assert({ given: 'automatic relationships disabled', should: 'skip place extraction too', actual: calls, expected: 0 })
  const report = await save(true)
  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'a newly discussed place in a chat already linked to a project',
    should: 'append its canonical reference without adding a physical location attribute',
    actual: [[...doc.rel], doc.yaml['location'], calls],
    expected: [['projects/Atlas', 'places/FR'], undefined, 1],
  })
})

test('saveChat - files read into the session are recorded as attachments, and a resume keeps them', async () => {
  const { report: first } = await saveNew({ attachments: [{ file: '2026-01-27_Chat_Atlas-MSA.pdf' }] })

  const firstDoc = ChatDocument.fromMarkdown(await readTextFile(first.path))
  assert({
    given: 'a session whose read_file tool copied a document into the day attachments',
    should: 'list it under attachments:',
    actual: firstDoc.attachments,
    expected: [{ file: '2026-01-27_Chat_Atlas-MSA.pdf' }],
  })

  const resume = await loadResumeSession(first.path)
  const report = await saveChat({
    turns: [
      ...TURNS,
      msg('user', 'And the term sheet?', '2026-01-28 08:12'),
      msg('assistant', 'Two years, auto-renewing.', '2026-01-28 08:13'),
    ],
    contextLog: [],
    resume,
    timeDir: 'unused-on-resume',
    day: DAY,
    startTime: START,
    endTime: new PlainDateTime('2026-01-28 08:20'),
    attachments: [{ file: '2026-01-28_Chat_Atlas-Term-Sheet.pdf' }, { file: '2026-01-27_Chat_Atlas-MSA.pdf' }],
    enricher: neverCalled,
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'the resumed session read a second document and re-read the first',
    should: 'keep the earlier attachment first and add the new one once',
    actual: doc.attachments,
    expected: [{ file: '2026-01-27_Chat_Atlas-MSA.pdf' }, { file: '2026-01-28_Chat_Atlas-Term-Sheet.pdf' }],
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

test('saveChat - a chat on a day with no day file creates the day and logs it there', async () => {
  const { timeDir, report } = await saveNew({ logToDay: { category: 'Professional', stated: true } })
  const day = await readDay(DAY, timeDir)

  assert({
    given: 'a new chat asked to log to a day that has no day file',
    should: 'create the day, unstarted, with the chat logged',
    actual: {
      dayLog: report.dayLog,
      started: day.started,
      items: day.lists.find((list) => list.title === 'Professional Complete')?.items,
    },
    expected: {
      dayLog: { logged: true, category: 'Professional' },
      started: undefined,
      items: ['09:30 > AI Chat -> [Atlas Launch Planning](actions/ai-chats/09-30_Atlas-Launch-Planning.md)'],
    },
  })
})

test('saveChat - a new chat is logged in the section its subject calls for, unless the person chose one', async () => {
  const asked: EnrichSubject[] = []
  const personal = stubEnricher({
    chooseDayCategory: async (subject) => {
      asked.push(subject)
      return 'Personal'
    },
  })
  const chosen = await saveNew({ logToDay: { category: 'Professional' }, enricher: personal })
  const resumed = await saveChat({
    turns: [...TURNS, msg('user', 'One more thing.', '2026-01-27 10:00')],
    contextLog: [],
    resume: await loadResumeSession(chosen.report.path),
    timeDir: chosen.timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    logToDay: { category: 'Professional' },
    enricher: personal,
  })
  const stated = await saveNew({ logToDay: { category: 'Professional', stated: true }, enricher: personal })
  const abstained = await saveNew({
    logToDay: { category: 'Professional' },
    enricher: stubEnricher({ chooseDayCategory: async () => undefined }),
  })
  const unavailable = await saveNew({
    logToDay: { category: 'Professional' },
    enricher: stubEnricher({
      chooseDayCategory: async () => {
        throw new Error('Synthetic outage')
      },
    }),
  })
  const withoutChooser = await saveNew({ logToDay: { category: 'Professional' } })
  const professional = await saveNew({
    logToDay: { category: 'Personal' },
    enricher: stubEnricher({ chooseDayCategory: async () => 'Professional' }),
  })
  const listed = async (timeDir: string, title: string) =>
    (await readDay(DAY, timeDir)).lists.find((list) => list.title === title)?.items ?? []

  assert({
    given: 'a personal chat saved then resumed, a manual choice, unavailable choices, and a clear work chat',
    should: 'classify new chats only, honor manual choices, and default to Personal when no judgment is available',
    actual: {
      dayLogs: [
        chosen.report.dayLog,
        resumed.dayLog,
        stated.report.dayLog,
        abstained.report.dayLog,
        unavailable.report.dayLog,
        withoutChooser.report.dayLog,
        professional.report.dayLog,
      ],
      asked: asked.map((subject) => subject.body.includes('Atlas launch')),
      personal: await listed(chosen.timeDir, 'Personal Complete'),
      professional: await listed(chosen.timeDir, 'Professional Complete'),
      chatCategory: ChatDocument.fromMarkdown(await readTextFile(chosen.report.path)).yaml['category'],
      dayCategory: (await readDay(DAY, chosen.timeDir)).yaml['category'],
    },
    expected: {
      dayLogs: [
        { logged: true, category: 'Personal' },
        { logged: false, reason: 'resume' },
        { logged: true, category: 'Professional' },
        { logged: true, category: 'Personal' },
        { logged: true, category: 'Personal' },
        { logged: true, category: 'Personal' },
        { logged: true, category: 'Professional' },
      ],
      asked: [true],
      personal: ['09:30 > AI Chat -> [Atlas Launch Planning](actions/ai-chats/09-30_Atlas-Launch-Planning.md)'],
      professional: [],
      chatCategory: undefined,
      dayCategory: undefined,
    },
  })
})

test('saveChat - day categorization sees personal context beyond the packed transcript', async () => {
  const turns = [
    msg('user', 'Help me write this code. ' + 'A technical detail. '.repeat(150) + ' This is a hobby with my sister.'),
    msg('assistant', 'Here is a prototype. ' + 'Implementation detail. '.repeat(100) + ' Have fun together.'),
  ]
  let body = ''
  const { report } = await saveNew({
    turns,
    logToDay: { category: 'Professional' },
    enricher: stubEnricher({
      chooseDayCategory: async (subject) => {
        body = subject.body
        return 'Personal'
      },
    }),
  })
  assert({
    given: 'a technical conversation with personal context late in long turns',
    should: 'keep the complete evidence for the day classifier',
    actual: [body.includes(turns[0].content), body.includes(turns[1].content), report.dayLog],
    expected: [true, true, { logged: true, category: 'Personal' }],
  })
})

test('saveChat - resuming preserves a manually moved day entry exactly', async () => {
  const { timeDir, report: first } = await saveNew({
    logToDay: { category: 'Professional' },
    enricher: stubEnricher({ chooseDayCategory: async () => 'Personal' }),
  })
  const dayPath = path.join(timeDir, dayFile(DAY))
  const manual =
    '# **2026-01-27 - Tue**\n\n## Personal Complete\n- 08:00 > Morning walk\n\n' +
    '## Professional Complete\n' +
    '- 09:30 > AI Chat -> [Atlas Launch Planning](actions/ai-chats/09-30_Atlas-Launch-Planning.md)\n'
  await writeTextFile(dayPath, manual)
  const resumed = await saveNew({
    timeDir,
    turns: [...TURNS, msg('user', 'One more thing.')],
    resume: await loadResumeSession(first.path),
    logToDay: { category: 'Personal' },
    enricher: neverCalled,
  })
  assert({
    given: 'a chat manually moved to Professional after it was first saved under Personal',
    should: 'leave the day bytes alone on resume without another classification or entry',
    actual: [resumed.report.dayLog, await readTextFile(dayPath)],
    expected: [{ logged: false, reason: 'resume' }, manual],
  })
})

test('saveChat - without a day entry there is no categorization', async () => {
  let asked = false
  const { timeDir, report } = await saveNew({
    logToDay: null,
    enricher: stubEnricher({
      chooseDayCategory: async () => {
        asked = true
        return 'Personal'
      },
    }),
  })
  assert({
    given: 'a chat saved without day logging',
    should: 'save the chat without asking for a category or creating a day file',
    actual: [asked, report.dayLog, await exists(path.join(timeDir, dayFile(DAY)))],
    expected: [false, undefined, false],
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

// ---------------------------------------------------------------------------
// Person-profile distillation
// ---------------------------------------------------------------------------

const seededProfile = [
  '---',
  'name: Alex Rivera',
  'location:',
  'created: 2026-01-05',
  'updated: 2026-01-05',
  'met: 2026-01-05',
  '---',
  '',
  '# Alex Rivera',
  '',
  '## Background',
  '',
  'Met through the Atlas vendor search.',
  '',
].join('\n')

/**
 * In-memory document transport standing in for the notebook service:
 * version bumps per accepted save, stale versions conflict — the
 * saveDocument mutation's contract.
 */
function memoryPersonIO(files: Record<string, string>) {
  const store = new Map(Object.entries(files).map(([p, content]) => [p, { content, version: 1 }]))
  return {
    read: async (path: string) => {
      const entry = store.get(path)
      return entry ? { path, content: entry.content, version: entry.version } : null
    },
    save: async (path: string, content: string, version: number) => {
      const entry = store.get(path)
      if (!entry) throw new Error(`Document not found: ${path}`)
      if (entry.version !== version) return { saved: false as const, current: { path, ...entry } }
      store.set(path, { content, version: version + 1 })
      return { saved: true as const }
    },
    content: (path: string) => store.get(path)?.content ?? '',
  }
}

test('saveChat - person facts curate the profile, report outcomes, and land in the context log', async () => {
  const timeDir = await tmpNotebook()
  const profilePath = 'people/2026/al/Alex-Rivera.md'
  const personIO = memoryPersonIO({ [profilePath]: seededProfile })

  let sawTranscript: string | undefined
  const report = await saveChat({
    turns: [
      msg('user', 'Earlier discussion. '.repeat(3000) + 'Alex Rivera moved to Lisbon.', '2026-01-27 09:30'),
      msg('assistant', 'Alex Rivera confirmed the vendor timeline and moved to Lisbon.', '2026-01-27 09:31'),
    ],
    contextLog: [],
    resume: null,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    people: true,
    personIO,
    enricher: stubEnricher({
      distillPersonFacts: async (transcript) => {
        sawTranscript = transcript
        return {
          subjects: [{ name: 'Alex Rivera', path: profilePath }],
          facts: [
            {
              name: 'Alex Rivera',
              ops: [
                { op: 'overview', lines: ['Vendor lead on the Atlas rollout.', 'Based in Lisbon.'] },
                { op: 'field', field: 'location', value: 'Lisbon' },
              ],
            },
          ],
          unlisted: [{ name: 'Sam Note', gist: 'introduced the vendor' }],
        }
      },
    }),
  })

  assert({
    given: 'the distiller inputs',
    should: 'carry the full conversation, including a fact after 48k characters and its source time',
    actual: {
      fact: sawTranscript?.includes('Alex Rivera moved to Lisbon.'),
      sourceTime: sawTranscript?.includes('User [2026-01-27 09:30]:'),
      assistantContext: sawTranscript?.includes('Alex Rivera confirmed the vendor timeline'),
      fullLength: (sawTranscript?.length ?? 0) > 48_000,
    },
    expected: { fact: true, sourceTime: true, assistantContext: true, fullLength: true },
  })

  assert({
    given: 'a distillation with an overview, a field fill, and an unlisted person',
    should: 'report every outcome, applied and skipped alike',
    actual: report.personOps,
    expected: [
      {
        op: 'overview',
        person: 'Alex Rivera',
        summary: 'Vendor lead on the Atlas rollout. · Based in Lisbon.',
        outcome: 'applied',
      },
      { op: 'field', person: 'Alex Rivera', summary: 'location: Lisbon', outcome: 'applied' },
      {
        op: 'unknown',
        person: 'Sam Note',
        summary: 'introduced the vendor',
        outcome: 'skipped',
        reason: 'no profile (sky person:new "Sam Note")',
      },
    ],
  })

  const profile = personIO.content(profilePath)
  assert({
    given: 'the curated profile',
    should: 'carry the new Overview first, the filled location, the bumped updated, and the old Background',
    actual: {
      overviewFirst: profile.indexOf('## Overview') < profile.indexOf('## Background'),
      overview: profile.includes('- Vendor lead on the Atlas rollout.\n- Based in Lisbon.'),
      location: profile.includes('location: Lisbon'),
      updated: profile.includes('updated: 2026-01-27'),
      background: profile.includes('Met through the Atlas vendor search.'),
    },
    expected: { overviewFirst: true, overview: true, location: true, updated: true, background: true },
  })

  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'the saved transcript',
    should: 'record the profile outcomes as a final context-log entry',
    actual: doc.contextLog,
    expected: [{ turn: 0, queries: [], people: report.personOps }],
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

test('saveChat - a body ending in an open fence is sealed before the context log', async () => {
  const turns: ConversationMessage[] = [
    msg('user', 'Show me the helper?', '2026-01-27 09:30'),
    msg('assistant', 'Sure:\n\n```ts\nconst x = 1\n// reply truncated mid-block', '2026-01-27 09:31'),
  ]
  const contextLog: ContextTurnLog[] = [{ turn: 1, queries: [] }]
  const { report } = await saveNew({ turns, contextLog })

  const markdown = await readTextFile(report.path)
  const doc = ChatDocument.fromMarkdown(markdown)
  const stripped = doc.stripHtmlComments().toMarkdown()

  assert({
    given: 'a reply truncated inside an open code fence, saved with a context log',
    should: 'seal the fence so the log still parses, strips, and stays out of the conversation',
    actual: {
      logStrips: !stripped.includes('CONTEXT-LOG'),
      logParses: doc.contextLog.length,
      truncatedKept: stripped.includes('reply truncated mid-block'),
      sealJoinsBody: doc.conversation.at(-1)?.content.endsWith('```'),
    },
    expected: { logStrips: true, logParses: 1, truncatedKept: true, sealJoinsBody: true },
  })
})

test('saveChat - a resumed sealed chat does not grow a second seal', async () => {
  const turns: ConversationMessage[] = [
    msg('user', 'Show me the helper?', '2026-01-27 09:30'),
    msg('assistant', 'Sure:\n\n```ts\nconst x = 1\n// reply truncated mid-block', '2026-01-27 09:31'),
  ]
  const { timeDir, report: first } = await saveNew({ turns, contextLog: [{ turn: 1, queries: [] }] })

  const resume = await loadResumeSession(first.path)
  const report = await saveChat({
    turns: [
      ...resume.state.conversation,
      msg('user', 'Thanks.', '2026-01-27 09:40'),
      msg('assistant', 'Anytime.', '2026-01-27 09:41'),
    ],
    contextLog: [...resume.state.contextLog, { turn: 2, queries: [] }],
    resume,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    enricher: stubEnricher(),
  })

  const markdown = await readTextFile(report.path)
  const fenceLines = markdown.split('\n').filter((line) => line.trim() === '```')

  assert({
    given: 'a resume of a chat whose truncated fence was sealed on the first save',
    should: 'carry the seal as conversation text and add no second one',
    actual: { aborted: report.aborted, bareFenceLines: fenceLines.length },
    expected: { aborted: undefined, bareFenceLines: 1 },
  })
})

test('saveChat - balanced bodies save without a seal', async () => {
  const turns: ConversationMessage[] = [
    msg('user', 'Show me the helper?', '2026-01-27 09:30'),
    msg('assistant', 'Sure:\n\n```ts\nconst x = 1\n```\n\nDone.', '2026-01-27 09:31'),
  ]
  const { report } = await saveNew({ turns, contextLog: [{ turn: 1, queries: [] }] })
  const markdown = await readTextFile(report.path)
  const fenceLines = markdown.split('\n').filter((line) => line.trim() === '```')

  assert({
    given: 'a chat whose fences all close',
    should: 'write exactly the fence lines the conversation contains',
    actual: fenceLines.length,
    expected: 1,
  })
})

test('saveChat - a branch files beside its parent, holding only its own turns and its parent key', async () => {
  const timeDir = await tmpNotebook()
  const parentChat = `time/${dayDir(DAY)}/actions/ai-chats/09-00_Help-with-the-week.md`
  // The parent is a file already, as a branch's parent is by the time the branch saves.
  const parentPath = path.join(path.dirname(timeDir), parentChat)
  await mkdir(path.dirname(parentPath), { recursive: true })
  await writeTextFile(parentPath, '---\nsummary: Help with the week\nturns: 1\n---\n\n# Help with the week\n')
  const report = await saveChat({
    turns: [
      msg('user', 'I need help with the week.', '2026-01-27 09:00'),
      msg('assistant', 'Finances, board prep, hiring.', '2026-01-27 09:01'),
      msg('user', 'Let us do the board prep instead.', '2026-01-27 09:30'),
      msg('assistant', 'Three things by Thursday.', '2026-01-27 09:31'),
    ],
    contextLog: [
      { turn: 1, queries: ['week'], universe: [{ path: 'goals/2026.md', tokens: 10 }] },
      { turn: 2, queries: ['board'], diff: [{ path: 'projects/Board/Pack.md', tokens: 40 }] },
    ],
    resume: null,
    parent: { chat: parentChat, turn: 1 },
    inherited: 2,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    enricher: stubEnricher({
      summarize: async (transcript) => (transcript.includes('week.') ? 'WRONG' : 'Board Prep Instead'),
    }),
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))

  assert({
    given: 'a branch left after turn 1 with one exchange of its own',
    should: 'file in the folder beside the parent, keep its own exchange and log entry only, and record the parent',
    actual: {
      path: path.relative(path.dirname(timeDir), report.path),
      exchanges: report.exchanges,
      turns: doc.turnCount,
      roles: doc.conversation.map((m) => m.role),
      logTurns: doc.contextLog.map((e) => e.turn),
      parent: doc.parent,
      summary: doc.summary,
    },
    expected: {
      path: `time/${dayDir(DAY)}/actions/ai-chats/09-00_Help-with-the-week/09-30_Board-Prep-Instead.md`,
      exchanges: 1,
      turns: 1,
      roles: ['user', 'assistant'],
      logTurns: [2],
      parent: { chat: parentChat, turn: 1 },
      summary: 'Board Prep Instead',
    },
  })
})

test('saveChat - a pinned title names the file over the titler', async () => {
  const { report } = await saveNew({ title: 'Help with the week', enricher: neverCalled })
  assert({
    given: 'a save with a pinned title and an enricher that must not be asked',
    should: 'file under the pinned title',
    actual: { name: path.basename(report.path), summary: report.summary },
    expected: { name: '09-30_Help-with-the-week.md', summary: 'Help with the week' },
  })
})

test('saveChat - a resumed branch writes back its own turns only, with its parent key kept', async () => {
  // File a parent, then a branch beside it; resume the branch, add an exchange, save again.
  const { timeDir, report: parentReport } = await saveNew({
    enricher: stubEnricher({ summarize: async () => 'Help with the week' }),
  })
  const parentChat = path.relative(path.dirname(timeDir), parentReport.path)
  const branch = await saveChat({
    turns: [
      ...TURNS,
      msg('user', 'Board prep instead.', '2026-01-27 09:40'),
      msg('assistant', 'Three things.', '2026-01-27 09:41'),
    ],
    contextLog: [{ turn: 2, queries: ['board'] }],
    resume: null,
    parent: { chat: parentChat, turn: 1 },
    inherited: 2,
    timeDir,
    day: DAY,
    startTime: new PlainDateTime('2026-01-27 09:40'),
    endTime: END,
    enricher: stubEnricher({ summarize: async () => 'Board Prep Instead' }),
  })
  const resume = await loadResumeSession(branch.path, { baseDir: path.dirname(timeDir) })
  const again = await saveChat({
    turns: [
      ...resume.state.conversation,
      msg('user', 'And the hiring update?', '2026-01-27 09:50'),
      msg('assistant', 'Two paragraphs.', '2026-01-27 09:51'),
    ],
    contextLog: [...resume.state.contextLog, { turn: 3, queries: ['board', 'hiring'] }],
    resume,
    timeDir,
    day: DAY,
    startTime: new PlainDateTime('2026-01-27 09:40'),
    endTime: END,
    enricher: neverCalled,
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(again.path))

  assert({
    given: 'a branch resumed as the whole thread and saved with one more exchange',
    should: 'write back to the same file with two own exchanges, the parent key, and the log from its own turns on',
    actual: {
      samePath: again.path === branch.path,
      aborted: again.aborted ?? null,
      roles: doc.conversation.map((m) => m.role),
      logTurns: doc.contextLog.map((e) => e.turn),
      parent: doc.parent,
      resumedInherited: resume.inherited,
    },
    expected: {
      samePath: true,
      aborted: null,
      roles: ['user', 'assistant', 'user', 'assistant'],
      logTurns: [2, 3],
      parent: { chat: parentChat, turn: 1 },
      resumedInherited: 2,
    },
  })
})

test('saveChat - a branch whose parent was never kept files whole, as a chat of its own', async () => {
  const timeDir = await tmpNotebook()
  const report = await saveChat({
    turns: [
      msg('user', 'I need help with the week.', '2026-01-27 09:00'),
      msg('assistant', 'Finances, board prep, hiring.', '2026-01-27 09:01'),
      msg('user', 'Let us do the board prep instead.', '2026-01-27 09:30'),
      msg('assistant', 'Three things by Thursday.', '2026-01-27 09:31'),
    ],
    contextLog: [
      { turn: 1, queries: ['week'] },
      { turn: 2, queries: ['board'] },
    ],
    resume: null,
    parent: { chat: `time/${dayDir(DAY)}/actions/ai-chats/09-00_Never-filed.md`, turn: 1 },
    inherited: 2,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    enricher: stubEnricher({ summarize: async () => 'Board Prep Instead' }),
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))

  assert({
    given: 'a branch saved after its parent was discarded without ever being filed',
    should: 'keep every turn, file under the day like any chat, and carry no parent key',
    actual: {
      path: path.relative(path.dirname(timeDir), report.path),
      roles: doc.conversation.map((m) => m.role),
      logTurns: doc.contextLog.map((e) => e.turn),
      parent: doc.parent,
      exchanges: report.exchanges,
    },
    expected: {
      path: `${path.basename(timeDir)}/${dayDir(DAY)}/actions/ai-chats/09-30_Board-Prep-Instead.md`,
      roles: ['user', 'assistant', 'user', 'assistant'],
      logTurns: [1, 2],
      parent: null,
      exchanges: 2,
    },
  })
})

test('saveChat - rel reads the whole conversation, not the packed transcript', async () => {
  const late = 'Acme Labs'
  let relBody = ''
  let tagBody = ''
  await saveNew({
    autoTag: true,
    autoRel: true,
    turns: [
      msg('user', 'What should I focus on for the Atlas launch?', '2026-01-27 09:30'),
      msg(
        'assistant',
        `${'The demo script and the pricing page copy. '.repeat(60)}The payments partner is ${late}.`,
        '2026-01-27 09:31',
      ),
    ],
    enricher: stubEnricher({
      chooseTags: async (subject) => {
        tagBody = subject.body
        return undefined
      },
      chooseRel: async (subject) => {
        relBody = subject.body
        return undefined
      },
    }),
  })
  assert({
    given: 'an assistant turn longer than the classifier clip, naming an organization at its end',
    should: 'hand the rel chooser the whole conversation while the tag classifier keeps its packed transcript',
    actual: {
      relSeesIt: relBody.includes(late),
      relStamped: relBody.includes('[2026-01-27 09:31]'),
      tagsClipped: !tagBody.includes(late),
    },
    expected: { relSeesIt: true, relStamped: true, tagsClipped: true },
  })
})

test('saveChat - rel hears who was on the records the chat read', async () => {
  const notebook = await tmpNotebook()
  const record = async (file: string, frontmatter: string) => {
    await mkdir(path.dirname(path.join(notebook, file)), { recursive: true })
    await writeTextFile(path.join(notebook, file), `---\n${frontmatter}\n---\n\n# Record\n`)
  }
  const meeting = 'time/2026/W04/01-23/actions/meetings/18-00_In-Person_Michael-Vance_Review.md'
  const email = 'time/2026/W04/01-24/actions/messages/09-00_email_Sam-Rivera-to-Jane-Doe_Atlas.md'
  const cut = 'time/2026/W04/01-22/actions/meetings/09-00_Zoom_Michael-Torres_Standup.md'
  const profile = 'people/2024/mi/Michael-Torres.md'
  await record(meeting, 'who: Michael Vance, Jane Doe')
  await record(email, 'from: Sam Rivera\nto:\n  - Jane Doe\n  - Alex Kim')
  await record(cut, 'who: Michael Torres')
  await record(profile, 'name:\n  - Michael Torres')
  let contextNames: string[] | undefined
  await saveNew({
    timeDir: path.join(notebook, 'time'),
    autoRel: true,
    contextLog: [
      {
        turn: 1,
        queries: [],
        universe: [
          { path: meeting, tokens: 200 },
          { path: cut, tokens: 200, cut: 'floor' },
          { path: profile, tokens: 40 },
          { path: 'time/2026/W04/01-21/actions/meetings/10-00_Zoom_Deleted.md', tokens: 10 },
        ],
      },
      { turn: 2, queries: [], added: [{ path: email, tokens: 100 }] },
    ],
    enricher: stubEnricher({
      chooseRel: async (subject) => {
        contextNames = subject.contextNames
        return undefined
      },
    }),
  })
  assert({
    given:
      'a meeting and a later email the chat read, a meeting its context cut, a profile it read, and a deleted record',
    should: 'hand the rel chooser the parties of the records it read, each once',
    actual: contextNames,
    expected: ['Michael Vance', 'Jane Doe', 'Sam Rivera', 'Alex Kim'],
  })
})

test('saveChat - profile facts hear the full names on the records the chat read, as rel does', async () => {
  const notebook = await tmpNotebook()
  const meeting = 'time/2026/W04/01-23/actions/meetings/18-00_In-Person_Michael-Vance_Dinner.md'
  await mkdir(path.dirname(path.join(notebook, meeting)), { recursive: true })
  await writeTextFile(path.join(notebook, meeting), '---\nwho: Michael Vance, Sam\n---\n\n# Dinner\n')
  const save = async (autoRel: boolean) => {
    const heard: { rel?: string[]; people?: string[] } = {}
    await saveNew({
      timeDir: path.join(notebook, 'time'),
      autoRel,
      people: true,
      contextLog: [{ turn: 1, queries: [], universe: [{ path: meeting, tokens: 200 }] }],
      enricher: stubEnricher({
        chooseRel: async (subject) => {
          heard.rel = subject.contextNames
          return undefined
        },
        distillPersonFacts: async (_transcript, _today, contextNames) => {
          heard.people = contextNames
          return undefined
        },
      }),
    })
    return heard
  }
  const withRel = await save(true)
  const withoutRel = await save(false)

  assert({
    given: 'a meeting the chat read naming one attendee in full and another by first name only',
    should: 'hand profile facts the same full names as rel, and the bare first name to neither',
    actual: withRel,
    expected: { rel: ['Michael Vance'], people: ['Michael Vance'] },
  })

  assert({
    given: 'the same chat saved without choosing rel',
    should: 'still hand profile facts the names',
    actual: withoutRel,
    expected: { people: ['Michael Vance'] },
  })
})

test('saveChat - documents the session created join rel as facts', async () => {
  const timeDir = path.join(await tmpNotebook(), 'time')
  const note = path.join(timeDir, '2026/W05/01-27/actions/notes/09-45_Launch-memo.md')
  const { report } = await saveNew({
    timeDir,
    autoRel: false,
    createdPaths: [note, '/elsewhere/not-in-the-notebook.md'],
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(report.path))
  assert({
    given: 'a note the session wrote under the notebook time tree, and a path outside it',
    should: 'record the note by time ref without any chooser, and ignore the outsider',
    actual: [...doc.rel],
    expected: ['2026-01-27/actions/notes/09-45_Launch-memo'],
  })
})

test('saveChat - the summary goes between the title and the conversation, under its writer', async () => {
  let asked: { turns: number; earlier: number } | undefined
  const { report } = await saveNew({
    writeSummary: true,
    enricher: stubEnricher({
      writeSummary: async (input) => {
        asked = { turns: input.turns.length, earlier: input.earlier.length }
        return { by: 'Opus 5.5, High', text: 'Jane asked what the Atlas launch needs. Sky named the demo script.' }
      },
    }),
  })
  const markdown = await readTextFile(report.path)
  assert({
    given: 'a new chat saved with a summary',
    should: 'hand the writer the whole conversation and write the section above the messages',
    actual: { asked, head: markdown.slice(markdown.indexOf('# '), markdown.indexOf('### ')) },
    expected: {
      asked: { turns: 2, earlier: 0 },
      head: [
        '# Atlas Launch Planning',
        '',
        '## Summary (Opus 5.5, High)',
        '',
        'Jane asked what the Atlas launch needs. Sky named the demo script.',
        '',
        '## Conversation',
        '',
        '',
      ].join('\n'),
    },
  })
})

test('saveChat - no summary unless the host asks for one', async () => {
  let called = false
  const { report } = await saveNew({
    enricher: stubEnricher({
      writeSummary: async () => {
        called = true
        return { by: 'Opus 5.5, High', text: 'Unwanted.' }
      },
    }),
  })
  assert({
    given: 'a save without writeSummary',
    should: 'never call the writer and write no section',
    actual: { called, section: ChatDocument.fromMarkdown(await readTextFile(report.path)).summarySection },
    expected: { called: false, section: null },
  })
})

test('saveChat - a resume rewrites the summary for new turns and keeps it otherwise', async () => {
  const { report: first } = await saveNew({
    writeSummary: true,
    enricher: stubEnricher({ writeSummary: async () => ({ by: 'Opus 5.5, High', text: 'The first summary.' }) }),
  })
  const resave = async (turns: ConversationMessage[], writeSummary: SaveEnricher['writeSummary']) => {
    const report = await saveChat({
      turns,
      contextLog: [],
      resume: await loadResumeSession(first.path),
      timeDir: 'unused-on-resume',
      day: DAY,
      startTime: START,
      endTime: new PlainDateTime('2026-01-28 08:20'),
      writeSummary: true,
      enricher: { ...neverCalled, writeSummary },
    })
    return ChatDocument.fromMarkdown(await readTextFile(report.path)).summarySection?.text
  }
  const more = [
    ...TURNS,
    msg('user', 'Draft the announcement outline.', '2026-01-28 08:12'),
    msg('assistant', 'Intro, demo, pricing, call to action.', '2026-01-28 08:13'),
  ]
  const unchanged = await resave(TURNS, () => Promise.reject(new Error('no new turns, no new summary')))
  const abstained = await resave(more, async () => undefined)
  const rewritten = await resave(
    [...more, msg('user', 'Who signs off?', '2026-01-28 08:30'), msg('assistant', 'Jane does.', '2026-01-28 08:31')],
    async (input) => ({ by: 'Opus 5.5, High', text: `A summary of ${input.turns.length} messages.` }),
  )
  assert({
    given: 'a resume with no new turns, then new turns the writer declines, then new turns it summarizes',
    should: 'keep the file summary until a new one is written, then replace it',
    actual: [unchanged, abstained, rewritten],
    expected: ['The first summary.', 'The first summary.', 'A summary of 6 messages.'],
  })
})

test('saveChat - a branch summary covers its own turns and reads its opening as context', async () => {
  const timeDir = await tmpNotebook()
  const parentChat = `time/${dayDir(DAY)}/actions/ai-chats/09-00_Help-with-the-week.md`
  const parentPath = path.join(path.dirname(timeDir), parentChat)
  await mkdir(path.dirname(parentPath), { recursive: true })
  await writeTextFile(parentPath, '---\nsummary: Help with the week\nturns: 1\n---\n\n# Help with the week\n')
  let asked: { turns: string[]; earlier: string[] } | undefined
  await saveChat({
    turns: [
      msg('user', 'I need help with the week.', '2026-01-27 09:00'),
      msg('assistant', 'Finances, board prep, hiring.', '2026-01-27 09:01'),
      msg('user', 'Let us do the board prep instead.', '2026-01-27 09:30'),
      msg('assistant', 'Three things by Thursday.', '2026-01-27 09:31'),
    ],
    contextLog: [],
    resume: null,
    parent: { chat: parentChat, turn: 1 },
    inherited: 2,
    timeDir,
    day: DAY,
    startTime: START,
    endTime: END,
    writeSummary: true,
    enricher: stubEnricher({
      writeSummary: async (input) => {
        asked = { turns: input.turns.map((m) => m.content), earlier: input.earlier.map((m) => m.content) }
        return undefined
      },
    }),
  })
  assert({
    given: 'a branch left after turn 1 with one exchange of its own',
    should: 'summarize its own exchange, with the parent exchange as the earlier conversation',
    actual: asked,
    expected: {
      turns: ['Let us do the board prep instead.', 'Three things by Thursday.'],
      earlier: ['I need help with the week.', 'Finances, board prep, hiring.'],
    },
  })
})
