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
import type ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { ChatSessionEvent, EndOptions, TurnReport } from '#shared/models/Chat/ChatSession/mod.ts'

/** Builds a session for a thread; the host's wiring of producers, tools, prompt, and model. */
export type ChatSessionFactory = (id: string, onEvent: (event: ChatSessionEvent) => void) => Promise<ChatSession>

export interface ChatRoutesOptions {
  createSession: ChatSessionFactory
  /** How a thread files when the client ends it — the host's saving policy */
  endDefaults?: Omit<EndOptions, 'save'>
}

interface Thread {
  session: ChatSession
  started: boolean
  /** One turn at a time: a second message while one runs is refused, not queued */
  busy: boolean
  /** Where the running turn's events go; null between turns */
  sink: ((event: ChatSessionEvent) => void) | null
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

  // A thread exists from its first message. Two first messages racing for
  // the same id share one session rather than each building their own.
  const open = (id: string): Promise<Thread> => {
    const existing = threads.get(id)
    if (existing) return Promise.resolve(existing)
    let pending = opening.get(id)
    if (!pending) {
      pending = options
        .createSession(id, (event) => threads.get(id)?.sink?.(event))
        .then((session) => {
          const thread: Thread = { session, started: false, busy: false, sink: null }
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

  app.get('/:id', (c) => {
    const id = c.req.param('id')
    const thread = threads.get(id)
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    return c.json({ id, turns: thread.session.turns, documents: thread.session.paths.length })
  })

  app.post('/:id/end', async (c) => {
    const id = c.req.param('id')
    const thread = threads.get(id)
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    if (thread.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
    const body = (await c.req.json().catch(() => null)) as { save?: unknown } | null

    // The thread stays until the end succeeds, so a failed save can be retried.
    thread.busy = true
    try {
      const saved = await thread.session.end({ ...options.endDefaults, save: body?.save !== false })
      threads.delete(id)
      return c.json({ saved })
    } finally {
      thread.busy = false
    }
  })

  return app
}
