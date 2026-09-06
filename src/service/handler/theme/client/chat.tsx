import { ActionIcon, Button, Textarea } from '@mantine/core'
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { TokenUsage } from '#universal/ai/tokenUsage.ts'
import { ChatActivity, type TurnQueries } from './chatActivity.tsx'
import { ContextPanel } from './context.tsx'
import { BudgetControl, ModelControl, SavesControl, type ThreadSettings } from './controls.tsx'
import { splitLinks } from './links.ts'
import { ReplyDetails } from './replyDetails.tsx'
import { slackToMarkdown } from './slackMarkdown.ts'
import { awaitReturn, frames } from './turnStream.ts'
import { renderStatic } from './wysiwyg/render.ts'

/**
 * A conversation with sky — a client of the service's /chat routes.
 *
 * It renders the same event stream the terminal renders, and nothing more:
 * the person's turns as bubbles, sky's reply streamed into the body as it
 * arrives, tool calls as chips. The one thing it shows that a terminal
 * can't show as well is the gather: the first reply waits while sky reads
 * the notebook, and that wait appears as a line in the record's own voice,
 * with the real counts, rather than a spinner.
 *
 * The thread id comes from whoever mounts it — the day view for the day's
 * own conversation, the thread page for any other — so several can run at
 * once and the URL is the only state.
 */

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

export interface Turn {
  role: 'user' | 'assistant'
  content: string
  /** Notebook stamp `HH:MM` from the service, or a client clock */
  time?: string
  /** The reply rendered as HTML once it finished streaming */
  html?: string
  /** The gather that preceded this reply, kept as its provenance */
  note?: string
  /** What the reply cost, in tokens, every step summed */
  usage?: TokenUsage
  timing?: string
  /** The profile that answered, as the settings name it */
  model?: string
  error?: string
}

/** A tool call held for the person's go — the card in the thread. */
export interface Approval {
  id: string
  toolName: string
  /** The call as the tool describes it, line by line */
  lines: string[]
  /** Set when a go can stand for the session — the card offers "allow for this file" */
  sessionKey?: string
}

/** A call the person answered — kept in the thread as the record of what was allowed. */
export interface Answered extends Approval {
  approved: boolean
  /** The turn index the card sits before */
  at: number
}

/** One tool call at work, with what it printed — kept with the reply it belongs to. */
export interface Run {
  /** The tool as the model calls it (`google_agent`) */
  tool: string
  /** The reply's turn index */
  at: number
  /** Epoch milliseconds when it started */
  started: number
  lines: string[]
  /** How it ended; null while it runs */
  status: 'success' | 'fail' | 'error' | null
  /** One line on what it did, from a small model once it ended — the label it folds under */
  summary?: string
  /** What the call was about — the query, the page, the mission — from the model's record of it */
  subject?: string
}

/** A line in the record's voice: what happened to a thread, not a message in it. */
export interface Note {
  text: string
  tone: 'quiet' | 'done' | 'failed'
}

type Phase = 'idle' | 'busy' | 'saving'

export interface ThreadState {
  id: string
  turns: Turn[]
  phase: Phase
  /** The thread has been read back from the service (or found not to exist there) */
  loaded: boolean
  /** The gather line while it runs */
  gather: string | null
  /** The last files-read line — what the reply is grounded on; attaches to it as its note */
  provenance: string | null
  /** Files in context after the last rebuild */
  documents: number | null
  /** The model the thread thinks with and its reading budget; null until read from the service */
  settings: ThreadSettings | null
  /** Moves whenever the context may have changed — a rebuild, a finished turn, a new budget; the panel re-reads on it */
  contextVersion: number
  /** Tool calls waiting for the person's go, oldest first */
  approvals: Approval[]
  /** Calls answered this thread, oldest first */
  answered: Answered[]
  /** Tool runs this thread, oldest first — a running one has no status yet */
  runs: Run[]
  queries: TurnQueries[]
}

/**
 * Every action names the thread it belongs to. A turn keeps streaming in
 * the background after the page moves to another thread, and its actions
 * must land nowhere — not in whichever thread is showing now.
 */
type Action =
  | { type: 'reset'; id: string }
  | {
      type: 'loaded'
      id: string
      turns: Turn[]
      documents: number | null
      busy?: boolean
      approvals?: Approval[]
      answered?: Answered[]
      runs?: Run[]
      queries?: TurnQueries[]
    }
  /** The thread as the service holds it, read back while a turn runs without a stream on this page */
  | {
      type: 'refresh'
      id: string
      turns: Turn[]
      documents: number | null
      busy: boolean
      approvals: Approval[]
      answered: Answered[]
      runs: Run[]
      queries?: TurnQueries[]
    }
  | { type: 'approval'; id: string; approval: Approval }
  | { type: 'answered'; id: string; approvalId: string; approved: boolean; at: number }
  | { type: 'sent'; id: string; content: string }
  | { type: 'queries'; id: string; turn: number; queries: string[] }
  | { type: 'gather'; id: string; text: string; documents?: number; provenance?: boolean }
  | { type: 'delta'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; subject?: string }
  | { type: 'run-started'; id: string; run: Run }
  | { type: 'run-line'; id: string; tool: string; at: number; text: string }
  | { type: 'run-finished'; id: string; tool: string; at: number; status: Run['status'] }
  | { type: 'run-summary'; id: string; tool: string; at: number; text: string }
  | { type: 'finished'; id: string; content: string; usage?: TokenUsage; model?: string; timing?: string }
  | { type: 'failed'; id: string; message: string; timing?: string }
  | { type: 'rendered'; id: string; index: number; html: string }
  | { type: 'saving'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'lost'; id: string }
  | { type: 'settings'; id: string; settings: ThreadSettings }

function clock(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Ensure the turn being written is the reply, creating it on the first sign of one. */
/** Where the reply lands: the last turn when it has begun, the next index while it is still coming. */
function replyIndexOf(turns: Turn[]): number {
  return turns.at(-1)?.role === 'assistant' ? turns.length - 1 : turns.length
}

function withReply(turns: Turn[], edit: (reply: Turn) => Turn): Turn[] {
  const last = turns.at(-1)
  if (last?.role === 'assistant') return [...turns.slice(0, -1), edit(last)]
  return [...turns, edit({ role: 'assistant', content: '', time: clock() })]
}

function initial(id: string): ThreadState {
  return {
    id,
    turns: [],
    phase: 'idle',
    loaded: false,
    gather: null,
    provenance: null,
    documents: null,
    settings: null,
    contextVersion: 0,
    approvals: [],
    answered: [],
    runs: [],
    queries: [],
  }
}

const WAITING = 'waiting for your go'
/** Where the reply would be, while the page waits for the service to answer again */
const RESTARTING = 'sky is restarting'
/** A turn's stream is lost after this much silence; the service speaks at least every ten seconds while a turn runs */
const SILENCE_MS = 25_000
/** Under a message whose reply a restart took */
const LOST = 'sky restarted while replying. Send it again.'
const LOST_UNKEPT = "sky restarted while replying, and this chat isn't kept. Send it again to start over."
const AWAY = "sky didn't come back — is the service running?"

function reduce(state: ThreadState, action: Action): ThreadState {
  if (action.type !== 'reset' && action.id !== state.id) return state
  switch (action.type) {
    case 'reset':
      return initial(action.id)
    case 'loaded': {
      // A read-back that lands after the person already typed must not
      // erase what they sent; the service holds it either way.
      if (state.turns.length > 0) return { ...state, loaded: true, documents: state.documents ?? action.documents }
      // A turn still running on the service — from another page, or one
      // that reloaded mid-turn — shows as busy; its held calls show as cards.
      const approvals = action.approvals ?? []
      const busy = Boolean(action.busy)
      return {
        ...state,
        turns: action.turns,
        documents: action.documents,
        loaded: true,
        approvals,
        answered: action.answered ?? [],
        runs: action.runs ?? [],
        queries: action.queries ?? [],
        phase: busy ? 'busy' : state.phase,
        gather: busy ? (approvals.length > 0 ? WAITING : 'still working') : state.gather,
      }
    }
    case 'refresh':
      return {
        ...state,
        turns: action.turns,
        documents: action.documents,
        approvals: action.approvals,
        answered: action.answered,
        runs: action.runs,
        queries: action.queries ?? state.queries,
        phase: action.busy ? 'busy' : 'idle',
        gather: action.busy ? (action.approvals.length > 0 ? WAITING : 'still working') : null,
        contextVersion: action.busy ? state.contextVersion : state.contextVersion + 1,
      }
    case 'approval':
      if (state.approvals.some((a) => a.id === action.approval.id)) return state
      return { ...state, approvals: [...state.approvals, action.approval], gather: WAITING }
    case 'answered': {
      // The card stays, settled, as the record of what was allowed; the
      // stream and the answer's own response both say so — once is enough.
      const card = state.approvals.find((a) => a.id === action.approvalId)
      const approvals = state.approvals.filter((a) => a.id !== action.approvalId)
      const answered =
        card && !state.answered.some((a) => a.id === card.id)
          ? [...state.answered, { ...card, approved: action.approved, at: action.at }]
          : state.answered
      return { ...state, approvals, answered, gather: approvals.length > 0 ? WAITING : 'thinking' }
    }
    case 'sent':
      return {
        ...state,
        phase: 'busy',
        gather:
          state.settings?.contextTokens === 0
            ? 'not reading your notebook'
            : state.turns.length === 0
              ? 'reading your notebook'
              : 'finding what matters for this',
        provenance: null,
        turns: [...state.turns, { role: 'user', content: action.content, time: clock() }],
      }
    case 'queries':
      return {
        ...state,
        queries: [
          ...state.queries.filter((entry) => entry.turn !== action.turn),
          { turn: action.turn, queries: action.queries },
        ],
      }
    case 'gather':
      return {
        ...state,
        gather: action.text,
        provenance: action.provenance ? action.text : state.provenance,
        documents: action.documents ?? state.documents,
        contextVersion: action.provenance ? state.contextVersion + 1 : state.contextVersion,
      }
    case 'delta': {
      const note = state.provenance ?? undefined
      return {
        ...state,
        gather: null,
        turns: withReply(state.turns, (r) => ({ ...r, content: r.content + action.text, note: r.note ?? note })),
      }
    }
    case 'tool': {
      // The model's record of a call: the run that spoke for it takes what it was about; a quiet tool gets its chip.
      const at = replyIndexOf(state.turns)
      const i = state.runs.findLastIndex((r) => r.tool === action.name && r.at === at && r.subject === undefined)
      if (i >= 0) {
        if (!action.subject) return state
        return { ...state, runs: state.runs.map((r, k) => (k === i ? { ...r, subject: action.subject } : r)) }
      }
      const { subject } = action
      const chip: Run = { tool: action.name, at, started: Date.now(), lines: [], status: 'success', subject }
      return { ...state, runs: [...state.runs, chip] }
    }
    case 'run-started': {
      // A call that asked first was recorded before it ran: that chip becomes the run.
      const { run } = action
      const chip = state.runs.findIndex((r) => r.tool === run.tool && r.at === run.at && r.lines.length === 0)
      if (chip >= 0) {
        const runs = state.runs.map((r, i) => (i === chip ? { ...run, subject: run.subject ?? r.subject } : r))
        return { ...state, runs }
      }
      return { ...state, runs: [...state.runs, run] }
    }
    case 'run-line': {
      const i = state.runs.findLastIndex((r) => r.tool === action.tool && r.at === action.at)
      if (i < 0) {
        const run: Run = { tool: action.tool, at: action.at, started: Date.now(), lines: [action.text], status: null }
        return { ...state, runs: [...state.runs, run] }
      }
      return { ...state, runs: state.runs.map((r, k) => (k === i ? { ...r, lines: [...r.lines, action.text] } : r)) }
    }
    case 'run-finished': {
      const i = state.runs.findLastIndex((r) => r.tool === action.tool && r.at === action.at && r.status === null)
      if (i < 0) return state
      return { ...state, runs: state.runs.map((r, k) => (k === i ? { ...r, status: action.status } : r)) }
    }
    case 'run-summary': {
      const i = state.runs.findLastIndex((r) => r.tool === action.tool && r.at === action.at)
      if (i < 0) return state
      return { ...state, runs: state.runs.map((r, k) => (k === i ? { ...r, summary: action.text } : r)) }
    }
    case 'finished':
      return {
        ...state,
        phase: 'idle',
        gather: null,
        approvals: [],
        contextVersion: state.contextVersion + 1,
        // A run still open when the turn ends never reported its end — the turn did.
        runs: state.runs.map((r) => (r.status === null ? { ...r, status: 'success' } : r)),
        turns: withReply(state.turns, (r) => ({
          ...r,
          content: action.content,
          note: r.note ?? state.provenance ?? undefined,
          usage: action.usage ?? r.usage,
          timing: action.timing ?? r.timing,
          model: action.model ?? r.model,
        })),
      }
    case 'failed':
      return {
        ...state,
        phase: 'idle',
        gather: null,
        approvals: [],
        contextVersion: state.contextVersion + 1,
        runs: state.runs.map((r) => (r.status === null ? { ...r, status: 'error' } : r)),
        turns: withReply(state.turns, (r) => ({ ...r, error: action.message, timing: action.timing ?? r.timing })),
      }
    case 'lost':
      // The connection ended before the reply did. What the tools were doing is unknown now; the read-back will say.
      return {
        ...state,
        gather: RESTARTING,
        approvals: [],
        runs: state.runs.map((r) => (r.status === null ? { ...r, status: 'error' } : r)),
      }
    case 'rendered':
      return { ...state, turns: state.turns.map((t, i) => (i === action.index ? { ...t, html: action.html } : t)) }
    case 'saving':
      return { ...state, phase: 'saving' }
    case 'ended':
      return { ...state, phase: 'idle' }
    case 'settings':
      // A new budget reassembles the context on the service; its counts come back with the settings.
      return {
        ...state,
        settings: action.settings,
        documents: action.settings.kept ?? state.documents,
        contextVersion: state.contextVersion + 1,
      }
  }
}

// -----------------------------------------------------------------------------
// The wire
// -----------------------------------------------------------------------------

/** A reply's markdown as HTML — null on any rendering failure, leaving the raw text to stand. */
function renderMarkdown(raw: string): string | null {
  try {
    return renderStatic(raw)
  } catch {
    return null
  }
}

export function humanize(toolName: string): string {
  return toolName.replaceAll('_', ' ')
}

/** The tool's name as a heading: `google_agent` → `Google Agent`. */
function titleOf(toolName: string): string {
  return humanize(toolName).replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/** First words of the first message — how a thread is named until it is saved. */
export function threadTitle(turns: Turn[]): string | null {
  const first = turns.find((t) => t.role === 'user')
  return first ? first.content.split(/\s+/).slice(0, 8).join(' ') : null
}

// -----------------------------------------------------------------------------
// The hook — everything a page needs to drive one thread
// -----------------------------------------------------------------------------

/** A thread as the service reads it back. */
interface ThreadBody {
  turns: Array<{ role: 'user' | 'assistant'; content: string; when?: string }>
  documents: number
  kept: number | null
  busy?: boolean
  pending?: Approval[]
  answered?: Answered[]
  runs?: Run[]
  queries?: TurnQueries[]
  /** Each reply's counts and the profile that answered, by turn index */
  usage?: Array<TokenUsage & { at: number; model: string }>
  timings?: Array<{ at: number; text: string }>
}

function turnsOf(body: ThreadBody): Turn[] {
  const usageAt = new Map((body.usage ?? []).map(({ at, model, ...usage }) => [at, { usage, model }]))
  return body.turns.map((t, i) => ({
    role: t.role,
    content: t.content,
    time: t.when?.slice(11),
    html: t.role === 'assistant' ? (renderMarkdown(t.content) ?? undefined) : undefined,
    usage: usageAt.get(i)?.usage,
    model: usageAt.get(i)?.model,
    timing: body.timings?.find((entry) => entry.at === i)?.text,
  }))
}

export function useChat(id: string) {
  const [state, dispatch] = useReducer(reduce, id, initial)
  const [tuning, setTuning] = useState(0)
  const tuningCount = useRef(0)
  // True while this page reads a turn's stream — then the stream, not a poll, keeps the thread current.
  const attached = useRef(false)

  // The thread is read back from the service whenever the id changes; one
  // the service doesn't hold (never messaged, or the service restarted)
  // starts empty.
  useEffect(() => {
    dispatch({ type: 'reset', id })
    if (!id) return
    let cancelled = false
    const empty = () => dispatch({ type: 'loaded', id, turns: [], documents: null })
    fetch(`/chat/${id}`)
      .then(async (response) => {
        if (cancelled) return
        if (!response.ok) return empty()
        const body = (await response.json()) as ThreadBody
        dispatch({
          type: 'loaded',
          id,
          turns: turnsOf(body),
          documents: body.kept ?? body.documents,
          busy: body.busy,
          approvals: body.pending ?? [],
          answered: body.answered ?? [],
          runs: body.runs ?? [],
          queries: body.queries ?? [],
        })
      })
      .catch(() => {
        if (!cancelled) empty()
      })
    return () => {
      cancelled = true
    }
  }, [id])

  // A turn running on the service without a stream on this page — the page
  // reloaded mid-turn, or answered a held call from a fresh load — is
  // followed by re-reading the thread until it settles.
  useEffect(() => {
    if (state.phase !== 'busy' || attached.current || !id) return
    let alive = true
    const timer = setInterval(() => {
      fetch(`/chat/${id}`)
        .then(async (response) => {
          if (!alive || !response.ok) return
          const body = (await response.json()) as ThreadBody
          dispatch({
            type: 'refresh',
            id,
            turns: turnsOf(body),
            documents: body.kept ?? body.documents,
            busy: Boolean(body.busy),
            approvals: body.pending ?? [],
            answered: body.answered ?? [],
            runs: body.runs ?? [],
            queries: body.queries ?? [],
          })
        })
        .catch(() => {})
    }, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [state.phase, id])

  // The person's answer to a held call. The stream carries the same news
  // back; either arrival clears the card.
  const answer = useCallback(
    async (approvalId: string, approved: boolean, always = false) => {
      if (!state.id) return
      const id = state.id
      const response = await fetch(`/chat/${id}/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved, always }),
      }).catch(() => null)
      if (!response?.ok) return
      const body = (await response.json()) as { approved: boolean; at: number }
      dispatch({ type: 'answered', id, approvalId, approved: body.approved, at: body.at })
    },
    [state.id],
  )

  // The thread's tuning — the host's defaults until the person changes it.
  useEffect(() => {
    if (!id) return
    let cancelled = false
    fetch(`/chat/${id}/settings`)
      .then(async (response) => {
        if (cancelled || !response.ok) return
        dispatch({ type: 'settings', id, settings: (await response.json()) as ThreadSettings })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  // Tune the thread: what comes back is the tuning as the service holds it.
  const tune = useCallback(
    async (change: { profile?: string; contextTokens?: number; saves?: boolean }) => {
      if (!state.id) return
      const id = state.id
      tuningCount.current++
      setTuning(tuningCount.current)
      try {
        const response = await fetch(`/chat/${id}/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(change),
        }).catch(() => null)
        if (!response?.ok) return
        dispatch({ type: 'settings', id, settings: (await response.json()) as ThreadSettings })
      } finally {
        tuningCount.current--
        setTuning(tuningCount.current)
      }
    },
    [state.id],
  )
  const setModel = useCallback((profile: string) => tune({ profile }), [tune])
  const setContextTokens = useCallback((contextTokens: number) => tune({ contextTokens }), [tune])
  const setSaves = useCallback((saves: boolean) => tune({ saves }), [tune])

  const send = useCallback(
    async (content: string) => {
      const message = content.trim()
      if (!message || !state.id || state.phase !== 'idle' || !state.settings || tuningCount.current > 0) return
      const id = state.id
      // Capture once: every retry carries exactly what the composer showed.
      const body = JSON.stringify({
        message,
        profile: state.settings.model.current,
        contextTokens: state.settings.contextTokens,
        saves: state.settings.saves,
      })
      // Attached before the phase turns busy, or the follow-by-poll would
      // start and overwrite the streaming reply with the service's read-back.
      attached.current = true
      dispatch({ id, type: 'sent', content: message })
      const replyIndex = state.turns.length + 1

      // A message the service never received is safe to send again: when it
      // cannot be reached, the page waits for it the way the terminal does,
      // on the restart schedule, and sends once it answers.
      const post = () =>
        fetch(`/chat/${id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        })
      let response: Response
      try {
        response = await post()
      } catch {
        dispatch({ id, type: 'lost' })
        const back = await awaitReturn(post)
        if (back.kind !== 'answered') {
          attached.current = false
          dispatch({ id, type: 'failed', message: AWAY })
          return
        }
        response = back.response
      }
      if (!response.ok) {
        attached.current = false
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        dispatch({ id, type: 'failed', message: body.message ?? `The service answered ${response.status}.` })
        return
      }

      let finished = false
      try {
        for await (const frame of frames(response, SILENCE_MS)) {
          const d = frame.data
          switch (frame.event) {
            case 'approval-request':
              dispatch({ id, type: 'approval', approval: d.approval as Approval })
              break
            case 'approval-answered':
              dispatch({
                id,
                type: 'answered',
                approvalId: d.id as string,
                approved: d.approved as boolean,
                at: d.at as number,
              })
              break
            case 'session-started':
              dispatch({
                id,
                type: 'gather',
                text: d.closed ? 'not reading your notebook' : `reading your notebook · ${d.documents} files`,
                documents: d.documents as number,
              })
              break
            case 'context-gathering':
              dispatch({ id, type: 'gather', text: 'finding what matters for this' })
              break
            case 'context-queries':
              dispatch({ id, type: 'queries', turn: d.turn as number, queries: d.queries as string[] })
              break
            case 'queries-changed':
              dispatch({ id, type: 'gather', text: 'searching your notebook' })
              break
            case 'context-rebuilt': {
              const report = d.report as { collectionSize: number; stats?: { kept: number } }
              const kept = report.stats ? ` · ${report.stats.kept} in context` : ''
              dispatch({
                id,
                type: 'gather',
                text: `${report.collectionSize} files read${kept}`,
                provenance: true,
                documents: report.stats?.kept ?? report.collectionSize,
              })
              break
            }
            case 'model-start':
              dispatch({ id, type: 'gather', text: 'thinking' })
              break
            case 'text-delta':
              dispatch({ id, type: 'delta', text: d.text as string })
              break
            case 'tool-call':
              dispatch({ id, type: 'tool', name: d.toolName as string, subject: d.subject as string | undefined })
              break
            case 'tool-started':
              dispatch({ id, type: 'run-started', run: d.run as Run })
              break
            case 'tool-line':
              dispatch({ id, type: 'run-line', tool: d.tool as string, at: d.at as number, text: d.text as string })
              break
            case 'tool-finished':
              dispatch({
                id,
                type: 'run-finished',
                tool: d.tool as string,
                at: d.at as number,
                status: d.status as Run['status'],
              })
              break
            case 'tool-summary':
              dispatch({ id, type: 'run-summary', tool: d.tool as string, at: d.at as number, text: d.text as string })
              break
            case 'turn': {
              finished = true
              if (typeof d.error === 'string') {
                dispatch({ id, type: 'failed', message: d.error, timing: d.timingText as string | undefined })
              } else {
                const text = d.text as string
                const sources = (d.sourceUrls as string[]) ?? []
                const content = sources.length
                  ? `${text}\n\nSources:\n${sources.map((u) => `- ${u}`).join('\n')}`
                  : text
                dispatch({
                  id,
                  type: 'finished',
                  content,
                  usage: d.usage as TokenUsage | undefined,
                  timing: d.timingText as string | undefined,
                  model: d.model as string | undefined,
                })
                const html = renderMarkdown(content)
                if (html) dispatch({ id, type: 'rendered', index: replyIndex, html })
              }
              break
            }
            case 'error':
              finished = true
              dispatch({ id, type: 'failed', message: d.message as string })
              break
          }
        }
      } catch {
        // Silence past the deadline, or the socket failing: the connection is lost, not the turn decided.
      } finally {
        // Still attached through the wait below, or the poller would read the thread back over the message just sent.
        if (finished) attached.current = false
      }
      if (!finished) {
        try {
          await reattach(id, replyIndex, dispatch)
        } finally {
          attached.current = false
        }
      }
      followSummaries(id, dispatch)
    },
    [state.id, state.phase, state.turns.length, state.settings],
  )

  // Ending a thread files it through the same gate as ai:chat (or drops
  // it). What comes back is the record of that — the lines a day shows.
  // Every write the save makes to the machine-owned stores is among them;
  // silence means nothing was written.
  const end = useCallback(
    async (save: boolean): Promise<Note[]> => {
      if (!state.id || state.phase !== 'idle' || state.turns.length === 0) return []
      const id = state.id
      dispatch({ id, type: 'saving' })
      try {
        const response = await fetch(`/chat/${id}/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ save }),
        })
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { message?: string }
          return [{ text: `Couldn't save — ${body.message ?? response.status}. Try again.`, tone: 'failed' }]
        }
        const { saved } = (await response.json()) as {
          saved: {
            summary: string
            exchanges: number
            aborted?: { reason: string }
            memoryOps?: Array<{ op: string; summary: string; outcome: string }>
            personOps?: Array<{ op?: string; summary?: string; name?: string; outcome?: string }>
          } | null
        }
        const notes: Note[] = []
        if (!saved) notes.push({ text: save ? 'Nothing to save' : 'Discarded — nothing kept', tone: 'quiet' })
        else if (saved.aborted)
          notes.push({ text: `Not saved — ${saved.aborted.reason}. A recovery copy was written.`, tone: 'failed' })
        else
          notes.push({
            text: `Saved as “${saved.summary}” · ${saved.exchanges} turn${saved.exchanges === 1 ? '' : 's'}`,
            tone: 'done',
          })
        for (const m of saved?.memoryOps ?? []) {
          if (m.outcome !== 'skipped') notes.push({ text: `🧠 ${m.op}: ${m.summary}`, tone: 'quiet' })
        }
        for (const p of saved?.personOps ?? []) {
          if (p.outcome !== 'skipped')
            notes.push({ text: `👤 ${p.op ?? 'updated'}: ${p.summary ?? p.name ?? ''}`, tone: 'quiet' })
        }
        return notes
      } catch {
        return [{ text: "Couldn't reach sky — is the service running?", tone: 'failed' }]
      } finally {
        dispatch({ id, type: 'ended' })
      }
    },
    [state.id, state.phase, state.turns.length],
  )

  // The reset for a new id lands in an effect, one render late. Until then the
  // store still holds the previous thread; the caller must never see it.
  return {
    state: state.id === id ? state : initial(id),
    tuning: tuning > 0,
    send,
    end,
    setModel,
    setContextTokens,
    setSaves,
    answer,
  }
}

export type Chat = ReturnType<typeof useChat>

// -----------------------------------------------------------------------------
// Rendering
// -----------------------------------------------------------------------------

/**
 * Follow the reply as it streams, unless the reader scrolled up to read.
 * "Near the bottom" is judged against the height before this change — a
 * rendered reply can grow by a whole screen at once.
 */
export function useFollow(ref: RefObject<HTMLDivElement | null>, deps: unknown[], active = true) {
  const lastHeight = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wasNearBottom = lastHeight.current - el.scrollTop - el.clientHeight < 160
    if (active && wasNearBottom) el.scrollTop = el.scrollHeight
    lastHeight.current = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * The connection ended before the reply did — the service restarted under
 * the turn, or the socket died. The page waits for the service the way the
 * terminal does, saying so where the reply would be, and takes the thread
 * as the service holds it once it answers: a turn still running there is
 * followed by the poller; one that came back complete is shown; a thread
 * that came back without the message, or not at all, lost its reply to the
 * restart, and the page says so under the message.
 */
async function reattach(id: string, replyIndex: number, dispatch: (action: Action) => void): Promise<void> {
  dispatch({ id, type: 'lost' })
  const back = await awaitReturn(() => fetch(`/chat/${id}`))
  if (back.kind === 'gone') return dispatch({ id, type: 'failed', message: LOST_UNKEPT })
  if (back.kind === 'away' || !back.response.ok) return dispatch({ id, type: 'failed', message: AWAY })
  const body = (await back.response.json()) as ThreadBody
  // The reply sits at replyIndex: a thread that reached it, or is still at work, holds the truth. Shorter lost the turn.
  if (!body.busy && body.turns.length <= replyIndex) return dispatch({ id, type: 'failed', message: LOST })
  dispatch({
    id,
    type: 'refresh',
    turns: turnsOf(body),
    documents: body.kept ?? body.documents,
    busy: Boolean(body.busy),
    approvals: body.pending ?? [],
    answered: body.answered ?? [],
    runs: body.runs ?? [],
    queries: body.queries ?? [],
  })
}

/** When the page reads a thread back for a run's line that came after its turn ended. */
const SUMMARY_FOLLOW_UP_MS = [2000, 6000, 15000]

/**
 * A run's one line comes from a model as the run ends, and a quick reply
 * can end the turn — and the stream — before it lands. It is on the thread
 * by then; the page reads it back a few times, stopping once every ended
 * run that said more than one thing has its line.
 */
function followSummaries(id: string, dispatch: (action: Action) => void, attempt = 0): void {
  const delay = SUMMARY_FOLLOW_UP_MS[attempt]
  if (delay === undefined) return
  setTimeout(() => {
    fetch(`/chat/${id}`)
      .then(async (response) => {
        if (!response.ok) return
        const runs = ((await response.json()) as ThreadBody).runs ?? []
        for (const run of runs) {
          if (run.summary) dispatch({ id, type: 'run-summary', tool: run.tool, at: run.at, text: run.summary })
        }
        if (runs.some((run) => run.status !== null && run.lines.length > 1 && !run.summary)) {
          followSummaries(id, dispatch, attempt + 1)
        }
      })
      .catch(() => {})
  }, delay)
}

/** Seconds since a moment, ticking once a second while `active`. */
function useElapsed(since: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return Math.max(0, Math.floor((now - since) / 1000))
}

function elapsedLabel(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`
}

/**
 * A tool at work, in its own words. The chip names it, and what the call
 * was about once the model's record of it lands; while it runs, the line
 * under the chip is the last thing it said, with the time since it
 * started; a click opens everything it said. Once done the run folds to
 * one line — a caret, the tool's name, and what it did in a small model's
 * words (its last line until that arrives) — and a click on that line
 * unfolds the record of what the tool said.
 */
function RunView({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const running = run.status === null
  // Ending folds the run, even one opened to watch it work.
  useEffect(() => {
    if (!running) setOpen(false)
  }, [running])
  const seconds = useElapsed(run.started, running)
  const count = run.lines.length
  const last = run.lines.at(-1)
  const folded = !running && count > 0
  return (
    <div className="sky-tool-run" data-running={running} data-status={run.status ?? undefined}>
      {folded ? (
        <button
          type="button"
          className="sky-tool-fold"
          data-act="true"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="sky-tool-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="sky-tool-fold-name">{titleOf(run.tool)} Output</span>
          <span className="sky-tool-fold-summary">{run.summary ?? last}</span>
        </button>
      ) : (
        <button
          type="button"
          className="sky-chip sky-tool-chip"
          data-act="true"
          data-open={open}
          onClick={count > 0 ? () => setOpen((o) => !o) : undefined}
          aria-expanded={count > 0 ? open : undefined}
        >
          {running && <span className="sky-tool-pulse" aria-hidden="true" />}
          {humanize(run.tool)}
          {run.subject && <span className="sky-tool-subject">{run.subject}</span>}
          {count > 0 && <span className="sky-tool-meta">{elapsedLabel(seconds)}</span>}
        </button>
      )}
      {running && last && !open && <div className="sky-tool-last">{last}</div>}
      {open && (
        <div className="sky-tool-lines">
          {run.lines.map((line, i) => (
            <div key={i} className="sky-tool-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function RunList({ runs }: { runs: Run[] }) {
  return (
    <div className="sky-tool-runs">
      {runs.map((run, i) => (
        <Fragment key={`${run.tool}-${run.at}-${i}`}>
          <RunView run={run} />
        </Fragment>
      ))}
    </div>
  )
}

/**
 * A tool call held for the person: what it would do, and the go or the
 * no. Once answered the card stays as the record, settled. The call reads
 * as it will land — a Slack message in Slack's own marks rendered, any
 * other as markdown — with the raw text a click away.
 */
function ApprovalCard({
  approval,
  answered,
  onAnswer,
}: {
  approval: Approval
  /** How it was answered, when it was */
  answered?: boolean
  onAnswer?: (approved: boolean, always?: boolean) => void
}) {
  const [raw, setRaw] = useState(false)
  const text = approval.lines.join('\n')
  const rich = raw ? null : renderMarkdown(approval.toolName.startsWith('slack') ? slackToMarkdown(text) : text)
  return (
    <div className="sky-ask" data-answered={answered === undefined ? undefined : answered}>
      <div className="sky-ask-head">
        <span className="sky-chip" data-act="true">
          {humanize(approval.toolName)}
        </span>
        <span>{answered === undefined ? 'needs your go' : answered ? 'allowed' : 'declined'}</span>
        <span className="sky-ask-view">
          <button type="button" className="sky-ctl" data-open={!raw} onClick={() => setRaw(false)}>
            Rich
          </button>
          <button type="button" className="sky-ctl" data-open={raw} onClick={() => setRaw(true)}>
            Raw
          </button>
        </span>
      </div>
      {rich ? (
        <div className="sky-ask-body sky-rendered" dangerouslySetInnerHTML={{ __html: rich }} />
      ) : (
        <pre className="sky-ask-body">{text}</pre>
      )}
      {onAnswer && answered === undefined && (
        <div className="sky-ask-acts">
          <Button variant="light" color="blue" size="sm" onClick={() => onAnswer(true)}>
            Allow
          </Button>
          {approval.sessionKey && (
            <Button variant="subtle" color="blue" size="sm" onClick={() => onAnswer(true, true)}>
              Allow for this file
            </Button>
          )}
          <Button size="sm" onClick={() => onAnswer(false)}>
            Not now
          </Button>
        </div>
      )}
    </div>
  )
}

export function NoteLine({ note }: { note: Note }) {
  return (
    <div className="sky-condensed" data-tone={note.tone}>
      — {note.text} —
    </div>
  )
}

/** The thread's turns, the gather line while it runs, the saving line. No header, no composer. */
export function ThreadColumn({ chat }: { chat: Chat }) {
  const { state, answer } = chat
  const busy = state.phase !== 'idle'
  // A tool at work speaks for the wait; the quiet line would only say "thinking" over it.
  const running = state.runs.some((run) => run.status === null)
  const lastUser = state.turns.findLastIndex((turn) => turn.role === 'user')
  const coming = state.runs.filter((run) => run.at >= state.turns.length)
  // An answered card sits before the reply it preceded; past the last turn while that reply is still coming.
  const settled = (at: number) =>
    state.answered
      .filter((card) => card.at === at)
      .map((card) => (
        <Fragment key={card.id}>
          <ApprovalCard approval={card} answered={card.approved} />
        </Fragment>
      ))
  return (
    <>
      {state.turns.map((turn, i) => (
        <Fragment key={i}>
          {turn.role === 'user' && settled(i)}
          <TurnView
            turn={turn}
            streaming={busy && i === state.turns.length - 1 && turn.role === 'assistant'}
            cards={turn.role === 'assistant' ? settled(i) : undefined}
            runs={turn.role === 'assistant' ? state.runs.filter((run) => run.at === i) : undefined}
            labelOf={(profile) => state.settings?.model.choices.find((c) => c.name === profile)?.label ?? profile}
          />
          {turn.role === 'user' && (
            <Fragment key={`${state.id}-${i}`}>
              <ChatActivity
                active={state.phase === 'busy' && i === lastUser}
                text={state.approvals.length > 0 || running ? null : state.gather}
                queries={state.queries.find((entry) => entry.turn === Math.floor(i / 2) + 1)?.queries}
              />
            </Fragment>
          )}
        </Fragment>
      ))}
      {state.answered
        .filter((card) => card.at >= state.turns.length)
        .map((card) => (
          <Fragment key={card.id}>
            <ApprovalCard approval={card} answered={card.approved} />
          </Fragment>
        ))}
      {state.approvals.map((approval) => (
        <Fragment key={approval.id}>
          <ApprovalCard
            approval={approval}
            onAnswer={(approved, always) => void answer(approval.id, approved, always)}
          />
        </Fragment>
      ))}
      {/* Runs for a reply that has not begun sit where it will land. */}
      {coming.length > 0 && <RunList runs={coming} />}
      {state.phase === 'saving' && <ChatActivity active text="saving" />}
    </>
  )
}

export interface ComposerAttach {
  /** The file kinds the picker offers */
  accept: string
  onFiles: (files: File[]) => void
}

export function Composer({
  chat,
  placeholder,
  hints,
  attach,
}: {
  chat: Chat
  placeholder: string
  hints: ReactNode
  /** A + before the input that picks files — the door for people who don't drag */
  attach?: ComposerAttach
}) {
  const { state, send } = chat
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = state.phase !== 'idle'
  const canSend = !busy && !chat.tuning && state.settings !== null

  const submit = () => {
    if (!canSend) return
    const el = inputRef.current
    if (!el) return
    const text = el.value
    el.value = ''
    void send(text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="sky-composer-zone">
      <div className="sky-composer">
        {attach && (
          <>
            <input
              ref={fileRef}
              type="file"
              hidden
              multiple
              accept={attach.accept}
              onChange={(event) => {
                const list = event.target.files
                const files: File[] = list ? Array.from(list) : []
                event.target.value = ''
                if (files.length > 0) attach.onFiles(files)
              }}
            />
            <ActionIcon aria-label="Add a file" onClick={() => fileRef.current?.click()}>
              ＋
            </ActionIcon>
          </>
        )}
        <div className="sky-input">
          <Textarea
            ref={inputRef}
            variant="unstyled"
            classNames={{ root: 'sky-input-root', input: 'sky-input-field' }}
            autosize
            minRows={1}
            maxRows={8}
            placeholder={placeholder}
            aria-label={placeholder}
            onKeyDown={onKeyDown}
            disabled={busy}
            autoFocus
          />
        </div>
        <ActionIcon variant="light" color="blue" aria-label="Send" onClick={submit} disabled={!canSend}>
          ↑
        </ActionIcon>
      </div>
      <div className="sky-under">
        {state.settings && (
          <>
            <ModelControl chat={chat} />
            <span className="sky-hint">·</span>
            <BudgetControl chat={chat} />
            <span className="sky-hint">·</span>
            <SavesControl chat={chat} />
          </>
        )}
        {/* The keys are worth a word before the first message; after it the tuning takes the room. */}
        {state.turns.length === 0 && (
          <>
            {state.settings && <span className="sky-hint">·</span>}
            {hints}
          </>
        )}
        {/* The count says what sky read; a closed notebook's control already says nothing was. */}
        {state.documents !== null && state.settings?.contextTokens !== 0 && (
          <>
            <span className="sky-hint">·</span>
            <span>{state.documents} files in context</span>
          </>
        )}
      </div>
    </div>
  )
}

const KEY_HINTS = (
  <>
    <span className="sky-hint">Enter to send</span>
    <span className="sky-hint">·</span>
    <span className="sky-hint">Shift+Enter for a new line</span>
  </>
)

/** A thread as its own page. */
export function ChatMain({
  chat,
  title,
  back,
  onEnd,
}: {
  chat: Chat
  title: string
  back: { label: string; onClick: () => void }
  onEnd: () => void
}) {
  const { state } = chat
  const scrollRef = useRef<HTMLDivElement>(null)
  useFollow(scrollRef, [state.turns, state.gather])
  const busy = state.phase !== 'idle'
  const empty = state.turns.length === 0 && !state.gather
  const [panel, setPanel] = useState(false)

  return (
    <div className="sky-main">
      <header className="sky-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title">{title}</span>
        <nav className="sky-tabs">
          {state.documents !== null && (
            <Button size="sm" onClick={() => setPanel((open) => !open)} data-active={panel}>
              Context · {state.documents}
            </Button>
          )}
          {state.turns.length > 0 && (
            <Button size="sm" onClick={onEnd} disabled={busy}>
              {state.settings?.saves === false
                ? state.phase === 'saving'
                  ? 'Closing…'
                  : 'Discard'
                : state.phase === 'saving'
                  ? 'Saving…'
                  : 'Save & close'}
            </Button>
          )}
        </nav>
      </header>

      <div className="sky-split">
        <div className="sky-split-main">
          <div className="sky-scroll" ref={scrollRef}>
            {empty ? (
              <div className="sky-blank">
                <p>Ask about your notebook. Answers come from your files.</p>
              </div>
            ) : (
              <div className="sky-col">
                <ThreadColumn chat={chat} />
              </div>
            )}
          </div>

          <Composer chat={chat} placeholder="Message sky…" hints={KEY_HINTS} />
        </div>
        {panel && (
          <ContextPanel
            id={state.id}
            version={state.contextVersion}
            busy={busy}
            live={busy ? state.gather : null}
            onClose={() => setPanel(false)}
          />
        )}
      </div>
    </div>
  )
}

export function TurnView({
  turn,
  streaming,
  cards,
  runs,
  labelOf,
}: {
  turn: Turn
  streaming: boolean
  /** The calls answered on the way to this reply — after the reading, before the words */
  cards?: ReactNode
  /** The tools this reply ran, with what each said */
  runs?: Run[]
  /** The settings' label for a profile name, for the usage line; the name itself when absent */
  labelOf?: (profile: string) => string
}) {
  if (turn.role === 'user') {
    // What the person typed, verbatim — an address in it is a link out.
    return (
      <div className="sky-turn sky-turn-user">
        <div className="sky-bubble">
          {splitLinks(turn.content).map((run, i) =>
            run.url ? (
              <a key={i} href={run.url} target="_blank" rel="noopener noreferrer">
                {run.text}
              </a>
            ) : (
              <Fragment key={i}>{run.text}</Fragment>
            ),
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {turn.note && <div className="sky-condensed">— {turn.note} —</div>}
      {cards}
      <div className="sky-turn">
        <span className="sky-who">sky{turn.time ? ` · ${turn.time}` : ''}</span>
        {turn.html ? (
          <div className="sky-body sky-rendered" dangerouslySetInnerHTML={{ __html: turn.html }} />
        ) : (
          <div className="sky-body">
            {/* A reply that has only called tools so far has no paragraph yet — one caret, below. */}
            {(turn.content === '' ? [] : turn.content.split(/\n{2,}/)).map((para, i, all) => (
              <p key={i} className="sky-para">
                {para}
                {streaming && i === all.length - 1 && <span className="sky-caret" aria-hidden="true" />}
              </p>
            ))}
            {streaming && turn.content === '' && (
              <p className="sky-para">
                <span className="sky-caret" aria-hidden="true" />
              </p>
            )}
          </div>
        )}
        {runs && runs.length > 0 && <RunList runs={runs} />}
        {turn.error && <span className="sky-fate">turn failed — {turn.error}</span>}
        {!streaming && (
          <ReplyDetails
            usage={turn.usage}
            model={turn.model ? (labelOf ?? ((p) => p))(turn.model) : undefined}
            timing={turn.timing}
          />
        )}
      </div>
    </>
  )
}
