import * as path from 'node:path'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { makeTempDir, readTextFile } from '#shared/fs/mod.ts'
import type { ProducerResult } from '#shared/models/Chat/ChatContext/mod.ts'
import type { ModelInvoker } from '#shared/models/Chat/ChatEngine/mod.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { SaveEnricher } from '#shared/models/Chat/ChatStore/save.ts'
import { setUserSpeakerLabel } from '#shared/models/Chat/document/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { assert, test } from '#test'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { createTestHttpApp } from '../httpTestHelpers.ts'
import type { ChatRoutesOptions, ChatSessionFactory, ThreadSummary } from './mod.ts'

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
  day: path.join(BASE_DIR, 'time/2026/01/26-01/01-27/day.md'),
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

async function testHost(over: { invokeModel?: ModelInvoker } = {}): Promise<ChatRoutesOptions & { tmp: string }> {
  const tmp = await makeTempDir({ prefix: 'sky-chat-route-' })
  const createSession: ChatSessionFactory = (id, onEvent) =>
    Promise.resolve(
      new ChatSession({
        today: TODAY,
        startTime: START,
        days: 7,
        baseDir: BASE_DIR,
        timeDir: tmp,
        resume: null,
        model: {} as ResolvedModel,
        profile: { provider: 'claude', model: 'claude-opus-4-6' },
        producers: {
          produceInitialQuery: () => Promise.resolve(ok({ paths: [FIX.roadmap] })),
          evolveQueries: () => Promise.resolve(ok({ queries: [] as string[], changed: false })),
          executeQuery: () => Promise.resolve(ok({ paths: [] as string[] })),
        },
        ambient: AMBIENT,
        systemPrompt: () => Promise.resolve('You are a test assistant.'),
        tools: () => Promise.resolve({ tools: {}, toolApproval: {} }),
        approvalHandler: () => Promise.resolve({ approved: false, reason: 'no' }),
        autosavePath: path.join(tmp, `${id}.autosave.md`),
        onEvent,
        invokeModel: over.invokeModel ?? streamingModel(['Focus on ', 'the demo.']),
        fetchContext: fetchFake({ today: [FIX.day], goals: [FIX.goal] }),
        now: () => Promise.resolve(STAMP),
        logError: () => Promise.resolve(),
      }),
    )
  return { createSession, endDefaults: { enricher: stubEnricher }, timeDir: tmp, tmp }
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
  const response = await post(app, 'http://localhost/chat/t0/messages', { message: '   ' })

  assert({
    given: 'a blank message',
    should: 'refuse it before a session is built',
    actual: response.status,
    expected: 400,
  })
})

test({ name: 'chat route - the first message starts the session and streams the turn' }, async () => {
  const app = appWith(await testHost())
  const response = await post(app, 'http://localhost/chat/t1/messages', { message: 'What should I focus on?' })
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
  await (await post(app, 'http://localhost/chat/t2/messages', { message: 'What should I focus on?' })).text()

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
  const first = await post(app, 'http://localhost/chat/t3/messages', { message: 'first' })
  const second = await post(app, 'http://localhost/chat/t3/messages', { message: 'second' })
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
  await (await post(app, 'http://localhost/chat/t6/messages', { message: 'What should I focus on today?' })).text()
  const second = await post(app, 'http://localhost/chat/t7/messages', { message: 'And the pricing page?' })
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

  await (await post(app, 'http://localhost/chat/t4/messages', { message: 'What should I focus on?' })).text()
  const dropped = (await (await post(app, 'http://localhost/chat/t4/end', { save: false })).json()) as {
    saved: unknown
  }
  assert({
    given: 'a thread ended without saving',
    should: 'report nothing saved and forget the thread',
    actual: { saved: dropped.saved, after: (await app.request('http://localhost/chat/t4')).status },
    expected: { saved: null, after: 404 },
  })

  await (await post(app, 'http://localhost/chat/t5/messages', { message: 'What should I focus on?' })).text()
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

  await (await post(app, 'http://localhost/chat/t6/messages', { message: 'What should I focus on?' })).text()
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
      kept: ['goals/2026.md', 'projects/Atlas/Roadmap.md', 'time/2026/01/26-01/01-27/day.md'],
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
      kept: ['goals/2026.md', 'time/2026/01/26-01/01-27/day.md'],
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
