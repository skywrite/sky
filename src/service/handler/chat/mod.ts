/**
 * Chat over HTTP — the browser's host for ChatSession.
 *
 * One session per thread id, kept in memory for the life of the service;
 * the session's own per-turn autosave is the crash insurance, exactly as
 * in the terminal. A message is a POST whose response is the turn's event
 * stream as server-sent events — the same ChatSessionEvent the terminal
 * renders, one per frame, named by its type — closed by a `turn` frame
 * carrying the turn report. Nothing here decides what a chat is; the
 * session does, and this host renders nothing.
 */

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import type { RebuildReport } from '#shared/models/Chat/ChatContext/mod.ts'
import type ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { ChatSessionEvent, EndOptions, TurnReport } from '#shared/models/Chat/ChatSession/mod.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'

/** Builds a session for a thread; the host's wiring of producers, tools, prompt, and model. */
export type ChatSessionFactory = (id: string, onEvent: (event: ChatSessionEvent) => void) => Promise<ChatSession>

export interface ChatRoutesOptions {
  createSession: ChatSessionFactory
  /** How a thread files when the client ends it — the host's saving policy */
  endDefaults?: Omit<EndOptions, 'save'>
  /** Notebook time root — the day view lists the day's saved chats from it */
  timeDir: string
  /** about-me.md — the day view tells the owner's threads from archival ones by it */
  aboutMePath?: string
}

/**
 * What a thread is doing, as the day view shows it. `reading` covers the
 * whole gather; `thinking` is the gap before the first token, which is the
 * longest silence a turn has; `done` and `failed` describe the last turn.
 */
export type ThreadState = 'new' | 'reading' | 'thinking' | 'streaming' | 'done' | 'failed' | 'saving'

/** A thread as the day lists it: enough to show a row, never the transcript. */
export interface ThreadSummary {
  id: string
  /** First words of the first message; null before any */
  title: string | null
  state: ThreadState
  /** The reply so far while streaming, the last reply when done, the error when failed */
  line: string | null
  /** Notebook time of the last message, `HH:MM`; null before any */
  when: string | null
  turns: number
  busy: boolean
}

interface Thread {
  session: ChatSession
  started: boolean
  /** One turn at a time: a second message while one runs is refused, not queued */
  busy: boolean
  /** Where the running turn's events go; null between turns */
  sink: ((event: ChatSessionEvent) => void) | null
  state: ThreadState
  /** The reply as it streams, for the list's last line */
  partial: string
  /** A tick from a monotonic counter — ordering the list only, never a time */
  updatedAt: number
  /** The last rebuild's full report — the per-document records the wire leaves out */
  context: RebuildReport | null
}

const LINE_CHARS = 140
const TITLE_WORDS = 8

function head(text: string, chars = LINE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > chars ? `${flat.slice(0, chars - 1)}…` : flat
}

function threadTitle(turns: ConversationMessage[]): string | null {
  const first = turns.find((t) => t.role === 'user')
  if (!first) return null
  return head(first.content.split(/\s+/).slice(0, TITLE_WORDS).join(' '), 80)
}

/** The state a session event puts its thread in, if any. */
function stateAfter(event: ChatSessionEvent): ThreadState | null {
  switch (event.type) {
    case 'context-gathering':
    case 'queries-changed':
      return 'reading'
    case 'model-start':
      return 'thinking'
    case 'text-delta':
      return 'streaming'
    case 'enriching':
      return 'saving'
    default:
      return null
  }
}

function summarize(id: string, thread: Thread): ThreadSummary {
  const { session, state } = thread
  const lastReply = [...session.turns].reverse().find((t) => t.role === 'assistant')
  let line: string | null = null
  if (state === 'streaming') line = head(thread.partial)
  else if (state === 'done' && lastReply) line = head(lastReply.content)
  else if (state === 'failed') line = thread.partial || null
  return {
    id,
    title: threadTitle(session.turns),
    state,
    line,
    when: session.turns.at(-1)?.when?.slice(11) ?? null,
    turns: session.turns.length,
    busy: thread.busy,
  }
}

/**
 * The wire form of an event. A context rebuild is the one event that is
 * not sent whole: its rendered markdown is the entire context (hundreds of
 * kilobytes), and its per-document records ran to 300 KB on a real first
 * turn — the counts are what a client shows, so the counts are what
 * travel. The records join the wire when a client renders a changelog.
 */
function wireEvent(event: ChatSessionEvent): unknown {
  if (event.type !== 'context-rebuilt') return event
  const { turn, recorded, collectionSize, stats } = event.report
  return { type: event.type, report: { turn, recorded, collectionSize, stats } }
}

/** The turn report without its context rebuild, which already went out as its own frame. */
function wireTurn(turn: TurnReport): unknown {
  const { context, ...rest } = turn
  return { ...rest, context: { errors: context.errors } }
}

export function createChatRoutes(options: ChatRoutesOptions): Hono {
  const threads = new Map<string, Thread>()
  const opening = new Map<string, Promise<Thread>>()
  const app = new Hono()
  // Two threads can move within one millisecond; a counter keeps "newest
  // activity first" true where a clock would tie.
  let tick = 0

  // A thread exists from its first message. Two first messages racing for
  // the same id share one session rather than each building their own.
  const open = (id: string): Promise<Thread> => {
    const existing = threads.get(id)
    if (existing) return Promise.resolve(existing)
    let pending = opening.get(id)
    if (!pending) {
      pending = options
        .createSession(id, (event) => {
          const thread = threads.get(id)
          if (!thread) return
          const next = stateAfter(event)
          if (next) thread.state = next
          if (event.type === 'model-start') thread.partial = ''
          if (event.type === 'text-delta') thread.partial += event.text
          if (event.type === 'context-rebuilt') thread.context = event.report
          thread.updatedAt = ++tick
          thread.sink?.(event)
        })
        .then((session) => {
          const thread: Thread = {
            session,
            started: false,
            busy: false,
            sink: null,
            state: 'new',
            partial: '',
            updatedAt: ++tick,
            context: null,
          }
          threads.set(id, thread)
          return thread
        })
        .finally(() => opening.delete(id))
      opening.set(id, pending)
    }
    return pending
  }

  app.post('/:id/messages', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as { message?: unknown } | null
    const message = typeof body?.message === 'string' ? body.message.trim() : ''
    if (!message) return c.json({ message: 'message is required' }, 400)

    const thread = await open(id)
    if (thread.busy) return c.json({ message: 'a turn is already running on this thread' }, 409)
    thread.busy = true
    // The baseline gather before the first event is a read too.
    thread.state = 'reading'
    thread.partial = ''
    thread.updatedAt = ++tick

    return streamSSE(
      c,
      async (stream) => {
        // Frames leave in emission order: each write queues behind the last.
        let chain = Promise.resolve()
        const frame = (event: string, data: unknown) => {
          chain = chain.then(() => stream.writeSSE({ event, data: JSON.stringify(data) }))
        }
        thread.sink = (event) => frame(event.type, wireEvent(event))
        try {
          if (!thread.started) {
            await thread.session.start()
            thread.started = true
            frame('session-started', { documents: thread.session.paths.length })
          }
          const turn = await thread.session.send(message)
          thread.state = turn.error ? 'failed' : 'done'
          if (turn.error) thread.partial = turn.error
          thread.updatedAt = ++tick
          frame('turn', wireTurn(turn))
          await chain
        } finally {
          thread.sink = null
          thread.busy = false
        }
      },
      async (err, stream) => {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: err.message }) })
      },
    )
  })

  // The day's view of its threads: newest activity first.
  app.get('/', (c) => {
    const list = [...threads.entries()]
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .map(([id, thread]) => summarize(id, thread))
    return c.json({ threads: list })
  })

  app.get('/:id', (c) => {
    const id = c.req.param('id')
    const thread = threads.get(id)
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    return c.json({
      id,
      turns: thread.session.turns,
      documents: thread.session.paths.length,
      kept: thread.session.kept,
    })
  })

  // What the model sees: the last rebuild's records, kept and cut. The
  // stream carries counts only; the documents themselves are here.
  const contextOf = (thread: Thread) => {
    const report = thread.context
    if (!report) return null
    return {
      turn: report.turn,
      documents: report.collectionSize,
      stats: report.stats ?? null,
      kept: report.kept,
      cut: report.cut,
    }
  }

  app.get('/:id/context', (c) => {
    const thread = threads.get(c.req.param('id'))
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    const context = contextOf(thread)
    if (!context) return c.json({ message: 'no context yet — the first message builds it' }, 404)
    return c.json(context)
  })

  // The context by hand: pin a document in, keep one out, or let one go.
  app.post('/:id/context', async (c) => {
    const thread = threads.get(c.req.param('id'))
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    if (thread.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
    const body = (await c.req.json().catch(() => null)) as { action?: unknown; path?: unknown } | null
    const action = body?.action
    if (typeof body?.path !== 'string' || (action !== 'pin' && action !== 'exclude' && action !== 'release')) {
      return c.json({ message: 'expected { action: pin | exclude | release, path }' }, 400)
    }
    try {
      if (action === 'pin') await thread.session.pinDocument(body.path)
      else if (action === 'exclude') thread.session.excludeDocument(body.path)
      else thread.session.releaseDocument(body.path)
    } catch (err) {
      return c.json({ message: `couldn't ${action} ${body.path}: ${(err as Error).message}` }, 400)
    }
    thread.updatedAt = ++tick
    return c.json(contextOf(thread))
  })

  app.post('/:id/end', async (c) => {
    const id = c.req.param('id')
    const thread = threads.get(id)
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    if (thread.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
    const body = (await c.req.json().catch(() => null)) as { save?: unknown } | null

    // The thread stays until the end succeeds, so a failed save can be retried.
    thread.busy = true
    thread.state = 'saving'
    try {
      const saved = await thread.session.end({ ...options.endDefaults, save: body?.save !== false })
      threads.delete(id)
      return c.json({ saved })
    } finally {
      thread.busy = false
      if (threads.has(id)) thread.state = 'done'
    }
  })

  return app
}
