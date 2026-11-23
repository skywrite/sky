import { rm } from 'node:fs/promises'
import * as path from 'node:path'
import { jsonSchema, simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { createMemoryTools } from '#commands/lib/chat/memoryTools.ts'
import type { AIErrorEntry } from '#shared/ai/errorLog.ts'
import { InputTokenLimitError } from '#shared/ai/inputTokenLimit.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { exists, makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import type { PreflightVerdict } from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ResearchContext } from '#shared/models/Chat/researchContext.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { loadMemories, renderPreferenceBlock } from '#shared/models/Memory/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { withTiming, withTimingEnvironment } from '#shared/timing/mod.ts'
import { assert, test } from '#test'
import { splitChatImages } from '#universal/ai/chatImages.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { ProducerResult } from '../ChatContext/mod.ts'
import type { ModelInvoker } from '../ChatEngine/mod.ts'
import { loadResumeSession } from '../ChatStore/mod.ts'
import type { SaveEnricher } from '../ChatStore/save.ts'
import ChatDocument, { setUserSpeakerLabel } from '../document/mod.ts'
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
  day: abs('time/2026/W05/01-27/day.md'),
  goal: abs('goals/2026.md'),
  roadmap: abs('projects/Atlas/Roadmap.md'),
  person: abs('people/Jane-Doe.md'),
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

/**
 * Every test session keeps its saved chats' logs in one folder, away from
 * the temp notebooks. A log is keyed by its chat's path beneath the folder
 * the notebooks sit in, so a session that reopens another's chat reads the
 * same log, as a host does.
 */
let chatLogs: Promise<string> | undefined
const chatLogDir = () => (chatLogs ??= makeTempDir({ prefix: 'sky-chatsession-logs-' }))

/** A saved chat read back with its log; `timeDir` is the temp notebook it was saved in. */
const reload = async (file: string, timeDir: string) =>
  loadResumeSession(file, { baseDir: path.dirname(timeDir), chatLogDir: await chatLogDir() })

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
    chatLogDir: await chatLogDir(),
    resume: null,
    // The scripted invoker never touches the model config.
    model: {} as ResolvedModel,
    profile: { model: 'claude-opus-4-6' },
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

test('an explicit memory tool saves during the reply and survives discarding the chat', async () => {
  const notebookDir = await makeTempDir({ prefix: 'sky-chat-memory-session-' })
  const memoryDir = path.join(notebookDir, 'ai', 'memory')
  let requests = 0
  let sawReceipt = false
  const reply = 'Remembered: use metric units. [Memory](/explorer/ai/memory/use-metric-units.md)'
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      const first = requests++ === 0
      if (!first) sawReceipt = JSON.stringify(prompt).includes('/explorer/ai/memory/use-metric-units.md')
      return {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            ...(first
              ? [
                  {
                    type: 'tool-call',
                    toolCallId: 'remember-metric',
                    toolName: 'remember',
                    input: JSON.stringify({
                      kind: 'preference',
                      summary: 'Use metric units',
                      body: 'The user prefers metric units.',
                    }),
                  },
                ]
              : [
                  { type: 'text-start', id: 'reply' },
                  { type: 'text-delta', id: 'reply', delta: reply },
                  { type: 'text-end', id: 'reply' },
                ]),
            {
              type: 'finish',
              finishReason: { unified: first ? 'tool-calls' : 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }
    },
  })
  const { session, tmp, errors } = await makeSession({
    model: { model },
    invokeModel: undefined,
    contextTokens: 0,
    today: new PlainDate('2031-03-16'),
    startTime: new PlainDateTime('2031-03-16 23:59'),
    now: async () => new PlainDateTime('2031-03-17 00:05'),
    tools: async (hooks) => ({
      tools: createMemoryTools({
        memoryDir,
        notebookDir,
        source: '/chat/source/sample-memory',
        today: () => hooks.context.conversation.findLast((turn) => turn.role === 'user')!.when!.slice(0, 10),
      }),
      toolApproval: {},
    }),
    approvalHandler: async () => {
      throw new Error('An explicit memory request needs no repeat approval.')
    },
  })
  try {
    await session.start()
    const report = await session.send('Remember that I prefer metric units.')
    const during = await loadMemories(memoryDir)
    await session.end({ save: false })
    const after = await loadMemories(memoryDir)
    const markdown = await readTextFile(after[0].path)
    assert({
      given: 'an explicit memory request followed by discarding the conversation',
      should:
        'return the saved receipt before replying, use the current message date, and retain the memory for future chats',
      actual: [
        requests,
        sawReceipt,
        report.text,
        errors.length,
        during.length,
        after.length,
        markdown.includes('created: 2031-03-17'),
        renderPreferenceBlock(after),
      ],
      expected: [2, true, reply, 0, 1, 1, true, '- The user prefers metric units.'],
    })
  } finally {
    await rm(tmp, { recursive: true, force: true })
    await rm(notebookDir, { recursive: true, force: true })
  }
})

test('a session recovers capacity, reports the reduction, and keeps it through recovery', async () => {
  let requests = 0
  const model = new MockLanguageModelV3({
    provider: 'anthropic.messages',
    doStream: async () => {
      if (requests++ === 0) throw new InputTokenLimitError(9000, 1000)
      return {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Here is the summary.' },
            { type: 'text-end', id: 't' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }
    },
  })
  const { session, events, errors, tmp } = await makeSession({
    model: { model },
    invokeModel: undefined,
    contextTokens: 25_000,
    tools: async () => ({ tools: {}, toolApproval: {} }),
  })
  try {
    await session.start()
    const report = await session.send('Summarize the notebook.')
    const recovered = await loadResumeSession(path.join(tmp, 'autosave.md'), { baseDir: BASE_DIR, snapshot: true })
    assert({
      given: 'the provider rejects the first assembled request',
      should: 'answer on retry, keep the allowance, and save the reduction for the reply and Context panel',
      actual: {
        requests,
        reply: report.text,
        errors: errors.length,
        preference: session.contextTokens,
        disclosed: !!report.adjustment && types(events).includes('context-adjusted'),
        saved: recovered.state.contextLog[0].adjustment,
        requestBudget: recovered.state.contextLog[0].stats?.requestBudget !== undefined,
      },
      expected: {
        requests: 2,
        reply: 'Here is the summary.',
        errors: 0,
        preference: 25_000,
        disclosed: true,
        saved: report.adjustment,
        requestBudget: true,
      },
    })
  } finally {
    await session.end({ save: false })
    await rm(tmp, { recursive: true, force: true })
  }
})

test("ChatSession - the budget counts the model's tokens; the context reads the text that holds", async () => {
  const { session, events, tmp } = await makeSession({ contextTokens: 750_000, tokenRatio: 1.5 })
  try {
    await session.start()
    await session.send('What is on the roadmap?')
    const logged = session.contextLog.findLast((entry) => entry.stats)?.stats
    const rebuilt = events.findLast((event) => event.type === 'context-rebuilt')
    const reported = rebuilt?.type === 'context-rebuilt' ? rebuilt.report.stats : undefined
    session.setModel({} as ResolvedModel, { model: 'claude-opus-4-6' }, 3)
    session.setModel({} as ResolvedModel, { model: 'claude-sonnet-x' }, 2)
    await session.send('And after that?')
    assert({
      given: 'a 750k budget on a model counting 1.5 tokens per four-character estimate, then another model at 2',
      should:
        'assemble within 500k of estimate, show the counts in the model’s tokens, and re-read the budget for the new model only',
      actual: {
        budget: session.contextTokens,
        assembled: logged?.budget,
        shown: reported?.budget,
        docTokens: reported?.docTokens === Math.round((logged?.docTokens ?? 0) * 1.5),
        afterSwitch: [
          session.contextTokens,
          session.contextLog.findLast((entry) => entry.settings)?.settings?.contextTokens,
        ],
      },
      expected: {
        budget: 750_000,
        assembled: 500_000,
        shown: 750_000,
        docTokens: true,
        afterSwitch: [750_000, 375_000],
      },
    })
  } finally {
    await session.end({ save: false })
    await rm(tmp, { recursive: true, force: true })
  }
})

test('ChatSession Stop before context preserves turn numbering and the next context gathering', async () => {
  const { session, model, producerCalls, errors, tmp } = await makeSession()
  try {
    const controller = new AbortController()
    controller.abort()
    const stopped = await session.send('Stop this question.', undefined, controller.signal)
    const callsBeforeNext = model.calls.length
    await session.start()
    const next = await session.send('Start another question.')
    assert({
      given: 'a stopped first message before the notebook is gathered',
      should: 'save a stopped exchange, gather for the next question, and keep separate turn logs',
      actual: [
        stopped.stopped,
        callsBeforeNext,
        next.text,
        producerCalls.initial,
        session.contextLog.map((entry) => entry.turn),
        session.turns.length,
        errors.length,
      ],
      expected: [true, 0, 'Focus on the demo.', 1, [1, 2], 4, 0],
    })
  } finally {
    await session.end({ save: false })
    await rm(tmp, { recursive: true, force: true })
  }
})

test('ChatSession Stop during context never starts tools or generation', async () => {
  const controller = new AbortController()
  let toolsCalled = false
  const { session, model, errors, tmp } = await makeSession({
    producers: {
      produceInitialQuery: async () => {
        controller.abort()
        return ok({ paths: [] })
      },
      evolveQueries: async () => ok({ queries: [], changed: false }),
      executeQuery: async () => ok({ paths: [] }),
    },
    tools: async () => {
      toolsCalled = true
      return { tools: {}, toolApproval: {} }
    },
  })
  await session.start()
  const stopped = await session.send('Read the sample notebook.', undefined, controller.signal)
  assert({
    given: 'Stop while context is being prepared',
    should: 'finish the stopped exchange without running tools, a model, or an error log',
    actual: [stopped.stopped, toolsCalled, model.calls.length, errors.length, session.turns.at(-1)?.content],
    expected: [true, false, 0, 0, '*Response stopped.*'],
  })
  await session.end({ save: false })
  await rm(tmp, { recursive: true, force: true })
})

test('ChatSession persists precise prompt-to-result timing, individual calls, and unchanged resumed history', async () => {
  let now = 0
  let instant = '2026-01-27T15:31:00.125Z'
  await withTimingEnvironment({ now: () => now, instant: () => instant, sink: () => {} }, async () => {
    const { session, tmp } = await makeSession({
      contextTokens: 0,
      invokeModel: async ({ sink }) => {
        await withTiming({ kind: 'model', name: 'mock-model', provider: 'mock', model: 'mock-model' }, async () => {
          now += 10_000
        })
        for (let i = 0; i < 2; i++) {
          await withTiming({ kind: 'tool', name: 'notebook_query' }, async () => {
            await withTiming({ kind: 'command', name: 'mock:lookup' }, async () => {
              now += 15_000
            })
            if (i === 0) {
              await withTiming({ kind: 'model', name: 'mock-inner' }, async () => {
                now += 5_000
              })
            }
            return { text: 'Synthetic tool payload, not timing metadata' }
          })
        }
        await withTiming({ kind: 'wait', name: 'tool:approval' }, async () => {
          now += 250
        })
        instant = '2026-01-27T15:31:45.375Z'
        sink.write('Done.')
        return { text: '', content: [], steps: [], responseMessages: [] }
      },
    })
    await session.start()
    const turn = await session.send('Look up the mock roadmap')
    const snapshot = await loadResumeSession(path.join(tmp, 'autosave.md'))
    const timing = snapshot.state.contextLog[0]?.timing
    const tools = timing?.spans.filter((span) => span.kind === 'tool') ?? []
    assert({
      given: 'a 45.25-second reply whose visible transcript stamps are both 09:31',
      should: 'save sub-second timestamps, monotonic duration, and each nested call in its first snapshot',
      actual: {
        stamps: session.turns.map((message) => message.when),
        startedAt: timing?.startedAt,
        finishedAt: timing?.finishedAt,
        wall: timing?.wallMs,
        model: timing?.modelMs,
        tool: timing?.toolMs,
        other: timing?.otherMs,
        outcome: timing?.outcome,
        calls: tools.map((span) => [span.name, span.durationMs]),
        distinct: new Set(tools.map((span) => span.spanId)).size,
        nested: timing?.spans
          .filter((span) => span.kind === 'command')
          .every((span) => tools.some((tool) => tool.spanId === span.parentSpanId)),
        leaked: JSON.stringify(timing).includes('Synthetic tool payload'),
        matchesReport: JSON.stringify(timing) === JSON.stringify(turn.timing),
      },
      expected: {
        stamps: ['2026-01-27 09:31', '2026-01-27 09:31'],
        startedAt: '2026-01-27T15:31:00.125Z',
        finishedAt: '2026-01-27T15:31:45.375Z',
        wall: 45_250,
        model: 15_000,
        tool: 30_000,
        other: 250,
        outcome: 'success',
        calls: [
          ['notebook_query', 20_000],
          ['notebook_query', 15_000],
        ],
        distinct: 2,
        nested: true,
        leaked: false,
        matchesReport: true,
      },
    })

    const written = await session.end({ save: true, enricher: stubEnricher })
    const resume = await reload(written!.path, tmp)
    const second = await makeSession({ resume, contextTokens: 0 })
    await second.session.start()
    now += 100_000 // Idle time and a restart never become part of the next reply.
    const next = await second.session.send('And the next step?')
    const saved = await second.session.end({ save: true, enricher: stubEnricher })
    const reparsed = await reload(saved!.path, tmp)
    assert({
      given: 'a saved chat resumed after idle time, given another prompt, and saved again',
      should: 'keep the original timing byte-for-byte and start a new trace for the new reply',
      actual: {
        aborted: saved?.aborted ?? false,
        original: JSON.stringify(reparsed.state.contextLog[0]?.timing) === JSON.stringify(timing),
        next: reparsed.state.contextLog[1]?.timing?.wallMs,
        separate: next.timing?.traceId !== timing?.traceId,
      },
      expected: { aborted: false, original: true, next: 0, separate: true },
    })
  })
})

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

test('ChatSession passes current research constraints without retrieved documents or conversation', async () => {
  const seen: ResearchContext[] = []
  const instructions = 'Distinguish observations from inferences.'
  const { session } = await makeSession({
    contextTokens: 25_000,
    systemPrompt: async () => instructions,
    tools: async (hooks) => {
      if (!hooks.researchContext) throw new Error('Missing research constraints')
      seen.push(hooks.researchContext)
      return { tools: {}, toolApproval: {} }
    },
  })
  await session.start()
  await session.send('Find the Atlas demo decision.')
  session.setContextTokens(0)
  await session.send('Now close the notebook.')
  assert({
    given: 'an open chat followed by a turn with reading disabled',
    should: 'pass the current budget and standing rules, keeping retrieved documents and conversation out',
    actual: seen,
    expected: [
      { contextTokens: 25_000, instructions },
      { contextTokens: 0, instructions },
    ],
  })
})

test('ChatSession - a zero budget reads nothing, and a budget after it gathers at the next message', async () => {
  const { session, events, producerCalls } = await makeSession({
    contextTokens: 0,
    invokeModel: scriptedModel([['A.'], ['B.'], ['C.']]).invokeModel,
  })
  const started = await session.start()
  assert({
    given: 'a session started with no reading budget',
    should: 'gather no baseline and report the notebook closed',
    actual: { started, paths: session.paths, initial: producerCalls.initial },
    expected: { started: { closed: true }, paths: [], initial: 0 },
  })

  await session.send('What should I focus on?')
  await session.send('And after that?')
  assert({
    given: 'two messages under the zero budget',
    should:
      'run the model with no gathering, no rebuild, and no producer call; each turn logs as closed with nothing kept',
    actual: {
      events: types(events),
      producerCalls,
      kept: session.kept,
      log: session.contextLog.map((e) => [e.turn, e.stats?.budget, e.stats?.kept]),
    },
    expected: {
      events: ['tools', 'model-start', 'text-delta', 'turn-complete', 'model-start', 'text-delta', 'turn-complete'],
      producerCalls: { initial: 0, evolve: 0 },
      kept: 0,
      log: [
        [1, 0, 0],
        [2, 0, 0],
      ],
    },
  })

  const before = events.length
  const reassembled = session.setContextTokens(5000)
  await session.send('Now with my notebook.')
  assert({
    given: 'a budget set after the closed turns',
    should:
      'reassemble nothing yet, then gather the baseline and run the first gathering turn at the next message, recording the universe on it',
    actual: {
      reassembled,
      thirdTurn: types(events.slice(before)),
      producerCalls,
      paths: [...session.paths].sort(),
      log: session.contextLog.map((e) => [e.turn, e.stats?.budget, e.universe !== undefined]),
    },
    expected: {
      reassembled: null,
      thirdTurn: ['context-gathering', 'context-rebuilt', 'model-start', 'text-delta', 'turn-complete'],
      producerCalls: { initial: 1, evolve: 0 },
      paths: [FIX.day, FIX.goal, FIX.roadmap].sort(),
      log: [
        [1, 0, false],
        [2, 0, false],
        [3, 5000, true],
      ],
    },
  })
})

test('ChatSession - a preflight that judges a message needs no notebook reads nothing new, and a failed one reads as usual', async () => {
  const verdicts: Array<PreflightVerdict | Error> = [
    { needsNotebook: 0.04, skipped: true, model: 'jev-test', ms: 90 },
    { needsNotebook: 0.9, skipped: false, model: 'jev-test', ms: 80 },
    { needsNotebook: 0.1, skipped: true, model: 'jev-test', ms: 70 },
    new Error('TypeSafe could not be reached.'),
  ]
  const asked: string[] = []
  const assembled: boolean[] = []
  const instructions: string[] = []
  const { session, events, errors, producerCalls } = await makeSession({
    invokeModel: (args) => {
      instructions.push(args.instructions.map((m) => String(m.content)).join('\n'))
      args.sink.write('Ok.')
      return Promise.resolve({ text: '', content: [], steps: [], responseMessages: [] })
    },
    preflight: (message, _recent, state) => {
      asked.push(message)
      assembled.push(state.assembled)
      const verdict = verdicts.shift()!
      return verdict instanceof Error ? Promise.reject(verdict) : Promise.resolve(verdict)
    },
  })
  await session.start()
  await session.send('Write a haiku about rain.')
  const first = events.length
  await session.send('What should I focus on?')
  const second = events.length
  await session.send('Make it shorter.')
  const third = events.length
  await session.send('And after that?')
  const log = session.contextLog.map((e) => [
    e.turn,
    e.preflight ? [e.preflight.needsNotebook, e.preflight.skipped] : null,
    e.stats?.kept,
    e.stats?.reused ?? false,
    e.universe !== undefined,
  ])
  assert({
    given: 'a skip, a read, a skip, and a check that failed, in that order',
    should:
      'read nothing on the first turn and tell the model so; gather on the second; reuse the second assembly on the third with no producer call; read as usual on the fourth and log the failed check; tell the judge an assembly exists only from the third turn on',
    actual: {
      asked,
      assembled,
      events: [
        types(events.slice(0, first)),
        types(events.slice(first, second)),
        types(events.slice(second, third)),
        types(events.slice(third)),
      ],
      producerCalls,
      log,
      firstPromptSaidWhy: instructions[0]?.includes('a quick check judged it needs nothing from the notebook') ?? false,
      secondPromptReadTheNotebook: instructions[1]?.includes('a quick check judged') ?? true,
      thirdKeptTheAssembly: instructions[2] === instructions[1],
      failedCheck: errors.map((e) => [e.stage, e.message]),
    },
    expected: {
      asked: ['Write a haiku about rain.', 'What should I focus on?', 'Make it shorter.', 'And after that?'],
      assembled: [false, false, true, true],
      events: [
        ['context-skipped', 'tools', 'model-start', 'text-delta', 'turn-complete'],
        ['context-gathering', 'context-rebuilt', 'model-start', 'text-delta', 'turn-complete'],
        ['context-skipped', 'model-start', 'text-delta', 'turn-complete'],
        ['model-start', 'text-delta', 'turn-complete'],
      ],
      producerCalls: { initial: 1, evolve: 1 },
      log: [
        [1, [0.04, true], 0, false, false],
        [2, [0.9, false], 3, false, true],
        [3, [0.1, true], 3, true, false],
        [4, null, 3, true, false],
      ],
      firstPromptSaidWhy: true,
      secondPromptReadTheNotebook: false,
      thirdKeptTheAssembly: true,
      failedCheck: [['context:preflight', 'TypeSafe could not be reached.']],
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
    should: 'report the error instead of throwing, keep a failed reply entry, and log it',
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
      roles: ['user', 'assistant'],
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
  const failed = await loadResumeSession(path.join(tmp, 'autosave.md'), { snapshot: true })
  assert({
    given: 'a failed turn restored from its recovery snapshot',
    should: 'retain the failure at the same assistant entry',
    actual: [
      failed.state.conversation.length,
      failed.state.conversation.at(-1)?.error,
      failed.state.conversation.at(-1)?.content,
    ],
    expected: [2, 'overloaded', ''],
  })
  assert({
    given: 'the same failed turn read back from its snapshot',
    should: 'retain error timing without treating it as a successful latency sample',
    actual: failed.state.contextLog.at(-1)?.timing?.outcome,
    expected: 'error',
  })
  assert({
    given: "the failed turn's log entry",
    should: 'still say which model and reading budget the turn ran under',
    actual: [failed.state.contextLog.at(-1)?.settings?.model, failed.state.contextLog.at(-1)?.settings?.contextTokens],
    expected: ['claude-opus-4-6', 300_000],
  })
})

test('a failed explanation preserves the completed action and partial reply through recovery', async () => {
  let writes = 0
  let interrupted = false
  const step = (chunks: unknown[], unified: 'tool-calls' | 'stop' | 'error') => ({
    stream: simulateReadableStream<any>({
      chunks: [
        { type: 'stream-start', warnings: [] },
        ...chunks,
        {
          type: 'finish',
          finishReason: { unified, raw: undefined },
          usage: {
            inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 1, text: 1, reasoning: 0 },
          },
        },
      ],
    }),
  })
  const model = new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      const receipt = JSON.stringify(prompt).includes('example-receipt')
      if (!receipt)
        return step([{ type: 'tool-call', toolCallId: 'write-once', toolName: 'store', input: '{}' }], 'tool-calls')
      const fail = !interrupted
      interrupted = true
      return step(
        [
          { type: 'text-start', id: 'reply' },
          { type: 'text-delta', id: 'reply', delta: fail ? 'The file is saved.' : 'The recorded save succeeded.' },
          { type: 'text-end', id: 'reply' },
          ...(fail ? [{ type: 'error', error: new Error('Example connection lost') }] : []),
        ],
        fail ? 'error' : 'stop',
      )
    },
  })
  const options: Partial<ChatSessionOptions> = {
    model: { model },
    invokeModel: undefined,
    contextTokens: 0,
    tools: async () => ({
      tools: {
        store: {
          inputSchema: jsonSchema({ type: 'object', properties: {} }),
          execute: async () => {
            writes++
            return { saved: true, receipt: 'example-receipt' }
          },
        },
      },
      toolApproval: {},
    }),
  }
  const first = await makeSession(options)
  await first.session.start()
  const failed = await first.session.send('Save the example file.')
  const recovered = await loadResumeSession(path.join(first.tmp, 'autosave.md'), { snapshot: true })
  const second = await makeSession({ ...options, restore: recovered.state })
  try {
    await second.session.start()
    const retried = await second.session.send('Save the example file.')
    assert({
      given: 'a completed action followed by a provider failure, then restart and retry',
      should: 'keep its result and partial explanation so the retry answers without executing it again',
      actual: [
        failed.text,
        failed.error,
        recovered.state.conversation.at(-1)?.error,
        recovered.state.conversation.at(-1)?.content,
        JSON.stringify(recovered.state.modelMessages).includes('example-receipt'),
        writes,
        retried.text,
      ],
      expected: [
        'The file is saved.',
        'Example connection lost',
        'Example connection lost',
        'The file is saved.',
        true,
        1,
        'The recorded save succeeded.',
      ],
    })
  } finally {
    await rm(first.tmp, { recursive: true, force: true })
    await rm(second.tmp, { recursive: true, force: true })
  }
})

test('ChatSession keeps generated images through recovery, filing, branching, and later replies', async () => {
  const image = { name: 'lighthouse.png', url: '/chat/files/2026-01-27/lighthouse.png' }
  let calls = 0
  const { session, tmp } = await makeSession({
    contextTokens: 0,
    tools: async ({ onImages, onAttachments }) => {
      if (calls++ === 0) {
        onImages([image, image])
        onAttachments([{ file: image.name }])
      }
      return { tools: {}, toolApproval: {} }
    },
  })
  await session.start()
  const first = await session.send('Create a lighthouse illustration.')
  const recovered = await loadResumeSession(path.join(tmp, 'autosave.md'), { snapshot: true })
  const branch = session.stateAt(1)
  await session.send('What colors did you choose?')
  const saved = await session.end({ save: true, autoTag: false, autoRel: false, enricher: stubEnricher })
  const filed = await reload(saved!.path, tmp)
  assert({
    given: 'a tool creates an image but the model omits the image link in its reply',
    should: 'keep one preview on that reply in every durable conversation without repeating it on later replies',
    actual: {
      reported: splitChatImages(first.text!).images,
      recovered: splitChatImages(recovered.state.conversation[1]!.content).images,
      branched: splitChatImages(branch.conversation[1]!.content).images,
      filed: splitChatImages(filed.state.conversation[1]!.content).images,
      following: splitChatImages(filed.state.conversation[3]!.content).images,
      attachments: ChatDocument.fromMarkdown(await readTextFile(saved!.path)).attachments,
    },
    expected: {
      reported: [image],
      recovered: [image],
      branched: [image],
      filed: [image],
      following: [],
      attachments: [{ file: image.name }],
    },
  })
})

test('ChatSession retains completed images when the model fails after generation', async () => {
  const image = { name: 'lighthouse.png', url: '/chat/files/2026-01-27/lighthouse.png' }
  const { session, tmp } = await makeSession({
    contextTokens: 0,
    tools: async ({ onImages }) => {
      onImages([image])
      return { tools: {}, toolApproval: {} }
    },
    invokeModel: async () => {
      throw new Error('Reply interrupted')
    },
  })
  await session.start()
  const turn = await session.send('Create a lighthouse illustration.')
  const recovered = await loadResumeSession(path.join(tmp, 'autosave.md'), { snapshot: true })
  assert({
    given: 'image generation finished before the chat model failed',
    should: 'report the failure and keep the completed image in the conversation for recovery and filing',
    actual: {
      error: turn.error,
      images: splitChatImages(recovered.state.conversation[1]!.content).images,
      history: JSON.stringify(recovered.state.modelMessages).includes(image.url),
    },
    expected: { error: 'Reply interrupted', images: [image], history: true },
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
  const resume = await reload(saved!.path, first.tmp)

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

test('ChatSession - a restored conversation is on hand before it starts, and files as a new chat', async () => {
  const first = await makeSession()
  await first.session.start()
  await first.session.send('What should I focus on?')
  const saved = await first.session.end({ save: true, enricher: stubEnricher })
  const { state } = await reload(saved!.path, first.tmp)

  // A restored thread keeps its own start — here a later one, so its file is its own.
  const second = await makeSession({
    restore: state,
    timeDir: first.tmp,
    startTime: new PlainDateTime('2026-01-27 09:45'),
  })
  const turnsBeforeStart = second.session.turns.length
  const started = await second.session.start()
  const written = await second.session.end({ save: true, enricher: stubEnricher })

  assert({
    given: 'a session built from a snapshot state with no file to write back to',
    should: 'show the conversation at once, restore the recorded context on start, and file as a new chat when ended',
    actual: {
      turnsBeforeStart,
      restored: started.restored !== undefined,
      resumed: written?.resumed,
      exchanges: written?.exchanges,
      newFile: written !== null && written.path !== saved!.path,
    },
    expected: { turnsBeforeStart: 2, restored: true, resumed: false, exchanges: 1, newFile: true },
  })
})

test('ChatSession - a branch inherits the turns through a reply, files beside its parent, and keeps its lineage out of retrieval', async () => {
  const parentSession = await makeSession()
  await parentSession.session.start()
  await parentSession.session.send('What should I focus on?')
  await parentSession.session.send('And after that?')
  // The branch leaves after turn 1: the state at that turn is what it inherits.
  const prefix = parentSession.session.stateAt(1)
  const inheritedTiming = JSON.stringify(prefix.contextLog[0]?.timing)
  parentSession.session.pinTitle('Focus for the week')
  // The parent is filed before the branch saves, as the routes do when a branch ends.
  const parentPath = (await parentSession.session.fileNow())!.path
  const parentChat = path.relative(path.dirname(parentSession.tmp), parentPath)

  const branch = await makeSession({
    restore: prefix,
    parent: { chat: parentChat, turn: 1 },
    timeDir: parentSession.tmp,
    startTime: new PlainDateTime('2026-01-27 09:45'),
  })
  const inheritedBefore = branch.session.inherited
  const turnsBeforeStart = branch.session.turns.length
  await branch.session.start()
  await branch.session.send('Let us do the board prep instead.')
  const written = await branch.session.end({ save: true, enricher: stubEnricher })
  const doc = ChatDocument.fromMarkdown(await readTextFile(written!.path))
  const ownLog = (await reload(written!.path, parentSession.tmp)).own.contextLog

  assert({
    given: 'the timing history inherited by a branch and the branch file on disk',
    should: 'preserve the parent timing and file only the new turn timing with its own trace',
    actual: {
      inherited: JSON.stringify(branch.session.contextLog[0]?.timing) === inheritedTiming,
      ownTurns: ownLog.filter((entry) => entry.timing).map((entry) => entry.turn),
      ownTrace: ownLog[0]?.timing?.traceId !== prefix.contextLog[0]?.timing?.traceId,
    },
    expected: { inherited: true, ownTurns: [2], ownTrace: true },
  })

  assert({
    given: 'a two-turn parent, a branch at turn 1 with one exchange of its own, ended',
    should:
      'show the two inherited messages, file its own exchange in the folder beside the parent with the parent key',
    actual: {
      prefixMessages: prefix.conversation.length,
      prefixTurns: prefix.contextLog.map((e) => e.turn),
      inheritedBefore,
      turnsBeforeStart,
      filedBeside: written!.path.startsWith(parentPath.replace(/\.md$/, '/')),
      ownRoles: doc.conversation.map((m) => m.role),
      parent: doc.parent,
      exchanges: written!.exchanges,
    },
    expected: {
      prefixMessages: 2,
      prefixTurns: [1],
      inheritedBefore: 2,
      turnsBeforeStart: 2,
      filedBeside: true,
      ownRoles: ['user', 'assistant'],
      parent: { chat: parentChat, turn: 1 },
      exchanges: 1,
    },
  })
})

test('ChatSession.fileNow - a parent with no file gets one and goes on talking into it', async () => {
  const s = await makeSession()
  await s.session.start()
  await s.session.send('What should I focus on?')
  s.session.pinTitle('Focus for the week')
  const filed = await s.session.fileNow()
  const again = await s.session.fileNow()
  await s.session.send('And after that?')
  const ended = await s.session.end({ save: true, enricher: stubEnricher })
  const doc = ChatDocument.fromMarkdown(await readTextFile(ended!.path))

  assert({
    given: 'a live session filed mid-life under its pinned title, then given another exchange and ended',
    should:
      'file once under the pinned name, answer null the second time, and write the ending back to the same file with both exchanges',
    actual: {
      filedName: path.basename(filed!.path),
      filedTwice: again,
      resumedAfter: s.session.resume?.filePath === filed!.path,
      endedPath: ended!.path === filed!.path,
      endedResumed: ended!.resumed,
      exchanges: doc.turnCount,
      summary: doc.summary,
    },
    expected: {
      filedName: '09-30_Focus-for-the-week.md',
      filedTwice: null,
      resumedAfter: true,
      endedPath: true,
      endedResumed: true,
      exchanges: 2,
      summary: 'Focus for the week',
    },
  })
})

test('ChatSession.end - a chat filed for a branch gets its real end without another message, after a restart too', async () => {
  const enricher: SaveEnricher = {
    ...stubEnricher,
    chooseTags: async () => 'Atlas/Planning',
    writeSummary: async () => ({ by: 'Opus 5.5, High', text: '- Jane asked what to focus on.' }),
  }
  const end = { save: true, autoTag: true, writeSummary: true, enricher }
  const finished = async (file: string) => {
    const doc = await loadResumeSession(file)
    return { summary: doc.summarySection?.text ?? null, tags: doc.tags }
  }

  const live = await makeSession()
  await live.session.start()
  await live.session.send('What should I focus on?')
  live.session.pinTitle('Focus for the week')
  const filed = (await live.session.fileNow())!
  const light = await finished(filed.path)
  const closed = await live.session.end(end)

  // Rebuilt from its file, as a restart does: nothing in memory says it was filed early.
  const other = await makeSession()
  await other.session.start()
  await other.session.send('What should I focus on?')
  const otherFiled = (await other.session.fileNow())!
  const restored = await makeSession({ resume: await reload(otherFiled.path, other.tmp), timeDir: other.tmp })
  const restoredClosed = await restored.session.end(end)

  // A finished file closed again with nothing new said stays as it is.
  const reopened = await makeSession({ resume: await reload(filed.path, live.tmp), timeDir: live.tmp })
  const reclosed = await reopened.session.end(end)

  assert({
    given: 'a chat filed lightly for a branch, then closed with no message after the filing, live and after a restart',
    should: 'write its summary and tags into the same file, then leave the finished file alone on an empty close',
    actual: {
      light,
      closedPath: closed?.path === filed.path,
      closed: await finished(filed.path),
      restoredPath: restoredClosed?.path === otherFiled.path,
      restored: await finished(otherFiled.path),
      reclosed,
    },
    expected: {
      light: { summary: null, tags: [] },
      closedPath: true,
      closed: { summary: '- Jane asked what to focus on.', tags: ['Atlas/Planning'] },
      restoredPath: true,
      restored: { summary: '- Jane asked what to focus on.', tags: ['Atlas/Planning'] },
      reclosed: null,
    },
  })
})

test('ChatSession - each turn logs the model, effort, and reading budget it ran under', async () => {
  const s = await makeSession()
  await s.session.start()
  await s.session.send('What should I focus on?')
  s.session.setModel({} as ResolvedModel, {
    model: 'claude-haiku-4-5',
    preset: 'quick',
    effort: 'low',
  })
  s.session.setContextTokens(5000)
  await s.session.send('And after that?')
  assert({
    given: 'two turns, the second after the model, its effort, and the budget changed',
    should: "stamp each turn's own settings on its log entry",
    actual: s.session.contextLog.map((e) => [
      e.turn,
      e.settings?.model,
      e.settings?.preset ?? null,
      e.settings?.effort ?? null,
      e.settings?.contextTokens,
    ]),
    expected: [
      [1, 'claude-opus-4-6', null, null, 300_000],
      [2, 'claude-haiku-4-5', 'quick', 'low', 5000],
    ],
  })
})

test('ChatSession - the snapshot written before the reply carries the settings of the turn in flight', async () => {
  let autosave = ''
  let seen: [number, string, string, string, number] | undefined
  const { session, tmp } = await makeSession({
    invokeModel: async ({ sink }) => {
      // The host snapshots the message before the answer; read it as the model would run.
      const entry = (await loadResumeSession(autosave)).state.contextLog.at(-1)
      const ran = entry!.settings!
      seen = [entry!.turn, ran.model, ran.preset!, ran.effort!, ran.contextTokens!]
      sink.write('Focus on the demo.')
      return { text: '', content: [], steps: [], responseMessages: [] }
    },
  })
  autosave = path.join(tmp, 'autosave.md')
  session.snapshotOnSend = true
  await session.start()
  session.setModel({} as ResolvedModel, {
    model: 'claude-haiku-4-5',
    preset: 'quick',
    effort: 'low',
  })
  await session.send('What should I focus on?')
  assert({
    given: 'a host that snapshots the message before the answer',
    should: 'find the model, preset, effort, and budget of the turn in flight on its entry',
    actual: seen,
    expected: [1, 'claude-haiku-4-5', 'quick', 'low', 300_000],
  })
})

test('ChatSession - closing a recovered saved chat files replies made before the restart', async () => {
  const original = await makeSession({ contextTokens: 0 })
  await original.session.start()
  await original.session.send('Plan the demo.')
  const filed = await original.session.end({
    save: true,
    autoTag: false,
    autoRel: false,
    memoryDir: null,
    people: false,
    enricher: stubEnricher,
  })
  const resume = await reload(filed!.path, original.tmp)
  const active = await makeSession({ contextTokens: 0, resume })
  await active.session.start()
  await active.session.send('Add a pricing page.')
  const copy = await loadResumeSession(path.join(active.tmp, 'autosave.md'), { snapshot: true })
  const restored = await makeSession({ contextTokens: 0, resume: { ...resume, state: copy.state } })
  // No start() or new message: Save & close must retain the recovered additions.
  const saved = await restored.session.end({
    save: true,
    autoTag: false,
    autoRel: false,
    memoryDir: null,
    people: false,
    enricher: stubEnricher,
  })
  const doc = ChatDocument.fromMarkdown(await readTextFile(filed!.path))
  assert({
    given: 'a saved chat continued, snapshotted, restarted, and closed without sending another message',
    should: 'write its recovered replies and context log to the same file without runtime recovery metadata',
    actual: {
      path: saved?.path,
      aborted: Boolean(saved?.aborted),
      turns: doc.conversation,
      log: (await reload(filed!.path, original.tmp)).own.contextLog.length,
      recovery: doc.yaml['recovery'],
    },
    expected: {
      path: filed!.path,
      aborted: false,
      turns: copy.state.conversation,
      log: copy.state.contextLog.length,
      recovery: undefined,
    },
  })
})

/** Scripts one reply per call and keeps what each call received: the segment and the message roles. */
function deliveryModel() {
  const calls: Array<{ segment: string; roles: string[]; last: string }> = []
  const invokeModel: ModelInvoker = (args) => {
    const last = args.messages.at(-1)
    calls.push({
      segment: String(args.instructions[1]?.content ?? ''),
      roles: args.messages.map((m) => m.role),
      last: typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? ''),
    })
    args.sink.write('Noted.')
    return Promise.resolve({
      text: 'Noted.',
      content: [],
      steps: [],
      responseMessages: [{ role: 'assistant', content: 'Noted.' }],
    })
  }
  return { invokeModel, calls }
}

/** Turn one retrieves the roadmap; turn two moves onto Jane and retrieves her profile. */
function movingProducers() {
  return {
    produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.roadmap], query: 'q1' })),
    evolveQueries: () => Promise.resolve(ok({ queries: ['q1', 'q2'], changed: true })),
    executeQuery: () => Promise.resolve(ok({ paths: [FIX.person] })),
  }
}

test('later-turn documents arrive at the head of the user message, and the segment never changes', async () => {
  const model = deliveryModel()
  const { session, tmp } = await makeSession({
    invokeModel: model.invokeModel,
    model: { model: { provider: 'anthropic.messages', modelId: 'claude-opus-5-5' } } as unknown as ResolvedModel,
    producers: movingProducers(),
  })
  try {
    await session.start()
    await session.send('What is on the Atlas roadmap?')
    await session.send('And who is Jane Doe?')
    const second = session.contextLog[1]
    const last = model.calls[1].last
    assert({
      given: 'a second turn whose query brings a new document into the context',
      should:
        'keep the context segment byte-identical, carry the newcomer as a labeled block ahead of the question in the same user message, and log it as added',
      actual: {
        sameSegment: model.calls[1].segment === model.calls[0].segment,
        segmentHasRoadmap: model.calls[0].segment.includes('Roadmap'),
        roles: model.calls[1].roles,
        labeled: last.startsWith('[Notebook documents the assistant retrieved'),
        order: last.indexOf('Jane-Doe.md') < last.indexOf('And who is Jane Doe?'),
        repeatsRoadmap: last.includes('Roadmap.md'),
        added: second.added?.map((r) => r.path),
        history: session.stateAt(undefined, true).modelMessages?.map((m) => m.role),
      },
      expected: {
        sameSegment: true,
        segmentHasRoadmap: true,
        roles: ['user', 'assistant', 'user'],
        labeled: true,
        order: true,
        repeatsRoadmap: false,
        added: ['people/Jane-Doe.md'],
        history: ['user', 'assistant', 'user', 'assistant'],
      },
    })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

/** A model that records the provider options each call carried and answers with one word. */
function recordingModel(provider: string) {
  const seen: Array<Record<string, unknown> | undefined> = []
  const model = new MockLanguageModelV3({
    provider,
    doStream: async ({ providerOptions }) => {
      seen.push(providerOptions as Record<string, unknown> | undefined)
      return {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Noted.' },
            { type: 'text-end', id: 't' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }
    },
  })
  return { model, seen }
}

test('the conversation key reaches OpenAI as its prompt cache key, and no one else', async () => {
  const openai = recordingModel('openai.responses')
  const anthropic = recordingModel('anthropic.messages')
  const { session: a, tmp: tmpA } = await makeSession({
    invokeModel: undefined,
    cacheKey: 'thread-7',
    model: {
      model: openai.model,
      providerOptions: { openai: { reasoningEffort: 'high' } },
    } as unknown as ResolvedModel,
  })
  const { session: b, tmp: tmpB } = await makeSession({
    invokeModel: undefined,
    cacheKey: 'thread-7',
    model: { model: anthropic.model } as unknown as ResolvedModel,
  })
  try {
    await a.start()
    await a.send('What is on the Atlas roadmap?')
    await b.start()
    await b.send('What is on the Atlas roadmap?')
    assert({
      given: 'the same conversation key on an OpenAI model and on an Anthropic model',
      should: 'send it as the OpenAI prompt cache key beside the profile options, and send nothing of it to Anthropic',
      actual: {
        openai: openai.seen[0]?.['openai'],
        anthropic: anthropic.seen[0]?.['openai'] ?? null,
      },
      expected: {
        openai: { reasoningEffort: 'high', promptCacheKey: 'thread-7' },
        anthropic: null,
      },
    })
  } finally {
    await rm(tmpA, { recursive: true, force: true })
    await rm(tmpB, { recursive: true, force: true })
  }
})

test('the real size of the first request is recorded on the turn, beside the estimate', async () => {
  const recorded = recordingModel('anthropic.messages')
  const { session, tmp } = await makeSession({
    invokeModel: undefined,
    model: { model: recorded.model } as unknown as ResolvedModel,
  })
  try {
    await session.start()
    await session.send('What is on the Atlas roadmap?')
    const entry = session.contextLog.at(-1)!
    assert({
      given: 'a turn answered by a model whose finish part counted one input token',
      should: 'record that count as the request size next to the estimated context size',
      actual: { requestTokens: entry.requestTokens, estimated: typeof entry.stats?.docTokens },
      expected: { requestTokens: 1, estimated: 'number' },
    })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Reference data a host keeps current
// ---------------------------------------------------------------------------

/** Each model request as the provider would receive it: the system prompt's parts and the conversation. */
function requestRecorder() {
  const requests: { instructions: string[]; messages: string[]; said: string[] }[] = []
  const invokeModel: ModelInvoker = (args) => {
    requests.push({
      instructions: args.instructions.map((message) => String(message.content)),
      // The cache marker moves from request to request; the content is what a provider compares.
      messages: args.messages.map(({ providerOptions: _, ...message }) => JSON.stringify(message)),
      said: args.messages.filter((message) => message.role === 'user').map((message) => String(message.content)),
    })
    args.sink.write('Ok.')
    // The reply joins the history, as a provider's does, so each message stays its own.
    return Promise.resolve({
      text: '',
      content: [],
      steps: [],
      responseMessages: [{ role: 'assistant', content: 'Ok.' }],
    })
  }
  return { requests, invokeModel }
}

const NOTE_V1 =
  'Current drafts: [{"draftId":"atlas-note","draftRevision":1,"text":"Hi Jane, the Atlas note is ready."}]'
const NOTE_V2 = 'Current drafts: [{"draftId":"atlas-note","draftRevision":2,"text":"Hi Jane, Atlas is ready."}]'

test('reference data rides with the message that follows a change, and the system prompt never moves', async () => {
  const data: (string | undefined)[] = [undefined, NOTE_V1, NOTE_V1, NOTE_V2, '']
  const asked = [
    'Hello.',
    'Draft a note to Jane.',
    'Who is it for?',
    'Thanks for shortening it.',
    'I deleted that draft.',
  ]
  const model = requestRecorder()
  let turn = 0
  const { session, tmp } = await makeSession({
    contextTokens: 0,
    invokeModel: model.invokeModel,
    tools: async () => ({
      tools: {},
      toolApproval: {},
      instructions: 'How to work with drafts.',
      referenceData: data[turn++],
    }),
  })
  try {
    await session.start()
    for (const message of asked) await session.send(message)
    const { requests } = model
    const newest = (request: (typeof requests)[number]) => request.said.at(-1)!
    assert({
      given: 'a host whose data is absent, appears, stays the same, changes, then empties, over five messages',
      should:
        'send the system prompt unchanged every time, send each change once with the message after it, ahead of the person’s words, and never rewrite a message already sent',
      actual: {
        systemPrompts: new Set(requests.map((request) => JSON.stringify(request.instructions))).size,
        lastPart: requests[0]!.instructions.at(-1),
        carried: requests.map((request) =>
          [NOTE_V1, NOTE_V2, '(Nothing current.)'].filter((note) => newest(request).includes(note)),
        ),
        dataBeforeWords: newest(requests[1]!).indexOf(NOTE_V1) < newest(requests[1]!).indexOf(asked[1]!),
        onlyGrew: requests.every(
          (request, i) => i === 0 || requests[i - 1]!.messages.every((message, at) => request.messages[at] === message),
        ),
        transcript: session.turns.filter((message) => message.role === 'user').map((message) => message.content),
      },
      expected: {
        systemPrompts: 1,
        lastPart: 'How to work with drafts.',
        carried: [[], [NOTE_V1], [], [NOTE_V2], ['(Nothing current.)']],
        dataBeforeWords: true,
        onlyGrew: true,
        transcript: asked,
      },
    })
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a restarted conversation does not send reference data it already carries', async () => {
  const model = requestRecorder()
  const options: Partial<ChatSessionOptions> = {
    contextTokens: 0,
    invokeModel: model.invokeModel,
    tools: async () => ({ tools: {}, toolApproval: {}, referenceData: NOTE_V1 }),
  }
  const first = await makeSession(options)
  await first.session.start()
  await first.session.send('Draft a note to Jane.')
  const recovered = await loadResumeSession(path.join(first.tmp, 'autosave.md'), { snapshot: true })
  const second = await makeSession({ ...options, restore: recovered.state })
  try {
    await second.session.start()
    await second.session.send('Who is it for?')
    const count = (request: (typeof model.requests)[number]) => request.said.join('\n').split(NOTE_V1).length - 1
    assert({
      given: 'a process restart between two messages, with the host’s data unchanged',
      should: 'carry the one copy sent before the restart and add no second one',
      actual: model.requests.map(count),
      expected: [1, 1],
    })
  } finally {
    await rm(first.tmp, { recursive: true, force: true })
    await rm(second.tmp, { recursive: true, force: true })
  }
})

test('a session compacted for one reply says so once and sends the same reading on the next', async () => {
  const requests: string[] = []
  const model = new MockLanguageModelV3({
    provider: 'anthropic.messages',
    doStream: async ({ prompt }) => {
      requests.push(prompt.flatMap((message) => (message.role === 'system' ? [message.content] : [])).join('\n'))
      if (requests.length === 1) throw new InputTokenLimitError(9000, 1000)
      return {
        stream: simulateReadableStream<any>({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 't' },
            { type: 'text-delta', id: 't', delta: 'Here is the summary.' },
            { type: 'text-end', id: 't' },
            {
              type: 'finish',
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ],
        }),
      }
    },
  })
  const { session, events, tmp } = await makeSession({
    model: { model },
    invokeModel: undefined,
    contextTokens: 25_000,
    tools: async () => ({ tools: {}, toolApproval: {} }),
    producers: {
      produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.roadmap] })),
      // The next message's search finds the day file again, which the compaction dropped.
      evolveQueries: () => Promise.resolve(ok({ queries: ['q2'], changed: true })),
      executeQuery: () => Promise.resolve(ok({ paths: [FIX.day] })),
    },
  })
  try {
    await session.start()
    const first = await session.send('Summarize the notebook.')
    const second = await session.send('And what about the day?')
    const adjusted = events.filter((event) => event.type === 'context-adjusted')
    const day = 'time/2026/W05/01-27/day.md'
    assert({
      given: 'a first request the model cannot hold, then a second message whose search finds a dropped document',
      should:
        'compact once, count the notes it dropped, keep that document out, and send the second request with the same reading',
      actual: {
        requests: requests.length,
        compactions: adjusted.length,
        notesDropped: (first.adjustment?.compacted?.notes ?? 0) > 0,
        secondReply: [second.text, second.adjustment],
        droppedStaysOut: [requests[0]!.includes(day), requests[1]!.includes(day), requests[2]!.includes(day)],
        sameReading: requests[2] === requests[1],
        readBack: session.contextLog.at(-1)?.added?.map((doc) => doc.path) ?? [],
      },
      expected: {
        requests: 3,
        compactions: 1,
        notesDropped: true,
        secondReply: ['Here is the summary.', undefined],
        droppedStaysOut: [true, false, false],
        sameReading: true,
        readBack: [],
      },
    })
  } finally {
    await session.end({ save: false })
    await rm(tmp, { recursive: true, force: true })
  }
})

test('ChatSession - what a conversation holds after a reply is its last request and that reply', async () => {
  const step = (input: number, cacheRead: number, output: number) => ({
    usage: {
      inputTokens: input + cacheRead,
      outputTokens: output,
      totalTokens: input + cacheRead + output,
      inputTokenDetails: { noCacheTokens: input, cacheReadTokens: cacheRead, cacheWriteTokens: 0 },
      outputTokenDetails: { textTokens: output, reasoningTokens: 0 },
    },
  })
  const { session, tmp } = await makeSession({
    // A tool step, then the step that answered.
    invokeModel: async () =>
      ({
        text: 'Here is the summary.',
        content: [],
        steps: [step(900, 100, 40), step(60, 1_200, 25)],
        responseMessages: [{ role: 'assistant', content: 'Here is the summary.' }],
      }) as unknown as Awaited<ReturnType<NonNullable<ChatSessionOptions['invokeModel']>>>,
  })
  try {
    const before = session.heldTokens
    await session.start()
    await session.send('What is on the Atlas roadmap?')
    const saved = await loadResumeSession(path.join(tmp, 'autosave.md'), { baseDir: BASE_DIR, snapshot: true })
    assert({
      given: 'a reply whose last model request read 1,260 tokens and wrote 25, after a tool step of another size',
      should: 'hold nothing before the reply and 1,285 after it, saved on the turn',
      actual: { before, after: session.heldTokens, saved: saved.state.contextLog.at(-1)?.heldTokens },
      expected: { before: null, after: 1_285, saved: 1_285 },
    })
  } finally {
    await session.end({ save: false })
    await rm(tmp, { recursive: true, force: true })
  }
})

test('ChatSession - a chat saved before the count was kept answers with its last recorded request', async () => {
  const { session, tmp } = await makeSession({
    restore: {
      conversation: [
        { role: 'user', content: 'What is on the Atlas roadmap?' },
        { role: 'assistant', content: 'The March demo.' },
      ],
      universePaths: [],
      queries: [],
      lastTurn: 1,
      contextLog: [{ turn: 1, queries: [], requestTokens: 18_204 }],
    },
  })
  try {
    assert({
      given: 'a restored chat whose log holds the size of its last turn’s first request and nothing newer',
      should: 'answer with that size, before the session has even started',
      actual: session.heldTokens,
      expected: 18_204,
    })
  } finally {
    await session.end({ save: false })
    await rm(tmp, { recursive: true, force: true })
  }
})
