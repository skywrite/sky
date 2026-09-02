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
import type { ResolvedModel } from '#shared/ai/models.ts'
import type { RebuildReport } from '#shared/models/Chat/ChatContext/mod.ts'
import type { ApprovalDecision } from '#shared/models/Chat/ChatEngine/mod.ts'
import type ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type { ChatSessionEvent, EndOptions, TurnReport } from '#shared/models/Chat/ChatSession/mod.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import { timelineOf } from './timeline.ts'

/** What a thread is tuned with before its first message builds it. */
export interface ThreadPrefs {
  /** Model profile name */
  profile?: string
  /** Token budget for the assembled document context; zero keeps the notebook closed */
  contextTokens?: number
}

/** A tool call awaiting the person's go, as the page shows it. */
export interface ApprovalCard {
  toolName: string
  /** The call as the tool describes it — its own formatter's lines, or the input's fields */
  lines: string[]
}

export interface PendingApproval extends ApprovalCard {
  id: string
}

/** A call the person answered — kept with the thread so the page can show what was allowed, and where. */
export interface AnsweredApproval extends PendingApproval {
  approved: boolean
  /** The thread's turn count when answered — the card sits before the reply at that index */
  at: number
}

/**
 * Puts a tool call to the person and resolves with their answer — the
 * routes' half of the session's approval handler. The turn waits on it.
 */
export type AskApproval = (card: ApprovalCard) => Promise<ApprovalDecision>

/** Builds a session for a thread; the host's wiring of producers, tools, prompt, and model. */
export type ChatSessionFactory = (
  id: string,
  onEvent: (event: ChatSessionEvent) => void,
  prefs: ThreadPrefs,
  ask: AskApproval,
) => Promise<ChatSession>

/** One model a thread may think with, as the picker lists it. */
export interface ModelChoice {
  /** Profile name — what a thread is set to */
  name: string
  /** `Claude Opus 5` */
  label: string
  /** `Anthropic` — the picker groups by it */
  provider: string
  /** The roles this profile holds — `Thinking`, `Quick`, … */
  roles: string[]
}

/** How a thread is tuned: the model it thinks with and the reading budget. */
export interface ThreadSettings {
  model: { current: string; default: string; choices: ModelChoice[] }
  /** Token budget for the assembled document context; zero keeps the notebook closed */
  contextTokens: number
  /** How many documents the model sees as the context stands; null before any turn */
  kept: number | null
  /** Documents in the universe, shipped and cut alike; null before any turn */
  documents: number | null
}

/** The host's catalog and defaults behind the settings routes. */
export interface ChatSettingsHost {
  defaultModel: string
  defaultContextTokens: number
  choices(): ModelChoice[]
  /** A choice as a session takes it; throws on a name it doesn't know */
  resolve(name: string): { model: ResolvedModel; profile: { provider: string; model: string } }
}

export interface ChatRoutesOptions {
  createSession: ChatSessionFactory
  /** The models to choose from and the budget's default — absent, a thread cannot be tuned */
  settings?: ChatSettingsHost
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
 * longest silence a turn has; `waiting` is a tool call held for the
 * person's go; `done` and `failed` describe the last turn.
 */
export type ThreadState = 'new' | 'reading' | 'thinking' | 'streaming' | 'waiting' | 'done' | 'failed' | 'saving'

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

/** What travels the turn's stream: the session's events, and the approvals the routes add around them. */
type WireEvent =
  | ChatSessionEvent
  | { type: 'approval-request'; approval: PendingApproval }
  | { type: 'approval-answered'; id: string; approved: boolean; at: number }

interface Thread {
  session: ChatSession
  started: boolean
  /** One turn at a time: a second message while one runs is refused, not queued */
  busy: boolean
  /** Where the running turn's events go; null between turns */
  sink: ((event: WireEvent) => void) | null
  /** Tool calls held for the person's go, by approval id */
  pending: Map<string, PendingApproval & { resolve: (decision: ApprovalDecision) => void }>
  /** The calls answered so far, oldest first */
  answered: AnsweredApproval[]
  state: ThreadState
  /** The reply as it streams, for the list's last line */
  partial: string
  /** A tick from a monotonic counter — ordering the list only, never a time */
  updatedAt: number
  /** The last rebuild's full report — the per-document records the wire leaves out */
  context: RebuildReport | null
  /** Model profile name the thread thinks with */
  profile: string
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
  else if (state === 'waiting') line = 'needs your go'
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
function wireEvent(event: WireEvent): unknown {
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
  // Tuning chosen before a thread's first message — applied when it is built.
  const pending = new Map<string, ThreadPrefs>()
  const app = new Hono()
  // Two threads can move within one millisecond; a counter keeps "newest
  // activity first" true where a clock would tie.
  let tick = 0

  // A thread exists from its first message. Two first messages racing for
  // the same id share one session rather than each building their own.
  const open = (id: string): Promise<Thread> => {
    const existing = threads.get(id)
    if (existing) return Promise.resolve(existing)
    let building = opening.get(id)
    if (!building) {
      const prefs = pending.get(id) ?? {}
      // A tool call held for the person: the card goes down the stream (and
      // waits on the thread for a page that opens later); the answer route
      // resolves it. The turn waits meanwhile.
      const ask: AskApproval = (card) =>
        new Promise((resolve) => {
          const thread = threads.get(id)
          if (!thread) {
            resolve({ approved: false, reason: 'The thread is gone. Do not request this tool again.' })
            return
          }
          const approval: PendingApproval = { id: crypto.randomUUID(), ...card }
          thread.pending.set(approval.id, { ...approval, resolve })
          thread.state = 'waiting'
          thread.updatedAt = ++tick
          thread.sink?.({ type: 'approval-request', approval })
        })
      building = options
        .createSession(
          id,
          (event) => {
            const thread = threads.get(id)
            if (!thread) return
            const next = stateAfter(event)
            if (next) thread.state = next
            if (event.type === 'model-start') thread.partial = ''
            if (event.type === 'text-delta') thread.partial += event.text
            if (event.type === 'context-rebuilt') thread.context = event.report
            thread.updatedAt = ++tick
            thread.sink?.(event)
          },
          prefs,
          ask,
        )
        .then((session) => {
          const thread: Thread = {
            session,
            started: false,
            busy: false,
            sink: null,
            pending: new Map(),
            answered: [],
            state: 'new',
            partial: '',
            updatedAt: ++tick,
            context: null,
            profile: prefs.profile ?? options.settings?.defaultModel ?? '',
          }
          threads.set(id, thread)
          pending.delete(id)
          return thread
        })
        .finally(() => opening.delete(id))
      opening.set(id, building)
    }
    return building
  }

  // A thread's tuning: the live thread's own, else what was chosen for it, else the host's defaults.
  const settingsOf = (id: string): ThreadSettings | null => {
    const host = options.settings
    if (!host) return null
    const thread = threads.get(id)
    const prefs = pending.get(id)
    return {
      model: {
        current: thread?.profile ?? prefs?.profile ?? host.defaultModel,
        default: host.defaultModel,
        choices: host.choices(),
      },
      contextTokens: thread?.session.contextTokens ?? prefs?.contextTokens ?? host.defaultContextTokens,
      kept: thread ? keptOf(thread) : null,
      documents: thread?.context?.collectionSize ?? null,
    }
  }

  // A pin, a drop, or a new budget reassembles between turns without a log
  // entry, so the latest assembly answers before the log does.
  const keptOf = (thread: Thread): number | null => thread.context?.stats?.kept ?? thread.session.kept

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
            frame('session-started', {
              documents: thread.session.paths.length,
              closed: thread.session.contextTokens === 0,
            })
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
      kept: keptOf(thread),
      busy: thread.busy,
      pending: [...thread.pending.values()].map(({ id: approvalId, toolName, lines }) => ({
        id: approvalId,
        toolName,
        lines,
      })),
      answered: thread.answered,
    })
  })

  // The person's answer to a held tool call. The turn resumes with it: an
  // approved call runs, a declined one is reported to the model as such.
  app.post('/:id/approvals/:approvalId', async (c) => {
    const thread = threads.get(c.req.param('id'))
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    const approval = thread.pending.get(c.req.param('approvalId'))
    if (!approval) return c.json({ message: 'no such approval — it may have been answered already' }, 404)
    const body = (await c.req.json().catch(() => null)) as { approved?: unknown } | null
    if (typeof body?.approved !== 'boolean') return c.json({ message: 'expected { approved: true | false }' }, 400)

    thread.pending.delete(approval.id)
    // The message that asked is the last turn; the reply lands after it.
    const at = thread.session.turns.length
    const { resolve, ...card } = approval
    thread.answered.push({ ...card, approved: body.approved, at })
    if (thread.pending.size === 0) thread.state = 'thinking'
    thread.updatedAt = ++tick
    thread.sink?.({ type: 'approval-answered', id: approval.id, approved: body.approved, at })
    resolve(
      body.approved
        ? { approved: true, reason: 'User approved' }
        : { approved: false, reason: 'User declined. Do not request this tool again.' },
    )
    return c.json({ id: approval.id, approved: body.approved, at, waiting: thread.pending.size })
  })

  // What the model sees: the last rebuild's records, kept and cut, and the
  // story of how they got there, turn by turn. The stream carries counts
  // only; the documents themselves are here.
  const contextOf = (thread: Thread) => {
    const report = thread.context
    if (!report) return null
    return {
      turn: report.turn,
      documents: report.collectionSize,
      stats: report.stats ?? null,
      kept: report.kept,
      cut: report.cut,
      log: timelineOf(thread.session.contextLog, thread.session.turns),
    }
  }

  app.get('/:id/settings', (c) => {
    const settings = settingsOf(c.req.param('id'))
    return settings ? c.json(settings) : c.json({ message: 'this host has no settings' }, 404)
  })

  // Tune a thread: the model it thinks with, the reading budget. A live
  // thread changes between turns — a new budget reassembles its context at
  // once; a thread not yet built keeps the choice for when it is. A budget
  // of zero keeps the notebook closed: nothing read, nothing queried, until
  // a budget opens it again.
  app.post('/:id/settings', async (c) => {
    const id = c.req.param('id')
    const host = options.settings
    if (!host) return c.json({ message: 'this host has no settings' }, 404)
    const body = (await c.req.json().catch(() => null)) as { profile?: unknown; contextTokens?: unknown } | null
    const profile = body?.profile
    const tokens = body?.contextTokens
    if (profile === undefined && tokens === undefined) {
      return c.json({ message: 'expected { profile?: name, contextTokens?: count }' }, 400)
    }
    if (profile !== undefined && typeof profile !== 'string') return c.json({ message: 'profile must be a name' }, 400)
    if (tokens !== undefined && !(typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 0)) {
      return c.json({ message: 'contextTokens must be a whole number, zero or more' }, 400)
    }
    let chosen: ReturnType<ChatSettingsHost['resolve']> | undefined
    if (typeof profile === 'string') {
      try {
        chosen = host.resolve(profile)
      } catch (err) {
        return c.json({ message: (err as Error).message }, 400)
      }
    }

    const thread = threads.get(id)
    if (thread) {
      if (thread.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
      if (chosen && typeof profile === 'string') {
        thread.session.setModel(chosen.model, chosen.profile)
        thread.profile = profile
      }
      if (typeof tokens === 'number') thread.session.setContextTokens(tokens)
      thread.updatedAt = ++tick
    } else {
      const prefs = pending.get(id) ?? {}
      if (typeof profile === 'string') prefs.profile = profile
      if (typeof tokens === 'number') prefs.contextTokens = tokens
      pending.set(id, prefs)
    }
    return c.json(settingsOf(id))
  })

  app.get('/:id/context', (c) => {
    const thread = threads.get(c.req.param('id'))
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    const context = contextOf(thread)
    if (!context) {
      const closed = thread.session.contextTokens === 0
      return c.json(
        {
          message: closed
            ? 'Not reading your notebook for this thread.'
            : 'No context yet — the first message builds it.',
        },
        404,
      )
    }
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
