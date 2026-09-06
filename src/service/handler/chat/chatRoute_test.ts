import { existsSync } from 'node:fs'
import { readFile, readdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { generateText, jsonSchema } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { withCommandRun } from '#commands/lib/core/commandLog.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { exists, makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import type { ProducerResult } from '#shared/models/Chat/ChatContext/mod.ts'
import type { ModelInvoker } from '#shared/models/Chat/ChatEngine/mod.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { ChatSessionEvent } from '#shared/models/Chat/ChatSession/mod.ts'
import { loadResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import type { SaveEnricher } from '#shared/models/Chat/ChatStore/save.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { configureTiming } from '#shared/timing/log.ts'
import { setTimingSink, withTimingEnvironment, type TimingEvent } from '#shared/timing/mod.ts'
import { parseTimingLog } from '#shared/timing/read.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import { approvalCard } from './approvalCard.ts'
import type { ChatRoutesOptions, ChatSessionFactory, ChatSettingsHost, ThreadSummary, ToolOutputEvent } from './mod.ts'

setUserSpeakerLabel('Jane')

// Real sessions over ChatContext's fixture notebook, with the model, service
// fetch, clock, and error log scripted — the route layer is what's under test.
const BASE_DIR = path.join(
  import.meta.dirname!,
  '..',
  '..',
  '..',
  '_shared-ts',
  'models',
  'Chat',
  'ChatContext',
  'fixtures',
  'notebook',
)
const TODAY = new PlainDate('2026-01-27')
const START = new PlainDateTime('2026-01-27 09:30')
const STAMP = new PlainDateTime('2026-01-27 09:31')
const FIX = {
  day: path.join(BASE_DIR, 'time/2026/W05/01-27/day.md'),
  goal: path.join(BASE_DIR, 'goals/2026.md'),
  roadmap: path.join(BASE_DIR, 'projects/Atlas/Roadmap.md'),
}
const AMBIENT = { today: { date: '2026-01-27', dayOfWeek: 'Tuesday' }, health: [], prices: [] }

const ok = <T>(value: T): ProducerResult<T> => ({ ok: true, value })

async function fixtureDoc(absPath: string): Promise<{ doc: Document; path: string }> {
  return { doc: Document.fromMarkdown(await readTextFile(absPath)), path: absPath }
}

function fetchFake(sets: { today: string[]; goals: string[] }) {
  return async (query: string): Promise<Array<{ doc: Document; path: string }>> => {
    let paths: string[] = []
    if (query.includes('dateGte') || query.includes('decisions') || query.includes('ai/memory')) paths = []
    else if (query.includes('goals')) paths = sets.goals
    else paths = sets.today
    return await Promise.all(paths.map(fixtureDoc))
  }
}

const EMPTY = { text: '', content: [], steps: [], responseMessages: [] }

function streamingModel(pieces: string[]): ModelInvoker {
  return (args) => {
    for (const piece of pieces) args.sink.write(piece)
    return Promise.resolve(EMPTY)
  }
}

const stubEnricher: SaveEnricher = {
  summarize: async () => 'Atlas Demo Focus',
  chooseTags: async () => undefined,
  chooseRel: async () => undefined,
}

const CHOICES = [
  { name: 'test-thinking', label: 'Test Thinking', provider: 'Test', roles: ['Thinking'] },
  { name: 'test-quick', label: 'Test Quick', provider: 'Test', roles: ['Quick'] },
]

const settingsHost: ChatSettingsHost = {
  defaultModel: 'test-thinking',
  defaultContextTokens: 300_000,
  choices: () => CHOICES,
  resolve: (name) => {
    if (!CHOICES.some((c) => c.name === name)) throw new Error(`Unknown model profile: "${name}"`)
    return { model: {} as ResolvedModel, profile: { provider: 'test', model: name } }
  },
  // The test profiles are named after their models, so a logged model is its own profile.
  profileFor: (model) => (CHOICES.some((c) => c.name === model) ? model : undefined),
}

/** The catalog with a model whose host serves 131,072 tokens a request — Qwen on Cerebras. */
const SMALL_WINDOW = 131_072
const smallWindowHost: ChatSettingsHost = {
  ...settingsHost,
  choices: () => [
    ...CHOICES,
    { name: 'test-small', label: 'Test Small', provider: 'Test', roles: [], contextWindow: SMALL_WINDOW },
  ],
  resolve: (name) => {
    if (name === 'test-small') {
      return { model: {} as ResolvedModel, profile: { provider: 'test', model: name }, contextWindow: SMALL_WINDOW }
    }
    return settingsHost.resolve(name)
  },
}

async function testHost(
  over: {
    invokeModel?: ModelInvoker
    initialQuery?: string
    /** Hands the test the host's report channel — what a tool's command output would reach */
    capture?: (report: (event: ChatSessionEvent | ToolOutputEvent) => void) => void
    /** The key every card carries — a go can then stand for the session */
    sessionKey?: string
    /** Collects the decisions the host's approval handler returns */
    decisions?: Array<{ approved: boolean; always?: boolean }>
    /** Another catalog behind the settings routes */
    settings?: ChatSettingsHost
  } = {},
): Promise<ChatRoutesOptions & { tmp: string }> {
  const tmp = await makeTempDir({ prefix: 'sky-chat-route-' })
  const createSession: ChatSessionFactory = (id, onEvent, prefs, ask, restore) =>
    Promise.resolve(
      (over.capture?.(onEvent),
      new ChatSession({
        today: TODAY,
        startTime: restore?.startTime ?? START,
        days: 7,
        baseDir: BASE_DIR,
        timeDir: tmp,
        contextTokens: prefs.contextTokens,
        resume: restore?.resume ?? null,
        restore: restore?.resume ? undefined : restore?.state,
        parent: restore?.resume ? null : (restore?.parent ?? null),
        model: {} as ResolvedModel,
        profile: { provider: 'claude', model: prefs.profile ?? 'claude-opus-4-6' },
        producers: {
          produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.roadmap], query: over.initialQuery })),
          evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
          executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
        },
        ambient: AMBIENT,
        systemPrompt: () => Promise.resolve('You are a test assistant.'),
        tools: () => Promise.resolve({ tools: {}, toolApproval: {} }),
        approvalHandler: async ({ toolName, input }) => {
          const decision = await ask({ toolName, lines: approvalCard(toolName, input), sessionKey: over.sessionKey })
          over.decisions?.push(decision)
          return decision
        },
        autosavePath: path.join(tmp, `${id}.autosave.md`),
        onEvent,
        invokeModel: over.invokeModel ?? streamingModel(['Focus on ', 'the demo.']),
        fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
        now: () => Promise.resolve(STAMP),
        logError: () => Promise.resolve(),
      })),
    )
  return {
    createSession,
    snapshotPath: (id: string) => path.join(tmp, `${id}.autosave.md`),
    settings: over.settings ?? settingsHost,
    endDefaults: { enricher: stubEnricher },
    timeDir: tmp,
    tmp,
  }
}

async function getJson(app: App, url: string): Promise<Record<string, any>> {
  return (await (await app.request(url)).json()) as Record<string, any>
}

function appWith(host: ChatRoutesOptions) {
  return createTestHttpApp([path.join(BASE_DIR, 'time')], { chat: host })
}

type App = ReturnType<typeof createTestHttpApp>

function post(app: App, url: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

/** A page reads its composer choices, then includes all of them with Send. */
async function send(app: App, url: string, body: { message: string }): Promise<Response> {
  const settings = await getJson(app, url.replace(/\/messages$/, '/settings'))
  return post(app, url, {
    ...body,
    profile: settings.model.current,
    contextTokens: settings.contextTokens,
    saves: settings.saves,
  })
}

interface Frame {
  event: string
  data: Record<string, unknown> | null
}

/** The frames of a finished SSE body, in order. */
function parseSSE(text: string): Frame[] {
  return text
    .split('\n\n')
    .filter((frame) => frame.trim().length > 0)
    .map((frame) => {
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      return { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : null }
    })
}

test({ name: 'chat route - a message needs a body' }, async () => {
  const app = appWith(await testHost())
  const response = await send(app, 'http://localhost/chat/t0/messages', { message: '   ' })

  assert({
    given: 'a blank message',
    should: 'refuse it before a session is built',
    actual: response.status,
    expected: 400,
  })
})

test('chat route - reply timing includes the first context load and survives a page reload', async () => {
  const host = await testHost()
  const factory = host.createSession
  let now = 0
  host.createSession = async (...args) => {
    now += 25
    const session = await factory(...args)
    const start = session.start.bind(session)
    session.start = async () => {
      now += 50
      return start()
    }
    return session
  }
  const events: TimingEvent[] = []
  await withTimingEnvironment({ now: () => now, sink: (event) => events.push(event) }, async () => {
    const app = appWith(host)
    const response = await send(app, 'http://localhost/chat/timing-test/messages', { message: 'Find the mock roadmap' })
    const frames = parseSSE(await response.text())
    const turn = frames.find((frame) => frame.event === 'turn')?.data
    const body = await getJson(app, 'http://localhost/chat/timing-test')
    const snapshot = await loadResumeSession(path.join(host.tmp, 'timing-test.autosave.md'))
    const roots = events.filter((event) => event.event === 'timing-end' && event.span.kind === 'turn')
    assert({
      given: 'a first reply that spends 25 ms creating its thread and 50 ms initializing its context',
      should: 'include that initialization in one reply trace and retain its displayed summary',
      actual: {
        wall: (turn?.timing as { wallMs: number })?.wallMs,
        roots: roots.length,
        outcome: roots[0]?.span.outcome,
        summary: typeof turn?.timingText === 'string',
        reloaded: body.timings?.[0]?.text === turn?.timingText,
        saved: snapshot.state.contextLog[0]?.timing?.wallMs,
      },
      expected: { wall: 75, roots: 1, outcome: 'success', summary: true, reloaded: true, saved: 75 },
    })
  })
})

test('chat route - web tool and command timings persist automatically across replies', async () => {
  const model = new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'tool-call', toolCallId: 'mock-lookup', toolName: 'notebook_query', input: '{}' }],
      finishReason: { unified: 'tool-calls', raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 2, text: 2, reasoning: 0 },
      },
      warnings: [],
    }),
  })
  const host = await testHost({
    invokeModel: async ({ sink }) => {
      // No per-call telemetry settings: exercise the same global SDK hooks as production.
      await generateText({
        model,
        prompt: 'Synthetic timing request that must stay out of logs',
        tools: {
          notebook_query: {
            inputSchema: jsonSchema({ type: 'object', properties: {} }),
            execute: () =>
              withCommandRun({ command: 'mock:lookup', depth: 0 }, async () => ({
                status: 'success',
                text: 'Synthetic timing result that must stay out of logs',
              })),
          },
        },
      })
      sink.write('Done.')
      return EMPTY
    },
  })
  const dir = path.join(host.tmp, 'timing')
  try {
    configureTiming({ source: 'service', dir })
    const app = appWith(host)
    for (let i = 0; i < 2; i++) {
      const response = await send(app, 'http://localhost/chat/logged-timing/messages', { message: 'Look up Atlas' })
      await response.text()
    }
    // Read disk, not the thread's in-memory summary or an injected event collector.
    const raw = (await Promise.all((await readdir(dir)).map((file) => readFile(path.join(dir, file), 'utf8')))).join(
      '\n',
    )
    const records = parseTimingLog(raw)
    const snapshot = await loadResumeSession(path.join(host.tmp, 'logged-timing.autosave.md'))
    const archived = snapshot.state.contextLog.flatMap((entry) => entry.timing?.spans ?? [])
    const turns = records.filter((record) => record.kind === 'turn')
    const tools = records.filter((record) => record.kind === 'tool')
    const commands = records.filter((record) => record.kind === 'command')
    const models = records.filter((record) => record.kind === 'model')
    const lines = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    assert({
      given: 'two normal web replies that run an SDK tool and a nested command',
      should: 'persist one sample per call with names, outcomes, model metadata, and trace relationships',
      actual: {
        counts: [turns.length, tools.length, commands.length, models.length],
        traces: new Set(turns.map((turn) => turn.traceId)).size,
        toolNames: tools.map((tool) => tool.name),
        nested: commands.every((command) =>
          tools.some((tool) => tool.spanId === command.parentSpanId && tool.traceId === command.traceId),
        ),
        measured: records.every((record) => Number.isFinite(record.durationMs) && record.outcome === 'success'),
        modelMetadata: models.every((record) => !!record.provider && !!record.model && record.usage?.input === 10),
        envelopes: lines.every(
          (line) => line.version === 1 && line.source === 'service' && typeof line.ts === 'string',
        ),
        leaked: raw.includes('Synthetic timing') || raw.includes('Look up Atlas'),
        archivedCalls: archived
          .filter((span) => span.kind === 'tool' || span.kind === 'command')
          .map((span) => span.spanId)
          .sort(),
      },
      expected: {
        counts: [2, 2, 2, 2],
        traces: 2,
        toolNames: ['notebook_query', 'notebook_query'],
        nested: true,
        measured: true,
        modelMetadata: true,
        envelopes: true,
        leaked: false,
        archivedCalls: records
          .filter((span) => span.kind === 'tool' || span.kind === 'command')
          .map((span) => span.spanId)
          .sort(),
      },
    })
  } finally {
    setTimingSink(() => {})
    await rm(host.tmp, { recursive: true, force: true })
  }
})

test('chat route - full GraphQL queries stream before the reply and survive read-back and reuse', async () => {
  const query = 'query Context {\n  projects(name: "Atlas") { path }\n}'
  let app: App
  let whileWorking: unknown
  const host = await testHost({
    initialQuery: query,
    invokeModel: async (args) => {
      whileWorking = (await getJson(app, 'http://localhost/chat/queries')).queries
      args.sink.write('Here is the context.')
      return EMPTY
    },
  })
  app = appWith(host)
  try {
    const first = parseSSE(
      await (await send(app, 'http://localhost/chat/queries/messages', { message: 'Find Atlas' })).text(),
    )
    const second = parseSSE(
      await (await send(app, 'http://localhost/chat/queries/messages', { message: 'Tell me more' })).text(),
    )
    const thread = await getJson(app, 'http://localhost/chat/queries')
    const context = await getJson(app, 'http://localhost/chat/queries/context')
    assert({
      given: 'a full query, followed by a turn that reuses its context',
      should: 'expose exact text in the stream, the busy thread, the reloaded thread, and the context panel',
      actual: {
        frames: [first, second].map((frames) => frames.find((frame) => frame.event === 'context-queries')?.data),
        beforeReply:
          first.findIndex((frame) => frame.event === 'context-queries') <
          first.findIndex((frame) => frame.event === 'model-start'),
        whileWorking,
        reloaded: thread.queries,
        panel: context.log.map((entry: { queries: string[] }) => entry.queries),
      },
      expected: {
        frames: [1, 2].map((turn) => ({ type: 'context-queries', turn, queries: [query] })),
        beforeReply: true,
        whileWorking: [1, 2].map((turn) => ({ turn, queries: [query] })),
        reloaded: [1, 2].map((turn) => ({ turn, queries: [query] })),
        panel: [[query], [query]],
      },
    })
  } finally {
    await rm(host.tmp, { recursive: true, force: true })
  }
})

test({ name: 'chat route - the first message starts the session and streams the turn' }, async () => {
  const app = appWith(await testHost())
  const response = await send(app, 'http://localhost/chat/t1/messages', { message: 'What should I focus on?' })
  const frames = parseSSE(await response.text())

  assert({
    given: 'the first message on a new thread',
    should: 'answer as an event stream',
    actual: { status: response.status, type: response.headers.get('content-type')?.split(';')[0] },
    expected: { status: 200, type: 'text/event-stream' },
  })

  assert({
    given: 'the stream',
    should: 'carry the session start, then the turn events in order, closed by the turn report',
    actual: frames.map((f) => f.event),
    expected: [
      'session-started',
      'context-gathering',
      'context-rebuilt',
      'tools',
      'model-start',
      'text-delta',
      'text-delta',
      'turn-complete',
      'turn',
    ],
  })

  const rebuilt = frames.find((f) => f.event === 'context-rebuilt')?.data?.report as Record<string, unknown>
  assert({
    given: 'the context-rebuilt frame',
    should: 'carry the counts only — never the rendered markdown or the per-document records',
    actual: { keys: Object.keys(rebuilt).sort(), collectionSize: rebuilt.collectionSize },
    expected: { keys: ['collectionSize', 'recorded', 'stats', 'turn'], collectionSize: 3 },
  })

  assert({
    given: 'the closing turn frame',
    should: 'not repeat the rebuild that already went out as its own frame',
    actual: Object.keys(frames.at(-1)?.data?.context as Record<string, unknown>),
    expected: ['errors'],
  })

  assert({
    given: 'the closing turn frame',
    should: 'carry the streamed reply, deltas concatenated',
    actual: {
      text: frames.at(-1)?.data?.text,
      deltas: frames.filter((f) => f.event === 'text-delta').map((f) => f.data?.text),
    },
    expected: { text: 'Focus on the demo.', deltas: ['Focus on ', 'the demo.'] },
  })
})

test({ name: 'chat route - a thread can be read back, and an unknown one is 404' }, async () => {
  const app = appWith(await testHost())
  await (await send(app, 'http://localhost/chat/t2/messages', { message: 'What should I focus on?' })).text()

  const known = await app.request('http://localhost/chat/t2')
  const body = (await known.json()) as { id: string; turns: Array<{ role: string }>; documents: number }
  assert({
    given: 'a thread after one exchange',
    should: 'return its conversation and context size',
    actual: { status: known.status, id: body.id, roles: body.turns.map((t) => t.role), documents: body.documents },
    expected: { status: 200, id: 't2', roles: ['user', 'assistant'], documents: 3 },
  })

  assert({
    given: 'a thread id nobody has messaged',
    should: 'be 404',
    actual: (await app.request('http://localhost/chat/nobody')).status,
    expected: 404,
  })
})

test({ name: 'chat route - one turn at a time per thread' }, async () => {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const gated: ModelInvoker = async (args) => {
    await gate
    args.sink.write('done')
    return EMPTY
  }
  const app = appWith(await testHost({ invokeModel: gated }))

  // The first response returns as soon as its stream opens; the turn is still running behind it.
  const first = await send(app, 'http://localhost/chat/t3/messages', { message: 'first' })
  const second = await send(app, 'http://localhost/chat/t3/messages', { message: 'second' })
  release()
  await first.text()

  assert({
    given: 'a second message while the first turn is still running',
    should: 'refuse it rather than queue it',
    actual: { first: first.status, second: second.status },
    expected: { first: 200, second: 409 },
  })
})

test({ name: 'chat route - the day lists its threads with what each is doing' }, async () => {
  // One gate per model call: the first thread's turn is released at once,
  // the second's is held so the list sees it mid-turn. Each call also
  // signals that it was reached, so the test waits on the model, not a timer.
  const releases: Array<() => void> = []
  const gates = [0, 1].map(() => new Promise<void>((resolve) => releases.push(resolve)))
  const reached: Array<() => void> = []
  const arrivals = [0, 1].map(() => new Promise<void>((resolve) => reached.push(resolve)))
  let call = 0
  const gated: ModelInvoker = async (args) => {
    const n = call++
    reached[n]()
    await gates[n]
    args.sink.write('Focus on the demo.')
    return EMPTY
  }
  const app = appWith(await testHost({ invokeModel: gated }))

  releases[0]()
  await (await send(app, 'http://localhost/chat/t6/messages', { message: 'What should I focus on today?' })).text()
  const second = await send(app, 'http://localhost/chat/t7/messages', { message: 'And the pricing page?' })
  await arrivals[1]

  const listed = (await (await app.request('http://localhost/chat')).json()) as { threads: ThreadSummary[] }
  const byId = Object.fromEntries(listed.threads.map((t) => [t.id, t]))
  assert({
    given: 'one finished thread and one still waiting on the model',
    should: 'summarize each — title from the first message, state, the last line, message count',
    actual: {
      t6: {
        title: byId.t6?.title,
        state: byId.t6?.state,
        line: byId.t6?.line,
        turns: byId.t6?.turns,
        busy: byId.t6?.busy,
      },
      t7: { title: byId.t7?.title, state: byId.t7?.state, busy: byId.t7?.busy },
      newestFirst: listed.threads[0]?.id,
    },
    expected: {
      t6: { title: 'What should I focus on today?', state: 'done', line: 'Focus on the demo.', turns: 2, busy: false },
      t7: { title: 'And the pricing page?', state: 'thinking', busy: true },
      newestFirst: 't7',
    },
  })

  releases[1]()
  await second.text()
  const after = (await (await app.request('http://localhost/chat')).json()) as { threads: ThreadSummary[] }
  assert({
    given: 'the second thread once its turn lands',
    should: 'read as done with its reply as the line',
    actual: after.threads.find((t) => t.id === 't7')?.state,
    expected: 'done',
  })
})

test({ name: 'chat route - ending a thread files it or drops it' }, async () => {
  const host = await testHost()
  const app = appWith(host)

  await (await send(app, 'http://localhost/chat/t4/messages', { message: 'What should I focus on?' })).text()
  const dropped = (await (await post(app, 'http://localhost/chat/t4/end', { save: false })).json()) as {
    saved: unknown
  }
  assert({
    given: 'a thread ended without saving',
    should: 'report nothing saved and forget the thread',
    actual: { saved: dropped.saved, after: (await app.request('http://localhost/chat/t4')).status },
    expected: { saved: null, after: 404 },
  })

  await (await send(app, 'http://localhost/chat/t5/messages', { message: 'What should I focus on?' })).text()
  const filed = (await (await post(app, 'http://localhost/chat/t5/end', {})).json()) as {
    saved: { path: string; exchanges: number } | null
  }
  assert({
    given: 'a thread ended with the default (save)',
    should: 'file the transcript through the store under the host tmp dir',
    actual: {
      name: filed.saved ? path.basename(filed.saved.path) : null,
      underHost: filed.saved?.path.startsWith(host.tmp),
      exchanges: filed.saved?.exchanges,
    },
    expected: { name: '09-30_Atlas-Demo-Focus.md', underHost: true, exchanges: 1 },
  })

  assert({
    given: 'a thread that no longer exists',
    should: 'refuse to end again',
    actual: (await post(app, 'http://localhost/chat/t5/end', {})).status,
    expected: 404,
  })
})

test(
  { name: 'chat route - a thread that will not be kept leaves no crash copy and is dropped at its end' },
  async () => {
    const host = await testHost()
    const app = appWith(host)
    const copy = (id: string) => existsSync(path.join(host.tmp, `${id}.autosave.md`))

    await post(app, 'http://localhost/chat/t8/settings', { saves: false })
    const before = await getJson(app, 'http://localhost/chat/t8/settings')
    await (await send(app, 'http://localhost/chat/t8/messages', { message: 'What should I focus on?' })).text()
    await (await send(app, 'http://localhost/chat/t9/messages', { message: 'What should I focus on?' })).text()
    const list = await getJson(app, 'http://localhost/chat')
    assert({
      given: 'a thread set not to save before its first message, beside one that saves',
      should: 'answer the setting, keep no copy after its turn while the other keeps one, and say so in the list',
      actual: {
        saves: before.saves,
        copies: { t8: copy('t8'), t9: copy('t9') },
        listed: Object.fromEntries(list.threads.map((t: { id: string; saves: boolean }) => [t.id, t.saves])),
      },
      expected: { saves: false, copies: { t8: false, t9: true }, listed: { t8: false, t9: true } },
    })

    const ended = (await (await post(app, 'http://localhost/chat/t8/end', {})).json()) as { saved: unknown }
    assert({
      given: 'ending it with no say either way',
      should: 'drop it: nothing saved, thread gone',
      actual: { saved: ended.saved, after: (await app.request('http://localhost/chat/t8')).status },
      expected: { saved: null, after: 404 },
    })
  },
)

test({ name: 'chat route - keeping can be turned off and on between turns' }, async () => {
  const host = await testHost()
  const app = appWith(host)
  const copy = () => existsSync(path.join(host.tmp, 't10.autosave.md'))

  await (await send(app, 'http://localhost/chat/t10/messages', { message: 'What should I focus on?' })).text()
  const kept = copy()
  await post(app, 'http://localhost/chat/t10/settings', { saves: false })
  const dropped = copy()
  await post(app, 'http://localhost/chat/t10/settings', { saves: true })
  await (await send(app, 'http://localhost/chat/t10/messages', { message: 'And then?' })).text()
  assert({
    given: 'a saving thread turned off, then on again before its next turn',
    should: 'have its copy, lose it at once, and write it again with the next turn',
    actual: { kept, dropped, again: copy() },
    expected: { kept: true, dropped: false, again: true },
  })
  assert({
    given: 'a setting that is neither true nor false',
    should: 'be refused',
    actual: (await post(app, 'http://localhost/chat/t10/settings', { saves: 'yes' })).status,
    expected: 400,
  })
})

test({ name: 'chat route - a reply carries its token counts, on the stream and on the thread' }, async () => {
  const invokeModel: ModelInvoker = (args) => {
    args.sink.write('Focus on the demo.')
    return Promise.resolve({
      ...EMPTY,
      text: 'Focus on the demo.',
      usage: {
        inputTokens: 5600,
        inputTokenDetails: { noCacheTokens: 2, cacheReadTokens: 3654, cacheWriteTokens: 536 },
        outputTokens: 46,
        outputTokenDetails: { textTokens: 46, reasoningTokens: 0 },
        totalTokens: 5646,
      },
    })
  }
  const app = appWith(await testHost({ invokeModel }))
  const frames = parseSSE(
    await (await send(app, 'http://localhost/chat/t11/messages', { message: 'What should I focus on?' })).text(),
  )
  const turn = frames.find((f) => f.event === 'turn')?.data as { usage?: unknown; model?: string }
  const thread = await getJson(app, 'http://localhost/chat/t11')
  assert({
    given: 'a model that reports its usage',
    should: 'put the four counts and the profile on the turn frame, and keep them with the reply on the thread',
    actual: { frame: { usage: turn.usage, model: turn.model }, thread: thread.usage },
    expected: {
      frame: { usage: { input: 2, cacheRead: 3654, cacheWrite: 536, output: 46 }, model: 'test-thinking' },
      thread: [{ at: 1, input: 2, cacheRead: 3654, cacheWrite: 536, output: 46, model: 'test-thinking' }],
    },
  })
})

interface ContextBody {
  turn: number
  documents: number
  kept: Array<{ path: string; tokens: number; pinned?: true }>
  cut: Array<{ path: string; tokens: number; cut?: string }>
}

test({ name: 'chat route - the context can be read, and shaped by hand' }, async () => {
  const app = appWith(await testHost())
  const url = 'http://localhost/chat/t6/context'
  assert({
    given: 'a thread nobody has messaged',
    should: 'have no context to show',
    actual: (await app.request(url)).status,
    expected: 404,
  })

  await (await send(app, 'http://localhost/chat/t6/messages', { message: 'What should I focus on?' })).text()
  const before = (await (await app.request(url)).json()) as ContextBody
  assert({
    given: 'a thread after one exchange',
    should: 'list every document the model saw, with its tokens, and nothing cut',
    actual: {
      kept: before.kept.map((k) => k.path).sort(),
      tokens: before.kept.every((k) => k.tokens > 0),
      cut: before.cut,
      documents: before.documents,
    },
    expected: {
      kept: ['goals/2026.md', 'projects/Atlas/Roadmap.md', 'time/2026/W05/01-27/day.md'],
      tokens: true,
      cut: [],
      documents: 3,
    },
  })

  const excluded = (await (
    await post(app, url, { action: 'exclude', path: 'projects/Atlas/Roadmap.md' })
  ).json()) as ContextBody
  assert({
    given: 'a document kept out by hand',
    should: 'be cut with that reason, at once, and leave the rest in',
    actual: { kept: excluded.kept.map((k) => k.path).sort(), cut: excluded.cut.map((c) => [c.path, c.cut]) },
    expected: {
      kept: ['goals/2026.md', 'time/2026/W05/01-27/day.md'],
      cut: [['projects/Atlas/Roadmap.md', 'excluded by you']],
    },
  })

  const pinned = (await (
    await post(app, url, { action: 'pin', path: 'projects/Atlas/Roadmap.md' })
  ).json()) as ContextBody
  assert({
    given: 'the same document pinned back in',
    should: 'be kept, marked pinned, with nothing cut',
    actual: {
      roadmap: pinned.kept.find((k) => k.path === 'projects/Atlas/Roadmap.md')?.pinned,
      cut: pinned.cut.length,
    },
    expected: { roadmap: true, cut: 0 },
  })

  const released = (await (
    await post(app, url, { action: 'release', path: 'projects/Atlas/Roadmap.md' })
  ).json()) as ContextBody
  assert({
    given: 'the pin withdrawn',
    should: 'leave the scorer to decide again — kept, no longer pinned',
    actual: released.kept.find((k) => k.path === 'projects/Atlas/Roadmap.md')?.pinned,
    expected: undefined,
  })

  assert({
    given: 'a verb the context does not know, and a file that does not exist',
    should: 'refuse both as bad requests',
    actual: [
      (await post(app, url, { action: 'burn', path: 'goals/2026.md' })).status,
      (await post(app, url, { action: 'pin', path: 'projects/Nowhere/Missing.md' })).status,
    ],
    expected: [400, 400],
  })
})

test(
  { name: 'chat route - settings before the first message are the defaults; a choice waits for the thread' },
  async () => {
    const app = appWith(await testHost())
    const before = await getJson(app, 'http://localhost/chat/s1/settings')
    assert({
      given: 'a thread nobody has messaged',
      should: 'answer the host defaults, with nothing in context yet',
      actual: {
        current: before.model.current,
        fallback: before.model.default,
        choices: before.model.choices.map((c: { name: string }) => c.name),
        contextTokens: before.contextTokens,
        kept: before.kept,
        documents: before.documents,
      },
      expected: {
        current: 'test-thinking',
        fallback: 'test-thinking',
        choices: ['test-thinking', 'test-quick'],
        contextTokens: 300_000,
        kept: null,
        documents: null,
      },
    })

    const chosen = await post(app, 'http://localhost/chat/s1/settings', { profile: 'test-quick', contextTokens: 5000 })
    const chosenBody = (await chosen.json()) as { model: { current: string }; contextTokens: number }
    assert({
      given: 'a model and a budget chosen before the first message',
      should: 'be kept for the thread',
      actual: { status: chosen.status, current: chosenBody.model.current, contextTokens: chosenBody.contextTokens },
      expected: { status: 200, current: 'test-quick', contextTokens: 5000 },
    })

    await (await send(app, 'http://localhost/chat/s1/messages', { message: 'What should I focus on?' })).text()
    const after = await getJson(app, 'http://localhost/chat/s1/settings')
    const context = await getJson(app, 'http://localhost/chat/s1/context')
    assert({
      given: 'the first message',
      should: 'build the session with the chosen model and budget, which the turn log records',
      actual: {
        current: after.model.current,
        contextTokens: after.contextTokens,
        kept: after.kept,
        documents: after.documents,
        budget: context.stats.budget,
        log: context.log.map((e: { kind: string; found?: number; when: string | null }) => [e.kind, e.found, e.when]),
      },
      expected: {
        current: 'test-quick',
        contextTokens: 5000,
        kept: 3,
        documents: 3,
        budget: 5000,
        log: [['seed', 3, '09:31']],
      },
    })

    await (await send(app, 'http://localhost/chat/s1/messages', { message: 'And then?' })).text()
    const again = await getJson(app, 'http://localhost/chat/s1/context')
    assert({
      given: 'a second message whose queries did not change',
      should: 'add a quiet entry to the story',
      actual: again.log.map((e: { kind: string }) => e.kind),
      expected: ['seed', 'same'],
    })
  },
)

test({ name: 'chat route - settings refuse what the host cannot take' }, async () => {
  const app = appWith(await testHost())
  const unknown = await post(app, 'http://localhost/chat/s2/settings', { profile: 'nope' })
  const negative = await post(app, 'http://localhost/chat/s2/settings', { contextTokens: -1 })
  const text = await post(app, 'http://localhost/chat/s2/settings', { contextTokens: '5k' })
  const empty = await post(app, 'http://localhost/chat/s2/settings', {})
  const kept = await getJson(app, 'http://localhost/chat/s2/settings')
  assert({
    given: 'an unknown model, a negative budget, a budget that is not a number, and nothing at all',
    should: 'refuse each and leave the defaults standing',
    actual: [unknown.status, negative.status, text.status, empty.status, kept.model.current, kept.contextTokens],
    expected: [400, 400, 400, 400, 'test-thinking', 300_000],
  })
})

test('chat route - every message applies its own settings before the model runs', async () => {
  let session: ChatSession
  const seen: Array<{ model: string; budget: number; snapshot: boolean }> = []
  const host = await testHost({
    invokeModel: async ({ sink }) => {
      seen.push({
        model: session.modelProfile.model,
        budget: session.contextTokens,
        snapshot: existsSync(path.join(host.tmp, 'request.autosave.md')),
      })
      sink.write('Done.')
      return EMPTY
    },
  })
  const create = host.createSession
  const createdWith: unknown[] = []
  host.createSession = async (...args) => {
    createdWith.push({ ...args[2] })
    session = await create(...args)
    return session
  }
  const app = appWith(host)
  // A stale setting on the service cannot override the next message.
  await post(app, 'http://localhost/chat/request/settings', { profile: 'test-thinking', contextTokens: 300_000 })
  const firstPrefs = { profile: 'test-quick', contextTokens: 5000, saves: true }
  const first = parseSSE(
    await (
      await post(app, 'http://localhost/chat/request/messages', {
        message: 'Plan the demo.',
        ...firstPrefs,
      })
    ).text(),
  )
  const second = parseSSE(
    await (
      await post(app, 'http://localhost/chat/request/messages', {
        message: 'Now close the notebook.',
        profile: 'test-thinking',
        contextTokens: 0,
        saves: false,
      })
    ).text(),
  )
  const settings = await getJson(app, 'http://localhost/chat/request/settings')
  assert({
    given: 'explicit choices on a new thread, then different choices on the live thread',
    should:
      'construct and invoke with those choices, snapshot a kept thread before invoking, and remove a discarded one',
    actual: {
      createdWith,
      seen,
      models: [first, second].map((frames) => frames.find((f) => f.event === 'turn')?.data?.model),
      final: [settings.model.current, settings.contextTokens, settings.saves],
      snapshot: existsSync(path.join(host.tmp, 'request.autosave.md')),
    },
    expected: {
      createdWith: [firstPrefs],
      seen: [
        { model: 'test-quick', budget: 5000, snapshot: true },
        { model: 'test-thinking', budget: 0, snapshot: false },
      ],
      models: ['test-quick', 'test-thinking'],
      final: ['test-thinking', 0, false],
      snapshot: false,
    },
  })
})

test('chat route - missing or invalid message settings never invoke a model or construct a thread', async () => {
  let created = 0
  const host = await testHost({ settings: smallWindowHost })
  const create = host.createSession
  host.createSession = (...args) => {
    created++
    return create(...args)
  }
  const app = appWith(host)
  const valid = { profile: 'test-quick', contextTokens: 5000, saves: false }
  const invalid = [
    {},
    { contextTokens: 5000, saves: false },
    { profile: 'test-quick', saves: false },
    { profile: 'test-quick', contextTokens: 5000 },
    { ...valid, profile: 'unknown' },
    { ...valid, profile: null },
    { ...valid, contextTokens: -1 },
    { ...valid, contextTokens: 0.5 },
    { ...valid, contextTokens: '5000' },
    { ...valid, saves: 'false' },
    { ...valid, profile: 'test-small', contextTokens: 300_000 },
  ]
  const statuses: number[] = []
  for (const prefs of invalid) {
    statuses.push((await post(app, 'http://localhost/chat/invalid/messages', { message: 'Hello.', ...prefs })).status)
  }
  assert({
    given: 'missing, malformed, unknown, or incompatible settings',
    should: 'reject every message before context or model work',
    actual: { statuses, created },
    expected: { statuses: invalid.map(() => 400), created: 0 },
  })
})

test('chat route - a browser carries its choices through a server restart', async () => {
  const host = await testHost()
  const beforeRestart = appWith(host)
  const prefs = { profile: 'test-quick', contextTokens: 5000, saves: true }
  await (
    await post(beforeRestart, 'http://localhost/chat/restarted/messages', { message: 'Plan the demo.', ...prefs })
  ).text()
  const { state } = await loadResumeSession(path.join(host.tmp, 'restarted.autosave.md'))
  const afterRestart = appWith({
    ...host,
    snapshots: async () => [{ id: 'restarted', startTime: START, state }],
  })
  // No settings POST on the new server. The browser still has its choices.
  const frames = parseSSE(
    await (
      await post(afterRestart, 'http://localhost/chat/restarted/messages', {
        message: 'Continue.',
        ...prefs,
      })
    ).text(),
  )
  const settings = await getJson(afterRestart, 'http://localhost/chat/restarted/settings')
  const thread = await getJson(afterRestart, 'http://localhost/chat/restarted')
  assert({
    given: 'a restored thread whose service restarted with defaults',
    should: 'continue the conversation using the settings in the browser’s next message',
    actual: {
      model: frames.find((f) => f.event === 'turn')?.data?.model,
      settings: [settings.model.current, settings.contextTokens, settings.saves],
      turns: thread.turns.length,
    },
    expected: { model: 'test-quick', settings: ['test-quick', 5000, true], turns: 4 },
  })
})

test("chat route - a kept thread's snapshot holds the message before the reply comes", async () => {
  let midTurn: string[] | null = null
  const host = await testHost({
    invokeModel: async (args) => {
      const snapshot = await loadResumeSession(path.join(host.tmp, 'kept.autosave.md')).catch(() => null)
      midTurn = snapshot ? snapshot.state.conversation.map((m) => m.role) : null
      args.sink.write('Done.')
      return EMPTY
    },
  })
  const app = appWith(host)
  const prefs = { profile: 'test-quick', contextTokens: 0, saves: true }
  await (await post(app, 'http://localhost/chat/kept/messages', { message: 'Plan the demo.', ...prefs })).text()
  const after = await loadResumeSession(path.join(host.tmp, 'kept.autosave.md'))
  assert({
    given: 'a kept thread whose model reads the crash snapshot before answering',
    should: 'find the message already there, and the reply beside it once the turn ends',
    actual: { midTurn, after: after.state.conversation.map((m) => m.role) },
    expected: { midTurn: ['user'], after: ['user', 'assistant'] },
  })
})

test('chat route - a thread the service went down answering says so, and answers on the resend', async () => {
  const host = await testHost()
  const cut = {
    id: 'cut',
    startTime: START,
    state: { conversation: [], universePaths: [], queries: [], lastTurn: 0, contextLog: [] },
    interrupted: { message: 'Plan the demo.', when: '2026-01-27 09:31' },
  }
  const app = appWith({ ...host, snapshots: async () => [cut] })
  const list = await getJson(app, 'http://localhost/chat')
  const before = await getJson(app, 'http://localhost/chat/cut')
  const prefs = { profile: 'test-quick', contextTokens: 0, saves: true }
  await (await post(app, 'http://localhost/chat/cut/messages', { message: 'Plan the demo.', ...prefs })).text()
  const after = await getJson(app, 'http://localhost/chat/cut')
  assert({
    given: 'a snapshot that ended on the person’s message, restored, then the message sent again',
    should:
      'list the thread as failed with the line and a title from the message, carry the message apart from the turns, and clear it once answered',
    actual: {
      listed: [list.threads[0].state, list.threads[0].line, String(list.threads[0].title).startsWith('Plan the demo')],
      before: [before.turns.length, before.interrupted],
      after: [after.turns.length, after.interrupted],
    },
    expected: {
      listed: ['failed', 'sky restarted while replying — send it again', true],
      before: [0, { message: 'Plan the demo.', when: '2026-01-27 09:31' }],
      after: [2, null],
    },
  })
})

test('chat route - construction reserves the turn against competing messages and settings', async () => {
  const host = await testHost()
  const create = host.createSession
  let release!: () => void
  let entered!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const building = new Promise<void>((resolve) => {
    entered = resolve
  })
  host.createSession = async (...args) => {
    entered()
    await gate
    return create(...args)
  }
  const app = appWith(host)
  const prefs = { profile: 'test-quick', contextTokens: 0, saves: false }
  const first = post(app, 'http://localhost/chat/racing/messages', { message: 'First.', ...prefs })
  await building
  let statuses: number[]
  try {
    const second = await post(app, 'http://localhost/chat/racing/messages', {
      message: 'Second.',
      profile: 'test-thinking',
      contextTokens: 5000,
      saves: true,
    })
    const settings = await post(app, 'http://localhost/chat/racing/settings', { profile: 'test-thinking' })
    statuses = [second.status, settings.status]
  } finally {
    release()
  }
  await (await first).text()
  const settings = await getJson(app, 'http://localhost/chat/racing/settings')
  assert({
    given: 'a second message and a settings change while the first session is being constructed',
    should: 'refuse both without changing the accepted message’s choices',
    actual: { statuses, settings: [settings.model.current, settings.contextTokens, settings.saves] },
    expected: { statuses: [409, 409], settings: ['test-quick', 0, false] },
  })
})

test({ name: 'chat route - a smaller budget on a live thread reassembles its context at once' }, async () => {
  const app = appWith(await testHost())
  await (await send(app, 'http://localhost/chat/s3/messages', { message: 'What should I focus on?' })).text()
  const before = await getJson(app, 'http://localhost/chat/s3/context')
  const changed = await post(app, 'http://localhost/chat/s3/settings', { contextTokens: 1 })
  const body = (await changed.json()) as { kept: number | null }
  const after = await getJson(app, 'http://localhost/chat/s3/context')
  const thread = await getJson(app, 'http://localhost/chat/s3')
  assert({
    given: 'a budget too small for the documents in context',
    should: 'cut what no longer fits at once, and say so wherever the count shows',
    actual: {
      status: changed.status,
      keptBefore: before.stats.kept,
      fewer: after.stats.kept < before.stats.kept,
      budget: after.stats.budget,
      cut: after.cut.length > 0,
      settingsKept: body.kept,
      threadKept: thread.kept,
      story: after.log.map((e: { kind: string }) => e.kind),
    },
    expected: {
      status: 200,
      keptBefore: 3,
      fewer: true,
      budget: 1,
      cut: true,
      settingsKept: after.stats.kept,
      threadKept: after.stats.kept,
      story: ['seed'],
    },
  })
})

test({ name: 'chat route - Reads nothing keeps the notebook closed, and a budget opens it again' }, async () => {
  const app = appWith(await testHost())
  const closed = await post(app, 'http://localhost/chat/s4/settings', { contextTokens: 0 })
  const first = parseSSE(
    await (await send(app, 'http://localhost/chat/s4/messages', { message: 'Draft a note.' })).text(),
  )
  const noContext = await app.request('http://localhost/chat/s4/context')
  const settings = await getJson(app, 'http://localhost/chat/s4/settings')
  assert({
    given: 'a thread set to read nothing before its first message',
    should: 'start closed, gather nothing, run the model without a rebuild, and say so where the context would be',
    actual: {
      status: closed.status,
      started: first.find((f) => f.event === 'session-started')?.data,
      events: first.map((f) => f.event),
      contextStatus: noContext.status,
      contextNote: ((await noContext.json()) as { message: string }).message,
      kept: settings.kept,
      documents: settings.documents,
    },
    expected: {
      status: 200,
      started: { documents: 0, closed: true },
      events: ['session-started', 'tools', 'model-start', 'text-delta', 'text-delta', 'turn-complete', 'turn'],
      contextStatus: 404,
      contextNote: 'Not reading your notebook for this thread.',
      kept: 0,
      documents: null,
    },
  })

  const opened = await post(app, 'http://localhost/chat/s4/settings', { contextTokens: 5000 })
  const second = parseSSE(
    await (await send(app, 'http://localhost/chat/s4/messages', { message: 'And with my notebook?' })).text(),
  )
  const context = await getJson(app, 'http://localhost/chat/s4/context')
  assert({
    given: 'a budget after the closed turn',
    should: 'gather at the next message, and tell the story as a closed turn then the seed',
    actual: {
      status: opened.status,
      events: second.map((f) => f.event),
      story: context.log.map((e: { kind: string; turn: number }) => [e.turn, e.kind]),
      documents: context.documents,
    },
    expected: {
      status: 200,
      events: [
        'context-gathering',
        'context-rebuilt',
        'model-start',
        'text-delta',
        'text-delta',
        'turn-complete',
        'turn',
      ],
      story: [
        [1, 'closed'],
        [2, 'seed'],
      ],
      documents: 3,
    },
  })
})

test({ name: "chat route - a tool's own lines reach the page as it works, and stay with the reply" }, async () => {
  let report: ((event: ToolOutputEvent) => void) | null = null
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  // A model whose one call runs a command that narrates, then waits to be let go.
  const invokeModel: ModelInvoker = async (args) => {
    report?.({ type: 'tool-started', tool: 'google_agent' })
    report?.({ type: 'tool-line', tool: 'google_agent', text: 'Mission started', level: 'log' })
    report?.({ type: 'tool-line', tool: 'google_agent', text: 'Applied 3 update(s) to "Atlas Plan"', level: 'log' })
    await held
    report?.({ type: 'tool-finished', tool: 'google_agent', status: 'success' })
    report?.({ type: 'tool-summary', tool: 'google_agent', text: 'Applied three updates to the plan' })
    args.sink.write('Done.')
    return EMPTY
  }
  const app = appWith(await testHost({ invokeModel, capture: (channel) => (report = channel) }))
  const response = await send(app, 'http://localhost/chat/r1/messages', { message: 'Fix the fonts' })
  const body = response.text()

  const thread = await until(
    () => getJson(app, 'http://localhost/chat/r1'),
    (t) => Array.isArray(t.runs) && t.runs[0]?.lines?.length === 2,
  )
  const list = await getJson(app, 'http://localhost/chat')
  assert({
    given: 'a tool at work',
    should: 'keep its run on the thread with its lines, still open, and show its latest line in the list',
    actual: {
      run: {
        tool: thread.runs[0].tool,
        at: thread.runs[0].at,
        status: thread.runs[0].status,
        lines: thread.runs[0].lines,
      },
      started: typeof thread.runs[0].started,
      line: list.threads[0].line,
      state: list.threads[0].state,
    },
    expected: {
      run: {
        tool: 'google_agent',
        at: 1,
        status: null,
        lines: ['Mission started', 'Applied 3 update(s) to "Atlas Plan"'],
      },
      started: 'number',
      line: 'Applied 3 update(s) to "Atlas Plan"',
      state: 'thinking',
    },
  })

  release()
  const frames = parseSSE(await body)
  const after = await getJson(app, 'http://localhost/chat/r1')
  assert({
    given: 'the finished turn',
    should: 'have streamed the run as its own frames in order, and keep it settled with the reply',
    actual: {
      events: frames.map((f) => f.event),
      lines: frames.filter((f) => f.event === 'tool-line').map((f) => [f.data?.tool, f.data?.at, f.data?.text]),
      run: {
        status: after.runs[0].status,
        at: after.runs[0].at,
        lines: after.runs[0].lines.length,
        summary: after.runs[0].summary,
      },
      turns: after.turns.length,
    },
    expected: {
      events: [
        'session-started',
        'context-gathering',
        'context-rebuilt',
        'tools',
        'model-start',
        'tool-started',
        'tool-line',
        'tool-line',
        'tool-finished',
        'tool-summary',
        'text-delta',
        'turn-complete',
        'turn',
      ],
      lines: [
        ['google_agent', 1, 'Mission started'],
        ['google_agent', 1, 'Applied 3 update(s) to "Atlas Plan"'],
      ],
      run: { status: 'success', at: 1, lines: 2, summary: 'Applied three updates to the plan' },
      turns: 2,
    },
  })
})

test({ name: "chat route - a call's record says what it was about, and a quiet tool keeps its chip" }, async () => {
  let report: ((event: ChatSessionEvent | ToolOutputEvent) => void) | null = null
  // A model whose step searched the web without a word, ran a mission that narrated, and posted after asking first.
  const invokeModel: ModelInvoker = (args) => {
    report?.({ type: 'tool-call', toolName: 'web_search', input: { query: 'Atlas roadmap reviews' } })
    report?.({ type: 'tool-started', tool: 'google_agent' })
    report?.({ type: 'tool-line', tool: 'google_agent', text: 'Mission started', level: 'log' })
    report?.({ type: 'tool-finished', tool: 'google_agent', status: 'success' })
    report?.({ type: 'tool-call', toolName: 'google_agent', input: { file: 'doc-42', mission: 'Fix the fonts' } })
    report?.({ type: 'tool-call', toolName: 'slack_post', input: { channel: 'general', text: 'Hello' } })
    report?.({ type: 'tool-started', tool: 'slack_post' })
    report?.({ type: 'tool-line', tool: 'slack_post', text: 'Posted to #general', level: 'log' })
    report?.({ type: 'tool-finished', tool: 'slack_post', status: 'success' })
    args.sink.write('Done.')
    return Promise.resolve(EMPTY)
  }
  const app = appWith(await testHost({ invokeModel, capture: (channel) => (report = channel) }))
  const response = await send(app, 'http://localhost/chat/s1/messages', { message: 'Look into Atlas, fix the fonts' })
  const frames = parseSSE(await response.text())
  const thread = await getJson(app, 'http://localhost/chat/s1')
  type Started = { run: { subject?: string } }
  type Kept = { tool: string; at: number; status: string | null; lines: string[]; subject?: string }
  const startedRuns = frames.filter((f) => f.event === 'tool-started').map((f) => (f.data as unknown as Started).run)
  assert({
    given: 'a search that said nothing, a mission that narrated, and a post that asked first',
    should: 'name each call on the wire, keep the search as its own run, and give the other runs their subjects',
    actual: {
      calls: frames.filter((f) => f.event === 'tool-call').map((f) => [f.data?.toolName, f.data?.subject]),
      started: startedRuns.map((run) => run.subject),
      runs: thread.runs.map((r: Kept) => [r.tool, r.at, r.status, r.lines.length, r.subject]),
    },
    expected: {
      calls: [
        ['web_search', 'Atlas roadmap reviews'],
        ['google_agent', 'Fix the fonts'],
        ['slack_post', 'Hello'],
      ],
      started: [undefined, 'Hello'],
      runs: [
        ['web_search', 1, 'success', 0, 'Atlas roadmap reviews'],
        ['google_agent', 1, 'success', 1, 'Fix the fonts'],
        ['slack_post', 1, 'success', 1, 'Hello'],
      ],
    },
  })
})

test({ name: 'chat route - a turn that says nothing for a while still carries a heartbeat' }, async () => {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  // A model that thinks in silence until let go.
  const invokeModel: ModelInvoker = async (args) => {
    await held
    args.sink.write('Done.')
    return EMPTY
  }
  const app = appWith({ ...(await testHost({ invokeModel })), heartbeatMs: 20 })
  const response = await send(app, 'http://localhost/chat/h1/messages', { message: 'Think about it' })
  const body = response.text()
  await new Promise((resolve) => setTimeout(resolve, 150))
  release()
  const frames = parseSSE(await body)
  const beats = frames.filter((f) => f.event === 'heartbeat')
  assert({
    given: 'a turn held silent for seven heartbeats',
    should: 'carry heartbeat frames while it waits, all before the turn frame',
    actual: {
      beats: beats.length >= 3,
      data: beats[0]?.data,
      allBeforeTurn: frames.findLastIndex((f) => f.event === 'heartbeat') < frames.findIndex((f) => f.event === 'turn'),
      reply: frames.at(-1)?.data?.text,
    },
    expected: { beats: true, data: { type: 'heartbeat' }, allBeforeTurn: true, reply: 'Done.' },
  })
})

/** A model that asks for one tool's approval, then answers once it has it. */
function askingModel(): ModelInvoker {
  let round = 0
  return (args) => {
    round++
    if (round === 1) {
      return Promise.resolve({
        ...EMPTY,
        content: [
          {
            type: 'tool-approval-request',
            approvalId: 'ap-1',
            toolCall: { toolName: 'slack_post', input: { channel: 'general', text: 'Hello' } },
          },
        ],
      })
    }
    args.sink.write('Posted.')
    return Promise.resolve(EMPTY)
  }
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  for (let i = 0; i < 300; i++) {
    const value = await read()
    if (ok(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('gave up waiting')
}

test({ name: 'chat route - a tool call that needs a go waits on the page and resumes with the answer' }, async () => {
  const app = appWith(await testHost({ invokeModel: askingModel() }))
  const response = await send(app, 'http://localhost/chat/a1/messages', { message: 'Post hello for me' })
  const body = response.text()

  const thread = await until(
    () => getJson(app, 'http://localhost/chat/a1'),
    (t) => Array.isArray(t.pending) && t.pending.length > 0,
  )
  const list = await getJson(app, 'http://localhost/chat')
  assert({
    given: 'a model asking to post to Slack',
    should: 'hold the call on the thread with its card, stay busy, and say so in the list',
    actual: {
      busy: thread.busy,
      card: thread.pending[0].toolName,
      lines: thread.pending[0].lines,
      state: list.threads[0].state,
      line: list.threads[0].line,
    },
    expected: {
      busy: true,
      card: 'slack_post',
      lines: ['channel: general', 'text: Hello'],
      state: 'waiting',
      line: 'needs your go',
    },
  })

  const approvalId = thread.pending[0].id as string
  const wrong = await post(app, `http://localhost/chat/a1/approvals/${approvalId}`, { approved: 'yes' })
  const missing = await post(app, 'http://localhost/chat/a1/approvals/nope', { approved: true })
  const answered = await post(app, `http://localhost/chat/a1/approvals/${approvalId}`, { approved: true })
  const frames = parseSSE(await body)
  const after = await getJson(app, 'http://localhost/chat/a1')
  const request = frames.find((f) => f.event === 'approval-request')?.data as { approval?: { toolName: string } }
  const answer = frames.find((f) => f.event === 'approval-answered')?.data as { approved?: boolean; at?: number }
  assert({
    given: 'a malformed answer, an unknown approval, then the go',
    should: 'refuse the first two, resume the turn on the third, and finish with nothing held',
    actual: {
      wrong: wrong.status,
      missing: missing.status,
      answered: answered.status,
      events: frames
        .map((f) => f.event)
        .filter((e) => ['approval-request', 'approval-answered', 'text-delta', 'turn'].includes(e)),
      asked: request?.approval?.toolName,
      answer: [answer?.approved, answer?.at],
      reply: frames.at(-1)?.data?.text,
      pending: after.pending.length,
      busy: after.busy,
      kept: after.answered.map((a: { toolName: string; approved: boolean; at: number; lines: string[] }) => [
        a.toolName,
        a.approved,
        a.at,
        a.lines.length,
      ]),
    },
    expected: {
      wrong: 400,
      missing: 404,
      answered: 200,
      events: ['approval-request', 'approval-answered', 'text-delta', 'turn'],
      asked: 'slack_post',
      answer: [true, 1],
      reply: 'Posted.',
      pending: 0,
      busy: false,
      kept: [['slack_post', true, 1, 2]],
    },
  })
})

test({ name: 'chat route - a declined call tells the model so, and the turn goes on' }, async () => {
  const app = appWith(await testHost({ invokeModel: askingModel() }))
  const response = await send(app, 'http://localhost/chat/a2/messages', { message: 'Post hello for me' })
  const body = response.text()
  const thread = await until(
    () => getJson(app, 'http://localhost/chat/a2'),
    (t) => Array.isArray(t.pending) && t.pending.length > 0,
  )
  await post(app, `http://localhost/chat/a2/approvals/${thread.pending[0].id}`, { approved: false })
  const frames = parseSSE(await body)
  const context = await getJson(app, 'http://localhost/chat/a2/context')
  assert({
    given: 'the person declining the call',
    should: 'still finish the turn, and record the call as denied in the story',
    actual: {
      answered: (frames.find((f) => f.event === 'approval-answered')?.data as { approved?: boolean })?.approved,
      reply: frames.at(-1)?.data?.text,
      tools: context.log.flatMap((e: { tools: Array<{ tool: string; outcome: string }> }) =>
        e.tools.map((t) => ({ tool: t.tool, outcome: t.outcome })),
      ),
    },
    expected: { answered: false, reply: 'Posted.', tools: [{ tool: 'slack_post', outcome: 'denied' }] },
  })
})

test({ name: 'chat route - the first exchange names the thread, off the turn' }, async () => {
  const asked: number[] = []
  const host = await testHost()
  const app = appWith({
    ...host,
    title: (turns) => {
      asked.push(turns.length)
      return Promise.resolve('Demo focus for the week')
    },
  })
  const response = await send(app, 'http://localhost/chat/n1/messages', { message: 'What should I focus on today?' })
  const frames = parseSSE(await response.text())

  const named = await until(
    () => getJson(app, 'http://localhost/chat'),
    (list) => (list.threads as ThreadSummary[])[0]?.title === 'Demo focus for the week',
  )
  const thread = await getJson(app, 'http://localhost/chat/n1')

  assert({
    given: 'a host with a titler and one finished exchange',
    should: 'name the thread from the first two turns once the turn is over, in the list and on the thread',
    actual: {
      asked,
      listTitle: (named.threads as ThreadSummary[])[0].title,
      threadTitle: thread.title,
      turnCameFirst: frames.some((f) => f.event === 'turn'),
    },
    expected: {
      asked: [2],
      listTitle: 'Demo focus for the week',
      threadTitle: 'Demo focus for the week',
      turnCameFirst: true,
    },
  })
})

test({ name: 'chat route - without a titler a thread goes by its first words' }, async () => {
  const app = appWith(await testHost())
  await (
    await send(app, 'http://localhost/chat/w1/messages', { message: 'What should I focus on today please' })
  ).text()
  const list = (await getJson(app, 'http://localhost/chat')).threads as ThreadSummary[]

  assert({
    given: 'no titler and one finished exchange',
    should: 'title the thread by the first words of its first message',
    actual: list.find((t) => t.id === 'w1')?.title,
    expected: 'What should I focus on today please',
  })
})

test({ name: 'chat route - the threads the last run left behind come back from their snapshots' }, async () => {
  const host = await testHost()
  const app = appWith({
    ...host,
    snapshots: () =>
      Promise.resolve([
        {
          id: 'r1',
          startTime: START,
          state: {
            conversation: [
              {
                role: 'user' as const,
                content: 'What should I focus on for the Atlas launch?',
                when: '2026-01-27 09:30',
              },
              {
                role: 'assistant' as const,
                content: 'The demo script and the pricing page copy.',
                when: '2026-01-27 09:31',
              },
            ],
            universePaths: [],
            queries: [],
            lastTurn: 1,
            // The log carries what the turn cost and how long it took; the page's details read them back.
            contextLog: [
              {
                turn: 1,
                queries: [],
                usage: { input: 1200, output: 80, cacheRead: 0, cacheWrite: 0 } as never,
                timing: { total: 4200 } as never,
                model: 'test-quick',
              },
            ],
          },
        },
      ]),
  })

  const list = (await getJson(app, 'http://localhost/chat')).threads as ThreadSummary[]
  const before = await getJson(app, 'http://localhost/chat/r1')
  const response = await send(app, 'http://localhost/chat/r1/messages', { message: 'And after that?' })
  const frames = parseSSE(await response.text())
  const after = await getJson(app, 'http://localhost/chat/r1')

  assert({
    given: 'a host with one snapshot from the last run',
    should: 'list the thread with its turns before any message, and carry on the conversation from there',
    actual: {
      listed: list.map((t) => `${t.id} ${t.state} ${t.turns} turns · ${t.title}`),
      turnsBefore: before.turns.length,
      statsBefore: {
        usageAt: before.usage.map((u: { at: number }) => u.at),
        timingsAt: before.timings.map((x: { at: number }) => x.at),
        model: before.usage[0]?.model,
      },
      streamedTurn: frames.some((f) => f.event === 'turn'),
      turnsAfter: after.turns.length,
      lastRole: after.turns.at(-1)?.role,
    },
    expected: {
      listed: ['r1 done 2 turns · What should I focus on for the Atlas'],
      turnsBefore: 2,
      statsBefore: { usageAt: [1], timingsAt: [1], model: 'test-quick' },
      streamedTurn: true,
      turnsAfter: 4,
      lastRole: 'assistant',
    },
  })
})

test({ name: 'chat route - "allow for this file" reaches the host only when the card carried a key' }, async () => {
  const answerWith = async (sessionKey: string | undefined) => {
    const decisions: Array<{ approved: boolean; always?: boolean }> = []
    const app = appWith(await testHost({ invokeModel: askingModel(), sessionKey, decisions }))
    const body = send(app, 'http://localhost/chat/a1/messages', { message: 'Post hello for me' }).then((r) => r.text())
    const thread = await until(
      () => getJson(app, 'http://localhost/chat/a1'),
      (t) => Array.isArray(t.pending) && t.pending.length > 0,
    )
    const card = thread.pending[0] as { id: string; sessionKey?: string }
    await post(app, `http://localhost/chat/a1/approvals/${card.id}`, { approved: true, always: true })
    await body
    return { cardKey: card.sessionKey, decision: decisions[0] }
  }
  assert({
    given: 'a card scoped to a file, answered "always", then one with no key answered the same way',
    should: 'carry the key to the page and the standing go to the host for the first only',
    actual: [await answerWith('doc-1'), await answerWith(undefined)],
    expected: [
      { cardKey: 'doc-1', decision: { approved: true, reason: 'User approved', always: true } },
      { cardKey: undefined, decision: { approved: true, reason: 'User approved', always: false } },
    ],
  })
})

test(
  { name: 'chat route - a new chat from here inherits the turns through that reply and files beside its parent' },
  async () => {
    const host = await testHost()
    const app = appWith(host)
    await (await send(app, 'http://localhost/chat/p1/messages', { message: 'What should I focus on today?' })).text()

    const made = await post(app, 'http://localhost/chat/p1/branch', { turn: 1 })
    const { id: branchId, parent } = (await made.json()) as { id: string; parent: { chat: string; turn: number } }
    const branchBefore = await getJson(app, `http://localhost/chat/${branchId}`)
    const rows = (await getJson(app, 'http://localhost/chat')).threads as ThreadSummary[]
    await (
      await send(app, `http://localhost/chat/${branchId}/messages`, { message: 'And the board prep instead?' })
    ).text()
    const branchAfter = await getJson(app, `http://localhost/chat/${branchId}`)

    const ended = (await (await post(app, `http://localhost/chat/${branchId}/end`, { save: true })).json()) as {
      saved: { path: string; exchanges: number }
    }
    const parentRow = (await getJson(app, 'http://localhost/chat/p1')) as { saved: string | null; turns: unknown[] }
    const base = path.dirname(host.tmp)
    const parentFile = path.join(base, parent.chat)
    const branchDoc = await readTextFile(ended.saved.path)

    assert({
      given: 'a thread with one exchange, branched after turn 1, given one exchange of its own, then ended',
      should:
        'start the branch with the parent turns inherited and marked, list it under its live parent, keep the parent going, and file both — the parent first, the branch beside it holding its own turns',
      actual: {
        created: made.status,
        parentTurn: parent.turn,
        parentNamed: parent.chat.endsWith('/actions/ai-chats/09-30_What-should-I-focus-on-today.md'),
        inherited: branchBefore.inherited,
        turnsBefore: branchBefore.turns.length,
        branchParent: branchBefore.parent,
        listedUnderParent: rows.find((t) => t.id === branchId)?.parent?.id,
        parentTitlePinned: rows.find((t) => t.id === 'p1')?.title,
        turnsAfter: branchAfter.turns.length,
        branchExchanges: ended.saved.exchanges,
        branchBesideParent: ended.saved.path.startsWith(parentFile.replace(/\.md$/, '/')),
        branchHoldsOwnOnly: (branchDoc.match(/^## /gm) ?? []).length,
        branchRecordsParent: branchDoc.includes(`chat: ${parent.chat}`) && branchDoc.includes('turn: 1'),
        parentFiled: await exists(parentFile),
        parentStillLive: parentRow.turns.length,
        parentSaved: parentRow.saved,
      },
      expected: {
        created: 201,
        parentTurn: 1,
        parentNamed: true,
        inherited: 2,
        turnsBefore: 2,
        branchParent: { chat: parent.chat, turn: 1, id: 'p1', title: 'What should I focus on today?' },
        listedUnderParent: 'p1',
        parentTitlePinned: 'What should I focus on today?',
        turnsAfter: 4,
        branchExchanges: 1,
        branchBesideParent: true,
        branchHoldsOwnOnly: 2,
        branchRecordsParent: true,
        parentFiled: true,
        parentStillLive: 2,
        parentSaved: parent.chat,
      },
    })
  },
)

test({ name: 'chat route - a saved chat opens as a thread to continue, once' }, async () => {
  const host = await testHost()
  const base = path.dirname(host.tmp)
  const app = appWith({
    ...host,
    openSaved: async (chat) => {
      const file = path.join(base, chat)
      if (!(await exists(file))) return null
      return { resume: await loadResumeSession(file, { baseDir: base }), startTime: START }
    },
  })
  await (await send(app, 'http://localhost/chat/s1/messages', { message: 'What should I focus on today?' })).text()
  const { saved } = (await (await post(app, 'http://localhost/chat/s1/end', { save: true })).json()) as {
    saved: { path: string; summary: string }
  }
  const chat = path.relative(base, saved.path)

  const first = await post(app, 'http://localhost/chat/open', { chat })
  const { id } = (await first.json()) as { id: string }
  const second = (await (await post(app, 'http://localhost/chat/open', { chat })).json()) as {
    id: string
    opened: boolean
  }
  const thread = await getJson(app, `http://localhost/chat/${id}`)
  const missing = await post(app, 'http://localhost/chat/open', {
    chat: 'time/nowhere/actions/ai-chats/09-00_Nothing.md',
  })

  assert({
    given: 'a chat saved and ended, then opened twice by its path, and a path with no chat',
    should: 'make one thread with the saved turns and title, find it the second time, and refuse the missing one',
    actual: {
      created: first.status,
      sameThread: second.id === id && second.opened === false,
      turns: thread.turns.length,
      title: thread.title,
      saved: thread.saved,
      missing: missing.status,
    },
    expected: { created: 201, sameThread: true, turns: 2, title: saved.summary, saved: chat, missing: 404 },
  })
})

test(
  { name: "chat route - a model's window caps the budget, before the first message and on a live thread" },
  async () => {
    const app = appWith(await testHost({ settings: smallWindowHost }))
    const listed = await getJson(app, 'http://localhost/chat/s7/settings')
    const small = await post(app, 'http://localhost/chat/s7/settings', {
      profile: 'test-small',
      contextTokens: 300_000,
    })
    const smallBody = (await small.json()) as { model: { current: string }; contextTokens: number }
    const fits = await post(app, 'http://localhost/chat/s7/settings', { contextTokens: 25_000 })
    const fitsBody = (await fits.json()) as { contextTokens: number }
    const back = await post(app, 'http://localhost/chat/s7/settings', { profile: 'test-quick', contextTokens: 300_000 })
    const backBody = (await back.json()) as { model: { current: string }; contextTokens: number }
    assert({
      given:
        'the catalog, then the small-window model chosen with 300k, a 25k budget on it, and the wide model back with 300k',
      should:
        'list the window on the choice, drop 300k to 50k — the highest stop that fits — keep 25k, and take 300k on the wide model',
      actual: {
        window: listed.model.choices.find((c: { name: string }) => c.name === 'test-small')?.contextWindow,
        small: [smallBody.model.current, smallBody.contextTokens],
        fits: fitsBody.contextTokens,
        back: [backBody.model.current, backBody.contextTokens],
      },
      expected: { window: SMALL_WINDOW, small: ['test-small', 50_000], fits: 25_000, back: ['test-quick', 300_000] },
    })

    await (await send(app, 'http://localhost/chat/s7/messages', { message: 'What should I focus on?' })).text()
    const lowered = await post(app, 'http://localhost/chat/s7/settings', { profile: 'test-small' })
    const loweredBody = (await lowered.json()) as { model: { current: string }; contextTokens: number }
    const context = await getJson(app, 'http://localhost/chat/s7/context')
    assert({
      given: 'a live thread reading 300k, switched to the small-window model with no budget named',
      should: 'lower its budget to 50k and reassemble the context within it',
      actual: {
        current: loweredBody.model.current,
        contextTokens: loweredBody.contextTokens,
        budget: context.stats.budget,
      },
      expected: { current: 'test-small', contextTokens: 50_000, budget: 50_000 },
    })
  },
)
