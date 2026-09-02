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
import { ContextPanel } from './context.tsx'
import { BudgetControl, ModelControl, type ThreadSettings } from './controls.tsx'
import { slackToMarkdown } from './slackMarkdown.ts'
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
  /** Tools the reply called, in order */
  tools?: string[]
  /** The gather that preceded this reply, kept as its provenance */
  note?: string
  error?: string
}

/** A tool call held for the person's go — the card in the thread. */
export interface Approval {
  id: string
  toolName: string
  /** The call as the tool describes it, line by line */
  lines: string[]
}

/** A call the person answered — kept in the thread as the record of what was allowed. */
export interface Answered extends Approval {
  approved: boolean
  /** The turn index the card sits before */
  at: number
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
    }
  | { type: 'approval'; id: string; approval: Approval }
  | { type: 'answered'; id: string; approvalId: string; approved: boolean; at: number }
  | { type: 'sent'; id: string; content: string }
  | { type: 'gather'; id: string; text: string; documents?: number; provenance?: boolean }
  | { type: 'delta'; id: string; text: string }
  | { type: 'tool'; id: string; name: string }
  | { type: 'finished'; id: string; content: string }
  | { type: 'failed'; id: string; message: string }
  | { type: 'rendered'; id: string; index: number; html: string }
  | { type: 'saving'; id: string }
  | { type: 'ended'; id: string }
  | { type: 'settings'; id: string; settings: ThreadSettings }

function clock(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** Ensure the turn being written is the reply, creating it on the first sign of one. */
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
  }
}

const WAITING = 'waiting for your go'

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
        gather: state.turns.length === 0 ? 'reading your notebook' : null,
        provenance: null,
        turns: [...state.turns, { role: 'user', content: action.content, time: clock() }],
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
    case 'tool':
      return { ...state, turns: withReply(state.turns, (r) => ({ ...r, tools: [...(r.tools ?? []), action.name] })) }
    case 'finished':
      return {
        ...state,
        phase: 'idle',
        gather: null,
        approvals: [],
        contextVersion: state.contextVersion + 1,
        turns: withReply(state.turns, (r) => ({
          ...r,
          content: action.content,
          note: r.note ?? state.provenance ?? undefined,
        })),
      }
    case 'failed':
      return {
        ...state,
        phase: 'idle',
        gather: null,
        approvals: [],
        contextVersion: state.contextVersion + 1,
        turns: withReply(state.turns, (r) => ({ ...r, error: action.message })),
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

interface Frame {
  event: string
  data: Record<string, unknown>
}

/** Frames off a streaming response, as they complete. */
async function* frames(response: Response): AsyncGenerator<Frame> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let end = buffer.indexOf('\n\n')
    while (end >= 0) {
      const raw = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      let event = 'message'
      let data = ''
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      yield { event, data: data ? (JSON.parse(data) as Record<string, unknown>) : {} }
      end = buffer.indexOf('\n\n')
    }
  }
}

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
}

function turnsOf(body: ThreadBody): Turn[] {
  return body.turns.map((t) => ({
    role: t.role,
    content: t.content,
    time: t.when?.slice(11),
    html: t.role === 'assistant' ? (renderMarkdown(t.content) ?? undefined) : undefined,
  }))
}

export function useChat(id: string) {
  const [state, dispatch] = useReducer(reduce, id, initial)
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
    async (approvalId: string, approved: boolean) => {
      if (!state.id) return
      const id = state.id
      const response = await fetch(`/chat/${id}/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approved }),
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
    async (change: { profile?: string; contextTokens?: number }) => {
      if (!state.id) return
      const id = state.id
      const response = await fetch(`/chat/${id}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(change),
      }).catch(() => null)
      if (!response?.ok) return
      dispatch({ type: 'settings', id, settings: (await response.json()) as ThreadSettings })
    },
    [state.id],
  )
  const setModel = useCallback((profile: string) => tune({ profile }), [tune])
  const setContextTokens = useCallback((contextTokens: number) => tune({ contextTokens }), [tune])

  const send = useCallback(
    async (content: string) => {
      const message = content.trim()
      if (!message || !state.id || state.phase !== 'idle') return
      const id = state.id
      // Attached before the phase turns busy, or the follow-by-poll would
      // start and overwrite the streaming reply with the service's read-back.
      attached.current = true
      dispatch({ id, type: 'sent', content: message })
      const replyIndex = state.turns.length + 1

      let response: Response
      try {
        response = await fetch(`/chat/${id}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        })
      } catch {
        attached.current = false
        dispatch({ id, type: 'failed', message: "Couldn't reach sky — is the service running?" })
        return
      }
      if (!response.ok) {
        attached.current = false
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        dispatch({ id, type: 'failed', message: body.message ?? `The service answered ${response.status}.` })
        return
      }

      let finished = false
      try {
        for await (const frame of frames(response)) {
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
                text: `reading your notebook · ${d.documents} files`,
                documents: d.documents as number,
              })
              break
            case 'context-gathering':
              dispatch({ id, type: 'gather', text: 'finding what matters for this' })
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
              dispatch({ id, type: 'tool', name: humanize(d.toolName as string) })
              break
            case 'turn': {
              finished = true
              if (typeof d.error === 'string') {
                dispatch({ id, type: 'failed', message: d.error })
              } else {
                const text = d.text as string
                const sources = (d.sourceUrls as string[]) ?? []
                const content = sources.length
                  ? `${text}\n\nSources:\n${sources.map((u) => `- ${u}`).join('\n')}`
                  : text
                dispatch({ id, type: 'finished', content })
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
      } finally {
        attached.current = false
      }
      if (!finished) dispatch({ id, type: 'failed', message: 'The connection closed before the reply finished.' })
    },
    [state.id, state.phase, state.turns.length],
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
        if (!saved) notes.push({ text: 'Nothing to save', tone: 'quiet' })
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
  return { state: state.id === id ? state : initial(id), send, end, setModel, setContextTokens, answer }
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
 * The line that stands in for a reply that hasn't started. A large prompt
 * takes the model ten seconds or more to answer; once the wait is long
 * enough to notice, the line counts it, so quiet reads as working, not stuck.
 */
function QuietLine({ text }: { text: string }) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    setSeconds(0)
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [text])
  return (
    <div className="sky-condensed">
      — {text}
      {seconds >= 3 ? ` · ${seconds}s` : ''} —
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
  onAnswer?: (approved: boolean) => void
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
          />
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
          <ApprovalCard approval={approval} onAnswer={(approved) => void answer(approval.id, approved)} />
        </Fragment>
      ))}
      {state.gather && state.approvals.length === 0 && <QuietLine text={state.gather} />}
      {state.phase === 'saving' && <QuietLine text="saving" />}
    </>
  )
}

export function Composer({ chat, placeholder, hints }: { chat: Chat; placeholder: string; hints: ReactNode }) {
  const { state, send } = chat
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const busy = state.phase !== 'idle'

  const submit = () => {
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
        <ActionIcon variant="light" color="blue" aria-label="Send" onClick={submit} disabled={busy}>
          ↑
        </ActionIcon>
      </div>
      <div className="sky-under">
        {state.settings && (
          <>
            <ModelControl chat={chat} />
            <span className="sky-hint">·</span>
            <BudgetControl chat={chat} />
          </>
        )}
        {/* The keys are worth a word before the first message; after it the tuning takes the room. */}
        {state.turns.length === 0 && (
          <>
            {state.settings && <span className="sky-hint">·</span>}
            {hints}
          </>
        )}
        {state.documents !== null && (
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
              {state.phase === 'saving' ? 'Saving…' : 'Save & close'}
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
}: {
  turn: Turn
  streaming: boolean
  /** The calls answered on the way to this reply — after the reading, before the words */
  cards?: ReactNode
}) {
  if (turn.role === 'user') {
    return (
      <div className="sky-turn sky-turn-user">
        <div className="sky-bubble">{turn.content}</div>
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
        {turn.tools && turn.tools.length > 0 && (
          <div className="sky-chips">
            {turn.tools.map((tool, i) => (
              <span key={i} className="sky-chip" data-act="true">
                {tool}
              </span>
            ))}
          </div>
        )}
        {turn.error && <span className="sky-fate">turn failed — {turn.error}</span>}
      </div>
    </>
  )
}
