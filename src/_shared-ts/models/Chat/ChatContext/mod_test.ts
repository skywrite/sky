import * as path from 'node:path'
import { assert, test } from '#test'
import { readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { AIErrorEntry } from '#shared/ai/errorLog.ts'
import type { ContextTurnLog } from '../document/ContextLog/mod.ts'
import type { ResumeState } from '../document/resume.ts'
import ChatContext, { type ChatContextOptions, type ProducerResult } from './mod.ts'

// The fixture notebook is real files on disk — ChatContext reads and merges
// documents through the filesystem exactly as in production.
const BASE_DIR = path.join(import.meta.dirname!, 'fixtures', 'notebook')
const TODAY = new PlainDate('2026-01-27')

const abs = (rel: string) => path.join(BASE_DIR, rel)

const FIX = {
  day: abs('time/2026/01/26-01/01-27/day.md'),
  journal: abs('time/2026/01/19-25/01-20/journal/10_Morning_Reflection.md'),
  summary: abs('time/2026/01/19-25/01-20/summary.md'),
  meeting: abs('time/2026/01/19-25/01-20/actions/meetings/11-00_Atlas_Sync.md'),
  goal: abs('goals/2026.md'),
  decision: abs('decisions/2026-01_Atlas-Tooling.md'),
  roadmap: abs('projects/Atlas/Roadmap.md'),
  person: abs('people/Jane-Doe.md'),
  ownChat: abs('time/2026/01/26-01/01-27/actions/ai-chats/09-00_Prior-Session.md'),
}

async function fixtureDoc(absPath: string): Promise<{ doc: Document; path: string }> {
  return { doc: Document.fromMarkdown(await readTextFile(absPath)), path: absPath }
}

const ok = <T>(value: T): ProducerResult<T> => ({ ok: true, value })
const fail = (message: string): ProducerResult<never> => ({ ok: false, message })

/** Producers that a test overrides per scenario; defaults produce nothing. */
function makeContext(overrides: Partial<ChatContextOptions> = {}) {
  const errorEntries: AIErrorEntry[] = []
  const context = new ChatContext({
    today: TODAY,
    days: 7,
    baseDir: BASE_DIR,
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
    logError: (entry) => {
      errorEntries.push(entry)
      return Promise.resolve()
    },
    ...overrides,
  })
  return { context, errorEntries }
}

/** A service fetch fake keyed on the query's distinguishing substring. */
function fetchFake(sets: { today?: string[]; prev?: string[]; goals?: string[]; decisions?: string[] }) {
  return async (query: string): Promise<Array<{ doc: Document; path: string }>> => {
    let paths: string[] = []
    if (query.includes('dateGte')) paths = sets.prev ?? []
    else if (query.includes('goals')) paths = sets.goals ?? []
    else if (query.includes('decisions')) paths = sets.decisions ?? []
    else paths = sets.today ?? []
    return await Promise.all(paths.map(fixtureDoc))
  }
}

// ---------------------------------------------------------------------------
// seedBaseline
// ---------------------------------------------------------------------------

test('ChatContext.seedBaseline', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({
      today: [FIX.day],
      prev: [FIX.summary, FIX.journal, FIX.meeting],
      goals: [FIX.goal],
      decisions: [FIX.decision],
    }),
  })
  const report = await context.seedBaseline()

  assert({
    given: 'a previous day that has a summary alongside raw activity',
    should: 'keep the summary and journal but drop the raw meeting',
    actual: {
      paths: [...context.paths].sort(),
      size: report.size,
      counts: report.counts,
    },
    expected: {
      paths: [FIX.day, FIX.summary, FIX.journal, FIX.goal, FIX.decision].sort(),
      size: 5,
      counts: { today: 1, prev: 3, goals: 1, decisions: 1 },
    },
  })
})

test('ChatContext.seedBaseline - dedupe', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({
      today: [FIX.day],
      prev: [FIX.journal],
      goals: [FIX.goal, FIX.goal],
      decisions: [],
    }),
  })
  const report = await context.seedBaseline()

  assert({
    given: 'the same path returned by more than one baseline fetch',
    should: 'enter the universe once',
    actual: report.size,
    expected: 3,
  })
})

// ---------------------------------------------------------------------------
// firstTurn
// ---------------------------------------------------------------------------

test('ChatContext.firstTurn', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: '{ people { path } }' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  const report = await context.firstTurn('who is Jane?')

  const entry = context.log[0]
  assert({
    given: 'a first turn whose query returned a person document',
    should: 'record the full turn-1 universe with the query, stats, and pinned goal',
    actual: {
      turn: entry.turn,
      queries: entry.queries,
      universePaths: entry.universe?.map((r) => r.path),
      goalPinned: entry.universe?.find((r) => r.path === 'goals/2026.md')?.pinned,
      kept: entry.stats?.kept,
      merged: context.paths.includes(FIX.person),
      collectionSize: report.rebuilt?.collectionSize,
      errors: report.errors,
    },
    expected: {
      turn: 1,
      queries: ['{ people { path } }'],
      universePaths: ['goals/2026.md', 'people/Jane-Doe.md', 'time/2026/01/26-01/01-27/day.md'],
      goalPinned: true,
      kept: 3,
      merged: true,
      collectionSize: 3,
      errors: [],
    },
  })
})

test('ChatContext.firstTurn - own chat exclusion', async () => {
  const { context } = makeContext({
    ownChatPath: FIX.ownChat,
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.ownChat, FIX.person] })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  const report = await context.firstTurn('what did we discuss?')

  assert({
    given: "a query that matched the session's own transcript",
    should: 'merge everything except the own chat',
    actual: { paths: context.paths, size: report.rebuilt?.collectionSize },
    expected: { paths: [FIX.person], size: 1 },
  })
})

test('ChatContext.firstTurn - producer failure', async () => {
  const { context, errorEntries } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(fail('query generation failed')),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  const report = await context.firstTurn('anything')

  assert({
    given: 'a first turn whose query pipeline reported failure',
    should: 'record the error on the turn entry and in the AI error log',
    actual: {
      reportErrors: report.errors,
      entryErrors: context.log[0]?.errors,
      logged: errorEntries.map((e) => ({ stage: e.stage, message: e.message })),
    },
    expected: {
      reportErrors: ['query generation failed'],
      entryErrors: ['query generation failed'],
      logged: [{ stage: 'context:files', message: 'query generation failed' }],
    },
  })
})

// ---------------------------------------------------------------------------
// evolveTurn
// ---------------------------------------------------------------------------

test('ChatContext.evolveTurn', async () => {
  const executed: string[] = []
  const progress: string[] = []
  const { context } = makeContext({
    onProgress: (e) => progress.push(e.type),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: ['q1', 'q2'], changed: true })),
      executeQuery: (query) => {
        executed.push(query)
        // The alias-repeated path exercises the diff dedupe.
        return Promise.resolve(ok({ paths: [FIX.roadmap, FIX.roadmap] }))
      },
    },
  })
  await context.firstTurn('who is Jane?')
  const report = await context.evolveTurn('what about the Atlas roadmap?', [])

  const entry = context.log[1]
  assert({
    given: 'an evolved query set where one query is new',
    should: 'execute only the new query and diff each new doc once',
    actual: {
      executed,
      progress,
      turn: entry.turn,
      queries: entry.queries,
      diff: entry.diff?.map((r) => r.path),
      merged: context.paths.includes(FIX.roadmap),
      rebuilt: report.rebuilt !== undefined,
    },
    expected: {
      executed: ['q2'],
      progress: ['queries-changed'],
      turn: 2,
      queries: ['q1', 'q2'],
      diff: ['projects/Atlas/Roadmap.md'],
      merged: true,
      rebuilt: true,
    },
  })
})

test('ChatContext.evolveTurn - unchanged', async () => {
  const { context } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: ['q1'], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.firstTurn('who is Jane?')
  const report = await context.evolveTurn('tell me more', [])
  context.recordTurnTools([])

  assert({
    given: 'an evolve turn that changed nothing',
    should: 'skip the rebuild but still write a minimal turn entry',
    actual: {
      rebuilt: report.rebuilt,
      errors: report.errors,
      entries: context.log.map((e) => ({ turn: e.turn, queries: e.queries, hasStats: e.stats !== undefined })),
    },
    expected: {
      rebuilt: undefined,
      errors: [],
      entries: [
        { turn: 1, queries: ['q1'], hasStats: true },
        { turn: 2, queries: ['q1'], hasStats: false },
      ],
    },
  })
})

test('ChatContext.evolveTurn - evolve failure', async () => {
  const { context, errorEntries } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(fail('evolve broke')),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.firstTurn('who is Jane?')
  const report = await context.evolveTurn('next question', [])

  assert({
    given: 'an evolve pipeline that reported failure',
    should: 'skip the rebuild, record a minimal entry with the error, and log it',
    actual: {
      rebuilt: report.rebuilt,
      entry: context.log[1],
      logged: errorEntries.map((e) => e.stage),
    },
    expected: {
      rebuilt: undefined,
      entry: { turn: 2, queries: ['q1'], errors: ['evolve broke'] },
      logged: ['context:evolve'],
    },
  })
})

test('ChatContext.evolveTurn - query failure', async () => {
  const { context, errorEntries } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: ['q1', 'q2'], changed: true })),
      executeQuery: () => Promise.resolve(fail('bad GraphQL')),
    },
  })
  await context.firstTurn('who is Jane?')
  const report = await context.evolveTurn('next question', [])

  assert({
    given: 'a new query whose execution reported failure',
    should: 'still rebuild, carry the error on the entry, and not double-log it',
    actual: {
      rebuilt: report.rebuilt !== undefined,
      entryErrors: context.log[1]?.errors,
      logged: errorEntries.length,
    },
    expected: {
      rebuilt: true,
      entryErrors: ['bad GraphQL'],
      logged: 0,
    },
  })
})

// ---------------------------------------------------------------------------
// recordTurnTools
// ---------------------------------------------------------------------------

test('ChatContext.recordTurnTools', async () => {
  const { context } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.firstTurn('who is Jane?')
  context.recordTurnTools([{ tool: 'web_search', outcome: 'ok' }])

  assert({
    given: 'a turn that already has a log entry',
    should: 'attach the tools to it rather than appending a duplicate',
    actual: {
      entries: context.log.length,
      tools: context.log[0].tools,
    },
    expected: {
      entries: 1,
      tools: [{ tool: 'web_search', outcome: 'ok' }],
    },
  })
})

// ---------------------------------------------------------------------------
// restore
// ---------------------------------------------------------------------------

test('ChatContext.restore', async () => {
  const carried: ContextTurnLog[] = [
    { turn: 1, queries: ['q1'], universe: [{ path: 'goals/2026.md', tokens: 10, pinned: true }] },
    { turn: 2, queries: ['q1', 'q2'], diff: [{ path: 'projects/Atlas/Roadmap.md', score: 15, tokens: 12 }] },
  ]
  const state: ResumeState = {
    conversation: [],
    universePaths: ['goals/2026.md', 'projects/Atlas/Roadmap.md'],
    queries: ['q1', 'q2'],
    lastTurn: 2,
    contextLog: carried,
  }
  const { context } = makeContext()
  const report = await context.restore(state)

  assert({
    given: 'a recorded resume state',
    should: 'restore the universe and log without appending a new entry',
    actual: {
      resolved: report.resolution.resolved.sort(),
      unresolved: report.resolution.unresolved,
      recorded: report.rebuild.recorded,
      stats: report.rebuild.stats?.kept,
      entries: context.log.length,
      goalPinnedOnResume: report.rebuild.stats !== undefined && context.paths.includes(FIX.goal),
    },
    expected: {
      resolved: ['goals/2026.md', 'projects/Atlas/Roadmap.md'],
      unresolved: [],
      recorded: false,
      stats: 2,
      entries: 2,
      goalPinnedOnResume: true,
    },
  })
})

test('ChatContext.restore - turn numbering continues', async () => {
  const state: ResumeState = {
    conversation: [],
    universePaths: ['people/Jane-Doe.md'],
    queries: ['q1'],
    lastTurn: 3,
    contextLog: [{ turn: 3, queries: ['q1'] }],
  }
  const { context } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
      evolveQueries: () => Promise.resolve(ok({ queries: ['q1', 'q2'], changed: true })),
      executeQuery: () => Promise.resolve(ok({ paths: [FIX.roadmap] })),
    },
  })
  await context.restore(state)
  await context.evolveTurn('a new direction', [])

  assert({
    given: 'a session resumed at turn 3',
    should: 'number the next evolve turn 4',
    actual: context.log.at(-1)?.turn,
    expected: 4,
  })
})

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

test('ChatContext.clear', async () => {
  const { context } = makeContext({
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.firstTurn('who is Jane?')
  context.clear()

  assert({
    given: 'a cleared context',
    should: 'drop the whole universe',
    actual: context.paths,
    expected: [],
  })
})
