import * as path from 'node:path'
import type { AIErrorEntry } from '#shared/ai/errorLog.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { ContextTurnLog } from '../document/ContextLog/mod.ts'
import type { ResumeState } from '../document/resume.ts'
import ChatContext, { type ChatContextOptions, type ProducerResult } from './mod.ts'

// The fixture notebook is real files on disk — ChatContext reads and merges
// documents through the filesystem exactly as in production.
const BASE_DIR = path.join(import.meta.dirname!, 'fixtures', 'notebook')
const TODAY = new PlainDate('2026-01-27')

const abs = (rel: string) => path.join(BASE_DIR, rel)

const FIX = {
  day: abs('time/2026/W05/01-27/day.md'),
  journal: abs('time/2026/W04/01-20/journal/10_Morning_Reflection.md'),
  summary: abs('time/2026/W04/01-20/summary.md'),
  meeting: abs('time/2026/W04/01-20/actions/meetings/11-00_Atlas_Sync.md'),
  prevDay: abs('time/2026/W05/01-26/day.md'),
  prevSummary: abs('time/2026/W05/01-26/summary.md'),
  prevMeeting: abs('time/2026/W05/01-26/actions/meetings/14-00_Atlas_Review.md'),
  oldDay: abs('time/2026/W04/01-22/day.md'),
  oldMessage: abs('time/2026/W04/01-22/actions/messages/slack_Ops-to-atlas-general_Standup-Notes.md'),
  goal: abs('goals/2026.md'),
  decision: abs('decisions/2026-01_Atlas-Tooling.md'),
  roadmap: abs('projects/Atlas/Roadmap.md'),
  person: abs('people/Jane-Doe.md'),
  ownChat: abs('time/2026/W05/01-27/actions/ai-chats/09-00_Prior-Session.md'),
  weekPlan: abs('time/2026/W05/week.md'),
  memory: abs('ai/memory/atlas-terms.md'),
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
function fetchFake(sets: {
  today?: string[]
  prev?: string[]
  goals?: string[]
  decisions?: string[]
  memory?: string[]
}) {
  return async (query: string): Promise<Array<{ doc: Document; path: string }>> => {
    let paths: string[] = []
    if (query.includes('dateGte')) paths = sets.prev ?? []
    else if (query.includes('goals')) paths = sets.goals ?? []
    else if (query.includes('decisions')) paths = sets.decisions ?? []
    else if (query.includes('ai/memory')) paths = sets.memory ?? []
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
      memory: [FIX.memory],
    }),
  })
  const report = await context.seedBaseline()

  assert({
    given: 'a previous day that has a summary alongside raw activity, plus an AI memory',
    should: 'keep the summary and journal, drop the raw meeting, and admit the memory',
    actual: {
      paths: [...context.paths].sort(),
      size: report.size,
      counts: report.counts,
    },
    expected: {
      paths: [FIX.day, FIX.summary, FIX.journal, FIX.goal, FIX.decision, FIX.memory].sort(),
      size: 6,
      counts: { today: 1, prev: 3, goals: 1, decisions: 1, memory: 1 },
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

test('ChatContext.seedBaseline - summary baseline', async () => {
  const { context } = makeContext({
    summaryBaseline: true,
    fetchContext: fetchFake({
      today: [FIX.day],
      prev: [
        // Yesterday (01-26) is exempt: raw survives even its own summary
        FIX.prevDay,
        FIX.prevMeeting,
        FIX.prevSummary,
        // 01-20 has a summary: it replaces raw, the journal rides along
        FIX.summary,
        FIX.journal,
        FIX.meeting,
        // 01-22 has no summary: the day.md ledger stands in alone
        FIX.oldDay,
        FIX.oldMessage,
      ],
      goals: [FIX.goal],
    }),
  })
  await context.seedBaseline()
  await context.firstTurn('what happened with Atlas this week?')

  assert({
    given: 'the opt-in summary baseline over an exempt yesterday, a summarized day, and an unsummarized day',
    should: 'keep yesterday whole, collapse the other days to summary/ledger, and tag the turn stats',
    actual: {
      paths: [...context.paths].sort(),
      baseline: context.log[0].stats?.baseline,
    },
    expected: {
      paths: [
        FIX.day,
        FIX.prevDay,
        FIX.prevMeeting,
        FIX.prevSummary,
        FIX.summary,
        FIX.journal,
        FIX.oldDay,
        FIX.goal,
      ].sort(),
      baseline: 'summary',
    },
  })
})

test('ChatContext.seedBaseline - week-level docs seed whole and the week plan pins', async () => {
  const { context } = makeContext({
    summaryBaseline: true,
    fetchContext: fetchFake({
      today: [FIX.day],
      // 01-20 is summarized, so its raw meeting collapses — the week plan is
      // week-level and must ride the sweep untouched by the per-day policy.
      prev: [FIX.weekPlan, FIX.summary, FIX.journal, FIX.meeting],
      goals: [FIX.goal],
    }),
  })
  await context.seedBaseline()
  await context.firstTurn('what should this week focus on?')

  const entry = context.log[0]
  assert({
    given: 'a baseline sweep returning the week plan alongside a summarized day',
    should: 'seed the plan whole, exempt from the per-day policy, and pin it',
    actual: {
      paths: [...context.paths].sort(),
      planPinned: entry.universe?.find((r) => r.path === 'time/2026/W05/week.md')?.pinned,
    },
    expected: {
      paths: [FIX.day, FIX.weekPlan, FIX.summary, FIX.journal, FIX.goal].sort(),
      planPinned: true,
    },
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
  const report = await context.firstTurn('who is Jane Doe?')

  const entry = context.log[0]
  assert({
    given: 'a first turn whose query returned a person document',
    should: 'record the full turn-1 universe with the query, stats, and pinned goal',
    actual: {
      turn: entry.turn,
      queries: entry.queries,
      universePaths: entry.universe?.map((r) => r.path),
      goalPinned: entry.universe?.find((r) => r.path === 'goals/2026.md')?.pinned,
      // The boosted, name-matched person raises the turn's floor above the
      // ambient day file — kept is the goal and the person.
      kept: entry.stats?.kept,
      dayCut: entry.universe?.find((r) => r.path.endsWith('/day.md'))?.cut,
      merged: context.paths.includes(FIX.person),
      collectionSize: report.rebuilt?.collectionSize,
      errors: report.errors,
    },
    expected: {
      turn: 1,
      queries: ['{ people { path } }'],
      universePaths: ['goals/2026.md', 'people/Jane-Doe.md', 'time/2026/W05/01-27/day.md'],
      goalPinned: true,
      kept: 2,
      dayCut: 'floor',
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

test('ChatContext.firstTurn - score parts recorded', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: '{ people { path } }' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane?')

  const rec = context.log[0].universe?.find((r) => r.path === 'people/Jane-Doe.md')
  assert({
    given: 'a first turn whose targeted query returned the person the question names',
    should: 'record the retrieval tier and lexical part on the universe record',
    actual: {
      prov: rec?.prov,
      lexRecorded: (rec?.lex ?? 0) > 0,
      scoreCarriesBoost: (rec?.score ?? 0) >= 16,
    },
    expected: { prov: 'targeted', lexRecorded: true, scoreCarriesBoost: true },
  })
})

test('ChatContext.firstTurn - relevance floor sizes context to the question', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({
      today: [FIX.day],
      prev: [FIX.summary, FIX.journal],
      goals: [FIX.goal],
    }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: '{ people { path } }' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane Doe?')

  const entry = context.log[0]
  const summary = entry.universe?.find((r) => r.path.endsWith('/summary.md'))
  const person = entry.universe?.find((r) => r.path === 'people/Jane-Doe.md')
  assert({
    given: 'a targeted person question against an ambient baseline',
    should: 'floor the off-topic baseline docs and record the floor parameters in stats',
    actual: {
      summaryCut: summary?.cut,
      personKept: person?.cut === undefined,
      kept: entry.stats?.kept,
      floored: entry.stats?.floored,
      floorApplied: (entry.stats?.floor ?? 0) > 0,
      budget: entry.stats?.budget,
      scoring: entry.stats?.scoring,
    },
    expected: {
      summaryCut: 'floor',
      personKept: true,
      kept: 2,
      floored: 3,
      floorApplied: true,
      budget: 300_000,
      scoring: 's4',
    },
  })
})

test('ChatContext.firstTurn - alias-repeated paths earn no multi-hit bonus', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    producers: {
      // Real query results repeat a path once per matching alias — one
      // execution, one hit.
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person, FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane Doe?')

  const rec = context.log[0].universe?.find((r) => r.path === 'people/Jane-Doe.md')
  assert({
    given: 'a turn-1 query returning the same path under two aliases',
    should: 'score it as one targeted hit (prior 6 + lex 8 + boost 10), not two',
    actual: rec?.score,
    expected: 24,
  })
})

test('ChatContext.evolveTurn - a quiet turn logs the reused partition', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane Doe?')
  const report = await context.evolveTurn('and her role?', [])

  const t1 = context.log[0]
  const t2 = context.log[1]
  assert({
    given: 'an evolve turn whose queries did not change',
    should: 'return no rebuild but log the reused partition with the shipped stats',
    actual: {
      noRebuild: report.rebuilt === undefined,
      turn: t2?.turn,
      reused: t2?.stats?.reused,
      sameTokens: t2?.stats?.docTokens === t1?.stats?.docTokens,
      sameKept: t2?.stats?.kept === t1?.stats?.kept,
      noDiff: t2?.diff === undefined && t2?.universe === undefined,
    },
    expected: { noRebuild: true, turn: 2, reused: true, sameTokens: true, sameKept: true, noDiff: true },
  })
})

test('ChatContext.evolveTurn - a failed evolve stays distinguishable from a quiet one', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day] }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(fail('evolve exploded')),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane Doe?')
  await context.evolveTurn('and her role?', [])

  const t2 = context.log[1]
  assert({
    given: 'an evolve turn whose pipeline failed',
    should: 'log errors and no stats — never a reused partition',
    actual: { errors: t2?.errors?.length, stats: t2?.stats },
    expected: { errors: 1, stats: undefined },
  })
})

test('ChatContext.restore - distinct recorded executions accumulate the multi-hit bonus', async () => {
  const state: ResumeState = {
    conversation: [],
    universePaths: ['people/Jane-Doe.md', 'time/2026/W04/01-20/actions/meetings/11-00_Atlas_Sync.md'],
    queries: ['q1'],
    lastTurn: 3,
    contextLog: [
      { turn: 1, queries: ['q1'] },
      { turn: 2, queries: ['q1'], diff: [{ path: 'people/Jane-Doe.md', score: 16, tokens: 9 }] },
      { turn: 3, queries: ['q1'], diff: [{ path: 'people/Jane-Doe.md', score: 16, tokens: 9 }] },
    ],
  }
  const { context } = makeContext()
  const report = await context.restore(state)

  // The floor is 0.35 × the top score, so it reads the top score back
  // out: two recorded executions → 6 + 10 + 1 = 17 → floor 5.95. A
  // single hit would floor at 5.6.
  assert({
    given: "a resume log where two different turns' diffs returned the same doc",
    should: 'restore two hits and surface the multi-hit bonus in the floor',
    actual: report.rebuild.stats?.floor,
    expected: 5.95,
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

test('ChatContext.evolveTurn - a floored doc rejoins when the topic shifts onto it', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: 'q1' })),
      evolveQueries: () => Promise.resolve(ok({ queries: ['q1', 'q2'], changed: true })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane Doe?')
  const dayAtTurn1 = context.log[0].universe?.find((r) => r.path.endsWith('/day.md'))
  // Observed live on Aug 7: floored counts fall across turns as the term
  // set grows to match more docs. Rejoining is intentional — the floor is
  // per-rebuild, not a permanent verdict.
  const turn2 = await context.evolveTurn('what is the status of the atlas rollout checklist?', [])

  assert({
    given: 'a day file floored by a person question, then a question about its content',
    should: 'floor it at turn 1 and ship it again at turn 2',
    actual: {
      turn1Cut: dayAtTurn1?.cut,
      turn2Floored: turn2.rebuilt?.stats?.floored,
      dayShipsAgain: turn2.rebuilt?.activityMarkdown?.includes('rollout checklist'),
    },
    expected: { turn1Cut: 'floor', turn2Floored: 0, dayShipsAgain: true },
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
    should: 'skip the rebuild and log the reused partition',
    actual: {
      rebuilt: report.rebuilt,
      errors: report.errors,
      entries: context.log.map((e) => ({ turn: e.turn, queries: e.queries, reused: e.stats?.reused === true })),
    },
    expected: {
      rebuilt: undefined,
      errors: [],
      entries: [
        { turn: 1, queries: ['q1'], reused: false },
        { turn: 2, queries: ['q1'], reused: true },
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

test('ChatContext.restore - retrieval evidence survives budget pressure', async () => {
  const meetingRel = 'time/2026/W04/01-20/actions/meetings/11-00_Atlas_Sync.md'
  const state: ResumeState = {
    conversation: [],
    universePaths: ['people/Jane-Doe.md', meetingRel],
    queries: ['q1'],
    lastTurn: 2,
    contextLog: [
      { turn: 1, queries: ['q1'] },
      { turn: 2, queries: ['q1'], diff: [{ path: 'people/Jane-Doe.md', score: 16, tokens: 9 }] },
    ],
  }
  // A budget with room for one doc: without the re-seeded evidence the
  // week-old meeting (6.94) outranks the undated person card (6) and the
  // diff-restored doc would be the one cut.
  const { context } = makeContext({ maxTokens: 12 })
  const report = await context.restore(state)

  assert({
    given: 'a restored universe under budget pressure with a recorded diff doc',
    should: 're-seed retrieval evidence so the diff doc outranks the recenter meeting',
    actual: {
      kept: report.rebuild.stats?.kept,
      cutPaths: report.rebuild.cut.map((r) => r.path),
    },
    expected: { kept: 1, cutPaths: [meetingRel] },
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

// ---------------------------------------------------------------------------
// sweep-stratified admission
// ---------------------------------------------------------------------------

test('ChatContext.firstTurn - a stated window switches admission to sweep-stratified', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({
      today: [FIX.day],
      prev: [FIX.journal, FIX.oldDay, FIX.prevDay],
      goals: [FIX.goal],
    }),
    producers: {
      produceInitialQuery: () =>
        Promise.resolve(ok({ paths: [FIX.person], query: '{ people { path } }', since: '14d', until: '2026-01-25' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('everything from mid-January through the 25th')

  const entry = context.log[0]
  const viaOf = (rel: string) => entry.universe?.find((r) => r.path === rel)?.via
  assert({
    given: 'a first turn whose producer reports a stated window (14d, until 2026-01-25)',
    should: 'record the policy and window, and reserve only docs dated inside it',
    actual: {
      policy: entry.stats?.policy,
      sweep: entry.stats?.sweep,
      // 01-20 and 01-22 lie inside [today−14d, 01-25] — their month slice
      // reserves them; 01-26/27 are past the stated end and compete by rank.
      inWindowReserved: [
        viaOf('time/2026/W04/01-20/journal/10_Morning_Reflection.md'),
        viaOf('time/2026/W04/01-22/day.md'),
      ],
      outsideWindow: [viaOf('time/2026/W05/01-26/day.md'), viaOf('time/2026/W05/01-27/day.md')],
    },
    expected: {
      policy: 'sweep-stratified',
      sweep: '14d..2026-01-25',
      inWindowReserved: ['reserve', 'reserve'],
      outsideWindow: [undefined, undefined],
    },
  })
})

test('ChatContext.firstTurn - no stated window keeps plain rank admission', async () => {
  const { context } = makeContext({
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.person], query: '{ people { path } }' })),
      evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
  })
  await context.seedBaseline()
  await context.firstTurn('who is Jane Doe?')

  const entry = context.log[0]
  assert({
    given: 'a first turn with no stated window',
    should: 'record no policy and mark nothing as reserved',
    actual: {
      policy: entry.stats?.policy,
      sweep: entry.stats?.sweep,
      reserved: entry.universe?.filter((r) => r.via === 'reserve').length,
    },
    expected: { policy: undefined, sweep: undefined, reserved: 0 },
  })
})
