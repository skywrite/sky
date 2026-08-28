import * as path from 'node:path'
import type { AIErrorEntry } from '#shared/ai/errorLog.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { exists, makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ProducerResult } from '../ChatContext/mod.ts'
import type { ModelInvoker } from '../ChatEngine/mod.ts'
import { loadResumeSession } from '../ChatStore/mod.ts'
import type { SaveEnricher } from '../ChatStore/save.ts'
import { setUserSpeakerLabel } from '../document/mod.ts'
import ChatSession, { type ChatSessionEvent, type ChatSessionOptions } from './mod.ts'

setUserSpeakerLabel('Jane')

// The fixture notebook is ChatContext's — real files on disk, read and
// merged through the filesystem exactly as in production.
const BASE_DIR = path.join(import.meta.dirname!, '..', 'ChatContext', 'fixtures', 'notebook')
const TODAY = new PlainDate('2026-01-27')
const START = new PlainDateTime('2026-01-27 09:30')
const STAMP = new PlainDateTime('2026-01-27 09:31')

const abs = (rel: string) => path.join(BASE_DIR, rel)
const FIX = {
  day: abs('time/2026/01/26-01/01-27/day.md'),
  goal: abs('goals/2026.md'),
  roadmap: abs('projects/Atlas/Roadmap.md'),
}

const AMBIENT = { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] }

const ok = <T>(value: T): ProducerResult<T> => ({ ok: true, value })

async function fixtureDoc(absPath: string): Promise<{ doc: Document; path: string }> {
  return { doc: Document.fromMarkdown(await readTextFile(absPath)), path: absPath }
}

/** A service fetch fake keyed on the query's distinguishing substring. */
function fetchFake(sets: { today?: string[]; goals?: string[] }) {
  return async (query: string): Promise<Array<{ doc: Document; path: string }>> => {
    let paths: string[] = []
    if (query.includes('dateGte') || query.includes('decisions') || query.includes('ai/memory')) paths = []
    else if (query.includes('goals')) paths = sets.goals ?? []
    else paths = sets.today ?? []
    return await Promise.all(paths.map(fixtureDoc))
  }
}

/** Streams one script of pieces per call and snapshots the messages each call saw. */
function scriptedModel(rounds: string[][]) {
  const calls: Array<{ messages: number }> = []
  const invokeModel: ModelInvoker = (args) => {
    const pieces = rounds[calls.length] ?? []
    calls.push({ messages: args.messages.length })
    for (const piece of pieces) args.sink.write(piece)
    return Promise.resolve({ text: '', content: [], steps: [], responseMessages: [] })
  }
  return { invokeModel, calls }
}

const stubEnricher: SaveEnricher = {
  summarize: async () => 'Atlas Demo Focus',
  chooseTags: async () => undefined,
  chooseRel: async () => undefined,
}

async function makeSession(over: Partial<ChatSessionOptions> = {}) {
  const tmp = await makeTempDir({ prefix: 'sky-chatsession-' })
  const events: ChatSessionEvent[] = []
  const errors: AIErrorEntry[] = []
  const producerCalls = { initial: 0, evolve: 0 }
  const model = scriptedModel([['Focus on ', 'the demo.'], ['Then the pricing page.']])
  const session = new ChatSession({
    today: TODAY,
    startTime: START,
    days: 7,
    baseDir: BASE_DIR,
    timeDir: tmp,
    resume: null,
    // The scripted invoker never touches the model config.
    model: {} as ResolvedModel,
    profile: { provider: 'claude', model: 'claude-opus-4-6' },
    producers: {
      produceInitialQuery: () => {
        producerCalls.initial++
        return Promise.resolve(ok({ paths: [FIX.roadmap] }))
      },
      evolveQueries: () => {
        producerCalls.evolve++
        return Promise.resolve(ok({ queries: [] as string[], changed: false }))
      },
      executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
    },
    ambient: AMBIENT,
    systemPrompt: () => Promise.resolve('You are a test assistant.'),
    tools: () => Promise.resolve({ tools: { notebook_search: {} }, toolApproval: {} }),
    approvalHandler: () => Promise.resolve({ approved: true, reason: 'ok' }),
    autosavePath: path.join(tmp, 'autosave.md'),
    onEvent: (event) => events.push(event),
    invokeModel: model.invokeModel,
    fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
    now: () => Promise.resolve(STAMP),
    logError: (entry) => {
      errors.push(entry)
      return Promise.resolve()
    },
    ...over,
  })
  return { session, events, errors, tmp, producerCalls, model }
}

const types = (events: ChatSessionEvent[]) => events.map((e) => e.type)

test('ChatSession.start - a new chat seeds the baseline', async () => {
  const { session } = await makeSession()
  const started = await session.start()

  assert({
    given: 'a new chat over a fixture notebook',
    should: 'gather the baseline and report it, with no restore',
    actual: { seeded: started.seeded?.counts, restored: started.restored, paths: [...session.paths].sort() },
    expected: {
      seeded: { today: 1, prev: 0, goals: 1, decisions: 0, memory: 0 },
      restored: undefined,
      paths: [FIX.day, FIX.goal].sort(),
    },
  })
})

test('ChatSession.send - the first turn runs the whole cycle', async () => {
  const { session, events, tmp, producerCalls } = await makeSession()
  await session.start()
  const turn = await session.send('What should I focus on for the Atlas launch?')

  assert({
    given: 'the first message of a session',
    should: 'emit the turn as one ordered stream: gather, rebuild, tools, model, deltas, done',
    actual: types(events),
    expected: [
      'context-gathering',
      'context-rebuilt',
      'tools',
      'model-start',
      'text-delta',
      'text-delta',
      'turn-complete',
    ],
  })

  assert({
    given: 'the same turn',
    should: 'return the streamed reply and no error',
    actual: { text: turn.text, error: turn.error, initial: producerCalls.initial },
    expected: { text: 'Focus on the demo.', error: undefined, initial: 1 },
  })

  assert({
    given: 'the conversation afterward',
    should: 'hold the stamped user message and the assistant reply',
    actual: session.turns.map((m) => ({ role: m.role, when: m.when, content: m.content })),
    expected: [
      { role: 'user', when: '2026-01-27 09:31', content: 'What should I focus on for the Atlas launch?' },
      { role: 'assistant', when: '2026-01-27 09:31', content: 'Focus on the demo.' },
    ],
  })

  const snapshot = await loadResumeSession(path.join(tmp, 'autosave.md'))
  assert({
    given: 'the crash snapshot written after the turn',
    should: 'reload as a resumable session holding both messages and the turn log',
    actual: { conversation: snapshot.state.conversation.length, lastTurn: snapshot.state.lastTurn },
    expected: { conversation: 2, lastTurn: 1 },
  })
})

test('ChatSession.send - later turns evolve rather than gather', async () => {
  const { session, events, producerCalls } = await makeSession()
  await session.start()
  await session.send('What should I focus on?')
  const before = events.length
  await session.send('And after that?')

  assert({
    given: 'a second message',
    should: 'ask the evolve producer, not the initial one; no gathering, and tools named only once per session',
    actual: { producerCalls, secondTurn: types(events.slice(before)) },
    expected: {
      producerCalls: { initial: 1, evolve: 1 },
      secondTurn: ['model-start', 'text-delta', 'turn-complete'],
    },
  })
})

test('ChatSession.send - a failed model turn is reported, logged, and survived', async () => {
  const { session, events, errors, tmp } = await makeSession({
    invokeModel: () => Promise.reject(new Error('overloaded')),
  })
  await session.start()
  const turn = await session.send('hello?')

  assert({
    given: 'a model call that failed',
    should: 'report the error instead of throwing, keep the user message, add no reply, and log it',
    actual: {
      error: turn.error,
      text: turn.text,
      roles: session.turns.map((m) => m.role),
      logged: errors.map((e) => ({ source: e.source, stage: e.stage, question: e.question })),
      completed: events.filter((e) => e.type === 'turn-complete').length,
    },
    expected: {
      error: 'overloaded',
      text: undefined,
      roles: ['user'],
      logged: [{ source: 'ai:chat', stage: 'turn', question: 'hello?' }],
      completed: 0,
    },
  })

  assert({
    given: 'the failed turn',
    should: 'still snapshot the session — the message the user typed is not lost',
    actual: await exists(path.join(tmp, 'autosave.md')),
    expected: true,
  })
})

test('ChatSession.end - saving files the transcript through the store and drops the snapshot', async () => {
  const { session, tmp } = await makeSession()
  await session.start()
  await session.send('What should I focus on?')
  const saved = await session.end({ save: true, enricher: stubEnricher })

  assert({
    given: 'a session ended with save wanted',
    should: 'file the chat under its day, titled by the enricher, and remove the crash snapshot',
    actual: {
      path: saved ? path.relative(tmp, saved.path) : null,
      exchanges: saved?.exchanges,
      snapshot: await exists(path.join(tmp, 'autosave.md')),
    },
    expected: {
      path: path.join(dayDir(TODAY), 'actions', 'ai-chats', '09-30_Atlas-Demo-Focus.md'),
      exchanges: 1,
      snapshot: false,
    },
  })
})

test('ChatSession.end - an ephemeral exit leaves nothing behind', async () => {
  const { session, tmp } = await makeSession()
  await session.start()
  await session.send('What should I focus on?')
  const saved = await session.end({ save: false })

  assert({
    given: 'a session ended without save',
    should: 'write no transcript and remove the crash snapshot',
    actual: {
      saved,
      snapshot: await exists(path.join(tmp, 'autosave.md')),
      dayDir: await exists(path.join(tmp, dayDir(TODAY))),
    },
    expected: { saved: null, snapshot: false, dayDir: false },
  })
})

test('ChatSession.start - resuming restores the conversation and the recorded context', async () => {
  const first = await makeSession()
  await first.session.start()
  await first.session.send('What should I focus on?')
  const saved = await first.session.end({ save: true, enricher: stubEnricher })
  const resume = await loadResumeSession(saved!.path)

  const second = await makeSession({ resume, timeDir: first.tmp })
  const started = await second.session.start()
  const turn = await second.session.send('And after that?')

  assert({
    given: 'a session resumed from the saved transcript',
    should: 'restore the recorded universe rather than seeding, reseed both messages, and continue on the evolve path',
    actual: {
      restored: started.restored !== undefined,
      seeded: started.seeded,
      resolved: started.restored?.resolution.resolved.length,
      roles: second.session.turns.map((m) => m.role),
      producerCalls: second.producerCalls,
      // The reseeded history reaches the model: two prior messages plus the new one.
      modelSaw: second.model.calls[0]?.messages,
      reply: turn.text,
    },
    expected: {
      restored: true,
      seeded: undefined,
      resolved: 3,
      roles: ['user', 'assistant', 'user', 'assistant'],
      producerCalls: { initial: 0, evolve: 1 },
      modelSaw: 3,
      reply: 'Focus on the demo.',
    },
  })

  const written = await second.session.end({ save: true, enricher: stubEnricher })
  assert({
    given: 'the resumed session saved again',
    should: 'write back to the same file with both exchanges',
    actual: { path: written?.path, resumed: written?.resumed, exchanges: written?.exchanges },
    expected: { path: saved!.path, resumed: true, exchanges: 2 },
  })
})
