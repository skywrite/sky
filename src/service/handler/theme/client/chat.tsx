import { ActionIcon, Button, Menu, Textarea, Tooltip } from '@mantine/core'
import {
  Fragment,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import type { WritingDraftView } from '#lib/writingVoice/draftTypes.ts'
import { splitChatFiles } from '#universal/ai/chatFiles.ts'
import { splitChatImages } from '#universal/ai/chatImages.ts'
import { effortLabel, type Effort, type EffortOverride } from '#universal/ai/effort.ts'
import { splitSources, withSources } from '#universal/ai/sources.ts'
import type { TokenUsage } from '#universal/ai/tokenUsage.ts'
import { toolDisplayName } from '#universal/ai/toolDisplay.ts'
import { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { BranchPoint } from '../../chat/branchPoint.ts'
import { ChatActivity, type TurnQueries } from './chatActivity.tsx'
import { useChatDraft, type ChatDraft } from './chatDraft.ts'
import { FileClips, Paperclip, type PendingChatFile, useChatFiles } from './chatFiles.tsx'
import { ChatImages, replyImages } from './chatImages.tsx'
import { renderChatMarkdown } from './chatMarkdown.ts'
import { ChatSelectionMenu } from './chatSelection.tsx'
import { useChatVoice } from './chatVoice.ts'
import { ChatWritingDraft, WritingDraftReply } from './chatWritingDraft.tsx'
import { splitWritingDrafts, useWritingDrafts, writingDraftRequest } from './chatWritingDrafts.ts'
import { ContextPanel } from './context.tsx'
import { BudgetControl, ModelControl, TemporaryControl, type ThreadSettings } from './controls.tsx'
import { fileHref } from './explorer.tsx'
import { LegalReviewSummary } from './legalReview.tsx'
import { RenderedHtml } from './renderedHtml.tsx'
import { ReplyDetails } from './replyDetails.tsx'
import {
  ReplyThreadLink,
  ReplyThreadPanel,
  useReplyThreads,
  type OpenReplyThread,
  type ReplyThreadSummary,
} from './replyThreads.tsx'
import { slackToMarkdown } from './slackMarkdown.ts'
import { compactLine } from './toolLines.ts'
import { FieldsView, RunLines } from './toolLinesView.tsx'
import { awaitReturn, frames } from './turnStream.ts'
import { VoiceButton, VoiceStatus, VoiceTranscript } from './voice.tsx'
import { VoicePresence } from './voicePresence.tsx'
import { WritingVoiceQuestions } from './writingVoice.tsx'
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
  /** Browser files while sending; durable links replace these when the server accepts the message. */
  files?: PendingChatFile[]
  /** Notebook stamp `HH:MM` from the service, or a client clock */
  time?: string
  /** The reply rendered as HTML once it finished streaming */
  html?: string
  /** Web addresses the reply drew on, folded under it; the saved transcript carries them as a trailing list */
  sources?: string[]
  /** The gather that preceded this reply, kept as its provenance */
  note?: string
  /** What the reply cost, in tokens, every step summed */
  usage?: TokenUsage
  timing?: string
  /** The profile that answered, as the settings name it */
  model?: string
  /** Captured from the model that answered; preset edits cannot relabel old replies. */
  modelLabel?: string
  effort?: Effort
  error?: string
  /** The server's branch reference; failed or interrupted page-only replies have none. */
  branchPoint?: BranchPoint
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
  callId?: string
  input?: unknown
  output?: unknown
  error?: string
  phase?: 'preparing' | 'waiting' | 'running'
  /** The tool as the model calls it (`google_agent`) */
  tool: string
  /** The reply's turn index */
  at: number
  /** Epoch milliseconds when it started */
  started: number
  lines: string[]
  /** How it ended; null while it runs */
  status: 'success' | 'fail' | 'error' | null
  /** Epoch milliseconds when it ended — with `started`, how long it took */
  finished?: number
  /** One line on what it did, from a small model once it ended — the label it folds under */
  summary?: string
  /** What the call was about — the query, the page, the mission — from the model's record of it */
  subject?: string
}

/** The message the service was answering when it went down — shown where the exchange would be, with a way to send it again. */
export interface Interrupted {
  message: string
  /** Notebook stamp `HH:MM` of the message */
  time?: string
}

/** A line in the record's voice: what happened to a thread, not a message in it. */
export interface Note {
  text: string
  tone: 'quiet' | 'done' | 'failed'
}

export interface ChatCloseResult {
  summary: string
  notes: Note[]
}

type Phase = 'idle' | 'busy' | 'saving'

/** Where a thread came from: the parent's file, the turn it left after, the live parent when there is one. */
export interface ThreadParent {
  chat: string
  turn: number
  id: string | null
  /** The parent's name, when the service knows it */
  title: string | null
  kind?: 'thread'
  key?: string
}

/** A branch filed beside this thread's file, not live on this page */
export interface SavedBranch {
  /** The branch's file, relative to the notebook root */
  chat: string
  /** The turn it left after */
  turn: number
  title: string | null
}

export interface ThreadState {
  id: string
  /** The subject received on this thread's stream, ahead of the next list refresh. */
  title: string | null
  turns: Turn[]
  phase: Phase
  /** Messages at the head of `turns` that are the parent's — shown dimmed, the branch's own follow */
  inherited: number
  /** The chat this thread branched from; null for one that began on its own */
  parent: ThreadParent | null
  /** The saved chat this thread continues, relative to the notebook root; null for one with no file yet */
  saved: string | null
  /** The branches filed beside that chat */
  branches: SavedBranch[]
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
  /** The message a restart took before the reply, until the person sends again */
  interrupted: Interrupted | null
}

/**
 * Every action names the thread it belongs to. A turn keeps streaming in
 * the background after the page moves to another thread, and its actions
 * must land nowhere — not in whichever thread is showing now.
 */
type Action =
  | { type: 'reset'; id: string }
  | { type: 'title'; id: string; title: string }
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
      inherited?: number
      parent?: ThreadParent | null
      saved?: string | null
      branches?: SavedBranch[]
      interrupted?: Interrupted | null
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
      interrupted?: Interrupted | null
    }
  | { type: 'approval'; id: string; approval: Approval }
  | { type: 'answered'; id: string; approvalId: string; approved: boolean; at: number }
  | { type: 'sent'; id: string; content: string; files?: PendingChatFile[] }
  | { type: 'user-message'; id: string; content: string }
  | { type: 'rejected'; id: string }
  | { type: 'queries'; id: string; turn: number; queries: string[] }
  | { type: 'gather'; id: string; text: string; documents?: number; provenance?: boolean }
  | { type: 'delta'; id: string; text: string }
  | { type: 'tool'; id: string; name: string; subject?: string; input?: unknown; callId?: string }
  | { type: 'run-updated'; id: string; run: Run }
  | { type: 'run-started'; id: string; run: Run }
  | { type: 'run-line'; id: string; tool: string; at: number; text: string }
  | { type: 'run-finished'; id: string; tool: string; at: number; status: Run['status']; finished: number }
  | { type: 'run-summary'; id: string; tool: string; at: number; text: string }
  | {
      type: 'finished'
      id: string
      content: string
      sources?: string[]
      usage?: TokenUsage
      model?: string
      modelLabel?: string
      effort?: Effort
      timing?: string
      branchPoint?: BranchPoint
    }
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
    title: null,
    turns: [],
    phase: 'idle',
    inherited: 0,
    parent: null,
    saved: null,
    branches: [],
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
    interrupted: null,
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
    case 'title':
      return { ...state, title: action.title }
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
        inherited: action.inherited ?? 0,
        parent: action.parent ?? null,
        saved: action.saved ?? null,
        branches: action.branches ?? [],
        approvals,
        answered: action.answered ?? [],
        runs: action.runs ?? [],
        queries: action.queries ?? [],
        interrupted: action.interrupted ?? null,
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
        interrupted: action.interrupted ?? null,
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
        gather: action.files?.length
          ? 'reading your files'
          : state.settings?.contextTokens === 0
            ? 'not reading your notebook'
            : state.turns.length === 0
              ? 'reading your notebook'
              : 'finding what matters for this',
        provenance: null,
        interrupted: null,
        turns: [...state.turns, { role: 'user', content: action.content, files: action.files, time: clock() }],
      }
    case 'user-message': {
      const at = state.turns.findLastIndex((turn) => turn.role === 'user')
      return {
        ...state,
        turns: state.turns.map((turn, index) =>
          index === at ? { ...turn, content: action.content, files: undefined } : turn,
        ),
      }
    }
    case 'rejected':
      return { ...state, phase: 'idle', gather: null, turns: state.turns.slice(0, -1) }
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
      const known = action.callId ? state.runs.findIndex((r) => r.callId === action.callId) : -1
      const i =
        known >= 0
          ? known
          : state.runs.findLastIndex(
              (r) => !r.callId && r.tool === action.name && r.at === at && r.subject === undefined,
            )
      if (i >= 0) {
        return {
          ...state,
          runs: state.runs.map((r, k) =>
            k === i
              ? {
                  ...r,
                  subject: action.subject ?? r.subject,
                  input: action.input ?? r.input,
                  callId: action.callId ?? r.callId,
                }
              : r,
          ),
        }
      }
      const { subject } = action
      const chip: Run = {
        tool: action.name,
        at,
        started: new ZonedDateTime().epochMilliseconds,
        lines: [],
        status: 'success',
        subject,
        input: action.input,
        callId: action.callId,
      }
      return { ...state, gather: state.phase === 'busy' ? 'thinking' : state.gather, runs: [...state.runs, chip] }
    }
    case 'run-updated': {
      const i = state.runs.findIndex((run) => run.callId === action.run.callId)
      return {
        ...state,
        // A completed tool hands control back to the model, even after earlier text cleared the indicator.
        gather:
          state.phase === 'busy' && action.run.status !== null && (i < 0 || state.runs[i]!.status === null)
            ? 'thinking'
            : state.gather,
        runs: i < 0 ? [...state.runs, action.run] : state.runs.map((run, index) => (index === i ? action.run : run)),
      }
    }
    case 'run-started': {
      // A call that asked first was recorded before it ran: that chip becomes the run.
      const { run } = action
      const chip = state.runs.findIndex(
        (r) => !r.callId && r.tool === run.tool && r.at === run.at && r.lines.length === 0,
      )
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
      return {
        ...state,
        gather: state.phase === 'busy' ? 'thinking' : state.gather,
        runs: state.runs.map((r, k) => (k === i ? { ...r, status: action.status, finished: action.finished } : r)),
      }
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
        runs: state.runs.map((r) => (r.status === null ? { ...r, status: 'success', finished: Date.now() } : r)),
        turns: withReply(state.turns, (r) => ({
          ...r,
          content: action.content,
          sources: action.sources ?? r.sources,
          note: r.note ?? state.provenance ?? undefined,
          usage: action.usage ?? r.usage,
          timing: action.timing ?? r.timing,
          model: action.model ?? r.model,
          modelLabel: action.modelLabel ?? r.modelLabel,
          effort: action.effort ?? r.effort,
          branchPoint: action.branchPoint,
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
        turns: withReply(state.turns, (r) => ({
          ...r,
          error: action.message,
          timing: action.timing ?? r.timing,
          branchPoint: undefined,
        })),
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

/** Markdown as HTML — null on any rendering failure, leaving the raw text to stand. */
function renderMarkdown(raw: string, reply = false): string | null {
  try {
    return reply ? renderChatMarkdown(raw) : renderStatic(raw)
  } catch {
    return null
  }
}

/** The full first own message until its subject arrives; a branch skips what it inherited. */
export function threadTitle(turns: Turn[], inherited = 0): string | null {
  const first = turns.slice(inherited).find((t) => t.role === 'user')
  const content = first ? splitChatFiles(first.content) : null
  const words = content
    ? (content.text || content.files.map((file) => file.name).join(', ')).replace(/\s+/g, ' ').trim()
    : ''
  return words || null
}

// -----------------------------------------------------------------------------
// The hook — everything a page needs to drive one thread
// -----------------------------------------------------------------------------

/** A thread as the service reads it back. */
interface ThreadBody {
  turns: Array<{ role: 'user' | 'assistant'; content: string; when?: string }>
  branchPoints?: Array<BranchPoint | null>
  documents: number
  kept: number | null
  busy?: boolean
  inherited?: number
  parent?: ThreadParent | null
  saved?: string | null
  branches?: SavedBranch[]
  pending?: Approval[]
  answered?: Answered[]
  runs?: Run[]
  queries?: TurnQueries[]
  /** Each reply's counts and the profile that answered, by turn index */
  usage?: Array<TokenUsage & { at: number; model: string; modelLabel?: string; effort?: Effort }>
  timings?: Array<{ at: number; text: string }>
  interrupted?: { message: string; when?: string | null } | null
}

/** The message a restart took, as the page shows it — its stamp cut to the hour and minute. */
function interruptedOf(body: ThreadBody): Interrupted | null {
  return body.interrupted ? { message: body.interrupted.message, time: body.interrupted.when?.slice(11) } : null
}

function turnsOf(body: ThreadBody): Turn[] {
  const usageAt = new Map(
    (body.usage ?? []).map(({ at, model, modelLabel, effort, ...usage }) => [at, { usage, model, modelLabel, effort }]),
  )
  return body.turns.map((t, i) => {
    const { body: text, sources } = t.role === 'assistant' ? splitSources(t.content) : { body: t.content, sources: [] }
    return {
      role: t.role,
      content: text,
      sources: sources.length > 0 ? sources : undefined,
      time: t.when?.slice(11),
      html: t.role === 'assistant' ? (renderMarkdown(text, true) ?? undefined) : undefined,
      usage: usageAt.get(i)?.usage,
      model: usageAt.get(i)?.model,
      modelLabel: usageAt.get(i)?.modelLabel,
      effort: usageAt.get(i)?.effort,
      timing: body.timings?.find((entry) => entry.at === i)?.text,
      branchPoint: body.branchPoints?.[i] ?? undefined,
    }
  })
}

export function useChat(id: string) {
  const [state, dispatch] = useReducer(reduce, id, initial)
  const [tuning, setTuning] = useState(0)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [stopError, setStopError] = useState<string | null>(null)
  const posting = useRef<{ id: string; ready: Promise<unknown> } | null>(null)
  const stoppingRef = useRef<string | null>(null)
  const tuningCount = useRef(0)
  const currentId = useRef(id)
  currentId.current = id
  useEffect(() => {
    setStopError(null)
  }, [id])
  useEffect(() => {
    if (state.phase !== 'busy') {
      setStoppingId(null)
      stoppingRef.current = null
    }
  }, [state.phase, id])
  // True while this page reads a turn's stream — then the stream, not a poll, keeps the thread current.
  const attached = useRef(false)

  const reload = useCallback(async () => {
    const response = await fetch(`/chat/${id}`)
    if (!response.ok) throw new Error('The voice transcript was kept, but the chat could not be refreshed. Try again.')
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
      interrupted: interruptedOf(body),
    })
  }, [id])

  const stop = useCallback(async () => {
    if (!id || state.phase !== 'busy' || stoppingRef.current === id) return
    stoppingRef.current = id
    setStoppingId(id)
    setStopError(null)
    try {
      // The first POST must be accepted before its turn can be stopped, including file uploads.
      if (posting.current?.id === id) await posting.current.ready
      const response = await fetch(`/chat/${id}/stop`, { method: 'POST' })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        throw new Error(body.message ?? 'Could not stop the response. Try again.')
      }
      if (!attached.current && currentId.current === id) await reload()
    } catch {
      if (currentId.current === id) {
        setStopError('Could not stop the response. Try again.')
        setStoppingId(null)
        stoppingRef.current = null
      }
    }
  }, [id, state.phase, reload])

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
          inherited: body.inherited ?? 0,
          parent: body.parent ?? null,
          saved: body.saved ?? null,
          branches: body.branches ?? [],
          interrupted: interruptedOf(body),
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
            interrupted: interruptedOf(body),
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
    async (change: { profile?: string; effort?: EffortOverride; contextTokens?: number; saves?: boolean }) => {
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
  const setModel = useCallback((profile: string) => tune({ profile, effort: 'default' }), [tune])
  const setEffort = useCallback((effort: EffortOverride) => tune({ effort }), [tune])
  const setContextTokens = useCallback((contextTokens: number) => tune({ contextTokens }), [tune])
  const setSaves = useCallback((saves: boolean) => tune({ saves }), [tune])

  const send = useCallback(
    async (content: string, files: File[] = [], onAccepted?: () => void): Promise<{ ok: boolean; error?: string }> => {
      const message = content.trim()
      if (
        (!message && files.length === 0) ||
        !state.id ||
        state.phase !== 'idle' ||
        !state.settings ||
        tuningCount.current > 0 ||
        attached.current
      )
        return { ok: false }
      const id = state.id
      // Capture once: every retry carries exactly what the composer showed.
      const body = JSON.stringify({
        message,
        profile: state.settings.model.current,
        effort: state.settings.effort ?? 'default',
        contextTokens: state.settings.contextTokens,
        saves: state.settings.saves,
        continuing: state.turns.length > 0,
      })
      const form = files.length > 0 ? new FormData() : null
      if (form) {
        form.set('message', body)
        for (const file of files) form.append('files', file)
      }
      // Attached before the phase turns busy, or the follow-by-poll would
      // start and overwrite the streaming reply with the service's read-back.
      attached.current = true
      setStopError(null)
      dispatch({ id, type: 'sent', content: message, files })
      const replyIndex = state.turns.length + 1

      // A message the service never received is safe to send again: when it
      // cannot be reached, the page waits for it the way the terminal does,
      // on the restart schedule, and sends once it answers.
      const post = () =>
        fetch(`/chat/${id}/messages`, {
          method: 'POST',
          headers: form ? undefined : { 'Content-Type': 'application/json' },
          body: form ?? body,
        })
      let response: Response
      try {
        const ready = post()
        posting.current = { id, ready }
        response = await ready
      } catch {
        dispatch({ id, type: 'lost' })
        const back = await awaitReturn(post)
        if (back.kind !== 'answered') {
          attached.current = false
          dispatch({ id, type: 'failed', message: AWAY })
          return { ok: false, error: AWAY }
        }
        response = back.response
      } finally {
        if (posting.current?.id === id) posting.current = null
      }
      if (!response.ok) {
        attached.current = false
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        const error = body.message ?? `The service answered ${response.status}.`
        dispatch(files.length ? { id, type: 'rejected' } : { id, type: 'failed', message: error })
        return { ok: false, error }
      }
      onAccepted?.()

      let finished = false
      try {
        for await (const frame of frames(response, SILENCE_MS)) {
          const d = frame.data
          switch (frame.event) {
            case 'title':
              if (typeof d.title === 'string') dispatch({ id, type: 'title', title: d.title })
              break
            case 'user-message':
              dispatch({ id, type: 'user-message', content: d.content as string })
              break
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
              dispatch({
                id,
                type: 'tool',
                name: d.toolName as string,
                subject: d.subject as string | undefined,
                input: d.input,
                callId: d.toolCallId as string | undefined,
              })
              break
            case 'tool-updated':
              dispatch({ id, type: 'run-updated', run: d.run as Run })
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
                finished: (d.finished as number | undefined) ?? Date.now(),
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
                // The reply may name sources of its own; with the pages the searches read they are one list, the one the transcript keeps.
                const { body: text, sources } = splitSources(
                  withSources(d.text as string, (d.sourceUrls as string[]) ?? []),
                )
                dispatch({
                  id,
                  type: 'finished',
                  content: text,
                  sources: sources.length > 0 ? sources : undefined,
                  usage: d.usage as TokenUsage | undefined,
                  timing: d.timingText as string | undefined,
                  model: d.model as string | undefined,
                  modelLabel: d.modelLabel as string | undefined,
                  effort: d.effort as Effort | undefined,
                  branchPoint: d.branchPoint as BranchPoint | undefined,
                })
                const html = renderMarkdown(text, true)
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
      return { ok: true }
    },
    [state.id, state.phase, state.turns.length, state.settings],
  )

  // A new chat from here: the service makes a thread that keeps this one's
  // first `turn` turns. Nothing is written; the caller turns the page to it.
  // A refusal comes back in words, so the page can say why nothing happened.
  const branch = useCallback(
    async (point: BranchPoint): Promise<{ id: string } | { error: string }> => {
      if (!state.id) return { error: 'No thread to branch from.' }
      if (state.phase !== 'idle') return { error: 'Wait for the turn to finish, then branch.' }
      const response = await fetch(`/chat/${state.id}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(point),
      }).catch(() => null)
      if (!response) return { error: "Couldn't reach sky — is the service running?" }
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        return { error: body.message ?? `The service answered ${response.status}.` }
      }
      const body = (await response.json()) as { id: string }
      return { id: body.id }
    },
    [state.id, state.phase],
  )

  // Ending a thread files it through the same gate as ai:chat (or drops
  // it). The temporary notification keeps the full result behind View.
  // Every write the save makes to the machine-owned stores is among them;
  // silence means nothing was written.
  const end = useCallback(
    async (save: boolean): Promise<ChatCloseResult | null> => {
      if (!state.id || state.phase !== 'idle' || state.turns.length === 0) return null
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
          return {
            summary: "Couldn't close chat",
            notes: [{ text: `Couldn't close — ${body.message ?? response.status}. Try again.`, tone: 'failed' }],
          }
        }
        const { saved } = (await response.json()) as {
          saved: {
            summary: string
            exchanges: number
            aborted?: { reason: string }
            memoryOps?: Array<{ op: string; summary: string; outcome: string }>
            personOps?: Array<{ op?: string; summary?: string; name?: string; outcome?: string }>
            dayLog?:
              | { logged: true; category: string }
              | { logged: false; reason: 'resume' }
              | { logged: false; reason: 'error'; message: string }
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
        if (saved?.dayLog?.logged) {
          notes.push({ text: 'Logged to the day file', tone: 'done' })
        } else if (saved?.dayLog?.logged === false && saved.dayLog.reason === 'error') {
          notes.push({
            text: `Chat saved, but couldn't log it to the day file: ${saved.dayLog.message}`,
            tone: 'failed',
          })
        }
        for (const m of saved?.memoryOps ?? []) {
          if (m.outcome !== 'skipped') notes.push({ text: `🧠 ${m.op}: ${m.summary}`, tone: 'quiet' })
        }
        for (const p of saved?.personOps ?? []) {
          if (p.outcome !== 'skipped')
            notes.push({ text: `👤 ${p.op ?? 'updated'}: ${p.summary ?? p.name ?? ''}`, tone: 'quiet' })
        }
        return {
          summary: saved?.aborted
            ? 'Chat not saved'
            : saved
              ? 'Chat saved'
              : save
                ? 'Nothing to save'
                : 'Chat discarded',
          notes,
        }
      } catch {
        return {
          summary: "Couldn't close chat",
          notes: [{ text: "Couldn't reach sky — is the service running?", tone: 'failed' }],
        }
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
    stopping: stoppingId === id && state.phase === 'busy',
    stopError,
    stop,
    send,
    end,
    setModel,
    setEffort,
    setContextTokens,
    setSaves,
    reload,
    answer,
    branch,
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
    const follow = () => {
      const wasNearBottom = lastHeight.current - el.scrollTop - el.clientHeight < 160
      if (active && wasNearBottom) el.scrollTop = el.scrollHeight
      lastHeight.current = el.scrollHeight
    }
    follow()
    // Images acquire their dimensions after the reply has rendered.
    const observer = new ResizeObserver(follow)
    if (el.firstElementChild) observer.observe(el.firstElementChild)
    return () => observer.disconnect()
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
    interrupted: interruptedOf(body),
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
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

/**
 * Every tool exposes its phase, elapsed time, and inspection record,
 * including calls that produce no command activity. Completion keeps
 * an open inspector in place so the user's selection survives.
 */
function RunView({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const running = run.status === null
  const progressLabel =
    run.phase === 'preparing' ? 'Preparing inputs' : run.phase === 'waiting' ? 'Waiting for approval' : 'Running'
  // Keep an explicitly opened inspector and its text selection through completion.
  const seconds = useElapsed(run.started, running)
  const took = run.finished === undefined ? undefined : Math.max(0, Math.floor((run.finished - run.started) / 1000))
  const count = run.lines.length
  // The last thing it said, on one line: a call the tool made reads as its name and what it asked.
  const lastLine = run.lines.at(-1)
  const last = lastLine === undefined ? undefined : compactLine(lastLine)
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
          aria-label={`${toolDisplayName(run.tool)} details`}
        >
          <span className="sky-tool-caret" aria-hidden="true">
            {open ? '▾' : '▸'}
          </span>
          <span className="sky-tool-fold-name">{toolDisplayName(run.tool)}</span>
          {took !== undefined && <span className="sky-tool-fold-time">{elapsedLabel(took)}</span>}
          <span className="sky-tool-fold-summary">{run.summary ?? last}</span>
        </button>
      ) : (
        <button
          type="button"
          className="sky-chip sky-tool-chip"
          data-act="true"
          data-open={open}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${toolDisplayName(run.tool)} details`}
        >
          {running && (
            <span className="sky-tool-pulse" role="progressbar" aria-label={`${toolDisplayName(run.tool)} progress`} />
          )}
          {toolDisplayName(run.tool)}
          {run.subject && <span className="sky-tool-subject">{run.subject}</span>}
          <span className="sky-tool-meta">
            {running ? progressLabel : run.status === 'success' ? 'Completed' : 'Failed'}
          </span>
          {(running || took !== undefined) && (
            <span className="sky-tool-meta">{elapsedLabel(running ? seconds : took!)}</span>
          )}
        </button>
      )}
      {running && last && !open && <div className="sky-tool-last">{last}</div>}
      {open && (
        <div className="sky-tool-details">
          <div className="sky-tool-detail-label">Parameters passed</div>
          {run.input !== undefined ? (
            <FieldsView value={run.input} />
          ) : (
            <p>
              {run.phase === 'preparing'
                ? 'The model is preparing the tool inputs.'
                : 'Input data is not available for this older call.'}
            </p>
          )}
          {run.output !== undefined && (
            <>
              <div className="sky-tool-detail-label">Result</div>
              <FieldsView value={run.output} />
            </>
          )}
          {run.error && (
            <>
              <div className="sky-tool-detail-label">Error</div>
              <pre role="alert">{run.error}</pre>
            </>
          )}
          {running && (
            <p role="status">
              {progressLabel} - {elapsedLabel(seconds)}
            </p>
          )}
          {count > 0 && (
            <>
              <div className="sky-tool-detail-label">Activity</div>
              <RunLines lines={run.lines} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Runs shown as they are: one chip each, watched as they work. */
function RunRows({ runs }: { runs: Run[] }) {
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

/** Runs that fold to one line once the reply is done — never fewer than this many. */
const FOLD_RUNS_FROM = 3

/** `web search · 15`, or `Tools · 17` when more than one kind ran. */
function runsLabel(runs: Run[]): string {
  const kinds = new Set(runs.map((run) => run.tool))
  const name = kinds.size === 1 ? toolDisplayName(runs[0].tool) : 'Tools'
  return `${name} · ${runs.length}`
}

/**
 * The tools a reply ran. While the reply is being made every call shows as
 * it happens — that is the part worth watching. Once the reply is done, a
 * handful of calls or more fold to one line, a caret and a count, and open
 * again on a click.
 */
function RunList({ runs, folded = false }: { runs: Run[]; folded?: boolean }) {
  const [open, setOpen] = useState(false)
  if (!folded || runs.length < FOLD_RUNS_FROM) return <RunRows runs={runs} />
  return (
    <div className="sky-tool-group">
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
        <span className="sky-tool-fold-name">{runsLabel(runs)}</span>
      </button>
      {open && <RunRows runs={runs} />}
    </div>
  )
}

/** A web address as it reads: the site and the start of its path, the whole address on hover. */
function sourceLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname.replace(/\/$/, '')
    const shown = path.length > 42 ? `${path.slice(0, 41)}…` : path
    return `${u.hostname.replace(/^www\./, '')}${shown}`
  } catch {
    return url
  }
}

/** The addresses a reply drew on, folded to one line under it; a click lists them. */
function SourcesFold({ sources }: { sources: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="sky-sources">
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
        <span className="sky-tool-fold-name">Sources · {sources.length}</span>
      </button>
      {open && (
        <ul className="sky-sources-list">
          {sources.map((url) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer" title={url}>
                {sourceLabel(url)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The message the service was answering when it went down, restored from
 * the snapshot written as the turn began. It stands where the exchange
 * would be — the message as sent, and under it the reply that never came —
 * with the one thing to do about it. A resend is a fresh turn.
 */
function InterruptedTurn({ interrupted, onResend }: { interrupted: Interrupted; onResend: (message: string) => void }) {
  return (
    <>
      <TurnView turn={{ role: 'user', content: interrupted.message }} streaming={false} />
      <div className="sky-turn">
        <span className="sky-who">
          <span>sky{interrupted.time ? ` · ${interrupted.time}` : ''}</span>
          <button type="button" className="sky-act" onClick={() => onResend(interrupted.message)}>
            Send again
          </button>
        </span>
        <span className="sky-fate">turn failed — sky restarted while replying.</span>
      </div>
    </>
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
          {toolDisplayName(approval.toolName)}
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
        <RenderedHtml className="sky-ask-body sky-rendered" html={rich} />
      ) : (
        <pre className="sky-ask-body">{text}</pre>
      )}
      {onAnswer && answered === undefined && (
        <div className="sky-ask-acts">
          <Button variant="primary" size="sm" onClick={() => onAnswer(true)}>
            Allow
          </Button>
          {approval.sessionKey && (
            <Button variant="primary-quiet" size="sm" onClick={() => onAnswer(true, true)}>
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

/** A branch that left this thread, as the page marks it between the turns. */
/** A branch that left this thread: live on the service, or filed beside its file. */
export interface BranchMark {
  /** The live thread; null for a branch that is saved only */
  id: string | null
  /** The saved file of a branch that is not live */
  chat?: string
  title: string | null
  turn: number
}

/**
 * The thread's turns, the gather line while it runs, the saving line. No
 * header, no composer. A branch shows the turns it inherited dimmed, then
 * the line that says where it came from; a thread that branches left
 * carries a line where each left. A reply offers "Branch from here" when
 * the page can turn to the new thread.
 */
export function ThreadColumn({
  chat,
  title,
  branches = [],
  onBranched,
  onOpenSaved,
  onReplyThread,
  replyThreads = [],
  activeReplyId,
  replyMode = false,
}: {
  chat: Chat
  title?: string
  /** The branches that left this thread, live or saved */
  branches?: BranchMark[]
  /** Turns this page to a new thread — the fallback when a new tab is blocked; absent, replies offer no branching */
  onBranched?: (id: string) => void
  /** Opens a saved branch as a thread to continue; absent, its mark links to the file */
  onOpenSaved?: (chat: string) => void
  onReplyThread?: (point: BranchPoint, draftId?: string) => void
  replyThreads?: ReplyThreadSummary[]
  activeReplyId?: string
  replyMode?: boolean
}) {
  const { state, answer, branch } = chat
  const transcript = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!state.loaded) return
    const reveal = () => {
      let id: string
      try {
        id = decodeURIComponent(window.location.hash.slice(1))
      } catch {
        return
      }
      if (!id) return
      const target = document.getElementById(id)
      if (target && transcript.current?.contains(target)) target.scrollIntoView({ block: 'center' })
    }
    reveal()
    window.addEventListener('hashchange', reveal)
    return () => window.removeEventListener('hashchange', reveal)
  }, [state.id, state.loaded])
  const busy = state.phase !== 'idle'
  const writing = useWritingDrafts(state.id, `${state.turns.length}:${state.phase}`)
  const draftPositions = useMemo(() => {
    const positions = new Map<string, number>(writing.drafts.map((draft) => [draft.id, draft.turn * 2 - 1]))
    if (!replyMode) return positions
    const firstVisible = state.inherited - 1
    const inheritedDrafts = writing.drafts.filter((draft) => draft.turn * 2 - 1 < firstVisible)
    if (!inheritedDrafts.length) return positions
    // Earlier drafts stay in context; only a visible quotation brings their frame into this thread.
    for (let i = firstVisible; i < state.turns.length; i++) {
      const turn = state.turns[i]
      if (turn?.role !== 'assistant') continue
      for (const part of splitWritingDrafts(turn.content, inheritedDrafts) ?? []) {
        if ('draftId' in part && positions.get(part.draftId)! < firstVisible) positions.set(part.draftId, i)
      }
    }
    return positions
  }, [writing.drafts, replyMode, state.inherited, state.turns])
  const draftAt = (draft: WritingDraftView) => draftPositions.get(draft.id) ?? draft.turn * 2 - 1
  const askAboutDraft = async (draft: WritingDraftView) => {
    const point = state.turns[draftAt(draft)]?.branchPoint
    if (!replyMode && point && onReplyThread) {
      onReplyThread(point, draft.id)
      return
    }
    try {
      writing.update(await writingDraftRequest(state.id, draft.id, { action: 'focus' }))
      window.dispatchEvent(new CustomEvent('sky-draft-focus', { detail: state.id }))
    } catch (error) {
      setRefusal((error as Error).message)
    }
  }
  const leftAt = (point?: BranchPoint) => (point ? branches.filter((b) => b.turn === point.turn) : [])
  // Why a branch did not open, said under the turns for a moment; and which
  // turn's branch is being made, so its button says so meanwhile.
  const [refusal, setRefusal] = useState<string | null>(null)
  const [branching, setBranching] = useState<string | null>(null)
  useEffect(() => {
    if (!refusal) return
    const timer = window.setTimeout(() => setRefusal(null), 8000)
    return () => window.clearTimeout(timer)
  }, [refusal])
  // The branch opens in a new tab and this chat stays where it is: the two
  // are meant to run side by side, and swapping this page for one that
  // looks almost the same only confuses. The tab is opened at once, inside
  // the click, since a browser lets a page open a tab only on the person's
  // gesture — then pointed at the branch once the service has made it. A
  // blocked tab falls back to turning this page.
  const branchFrom = onBranched
    ? async (point: BranchPoint) => {
        if (branching !== null) return
        const tab = window.open('', '_blank')
        if (tab) tab.document.title = 'sky:chat - New branch'
        setBranching(point.key)
        try {
          const made = await branch(point)
          if ('id' in made) {
            if (tab) tab.location.href = `/thread/${made.id}`
            else onBranched(made.id)
          } else {
            tab?.close()
            setRefusal(`Couldn't start a new chat from here — ${made.error}`)
          }
        } catch (err) {
          // Whatever went wrong on the page itself is said, never swallowed.
          tab?.close()
          setRefusal(`Couldn't start a new chat from here — ${(err as Error).message ?? String(err)}`)
        } finally {
          setBranching(null)
        }
      }
    : undefined
  // A tool at work speaks for the wait; the quiet line would only say "thinking" over it.
  const running = state.runs.some((run) => run.status === null)
  const thinkingAfterTool =
    (state.gather === 'thinking' || state.gather === 'still working') &&
    state.runs.some((run) => run.at === replyIndexOf(state.turns) && run.status !== null)
  const activity =
    state.phase === 'busy' && state.approvals.length === 0 && !running
      ? thinkingAfterTool
        ? 'Sky is thinking through the results'
        : state.gather
      : null
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
    <div ref={transcript} className="sky-chat-transcript">
      {writing.drafts
        .filter((draft) => draft.turn === 0)
        .map((draft) => (
          <ChatWritingDraft
            key={draft.id}
            chatId={state.id}
            draft={draft}
            disabled={busy}
            onChange={writing.update}
            onAsk={(record) => void askAboutDraft(record)}
          />
        ))}
      {state.turns.map((turn, i) =>
        replyMode && i < state.inherited - 1 ? null : (
          <Fragment key={i}>
            {turn.role === 'user' && settled(i)}
            <TurnView
              turn={turn}
              messageId={`chat-${state.id}-${turn.branchPoint ? `reply-${turn.branchPoint.turn}` : `message-${i + 1}`}`}
              writingDrafts={{
                chatId: state.id,
                drafts: writing.drafts,
                placed: writing.drafts.filter((draft) => draftAt(draft) === i),
                disabled: busy,
                onChange: writing.update,
                onAsk: (draft) => void askAboutDraft(draft),
              }}
              streaming={busy && i === state.turns.length - 1 && turn.role === 'assistant'}
              cards={turn.role === 'assistant' ? settled(i) : undefined}
              runs={turn.role === 'assistant' ? state.runs.filter((run) => run.at === i) : undefined}
              labelOf={(profile) => state.settings?.model.choices.find((c) => c.name === profile)?.label ?? profile}
              shared={!replyMode && i < state.inherited}
              onReplyThread={
                !replyMode && turn.branchPoint && onReplyThread ? () => onReplyThread(turn.branchPoint!) : undefined
              }
              replyThread={replyThreads.find(
                (thread) => thread.turn === turn.branchPoint?.turn && thread.key === turn.branchPoint?.key,
              )}
              activeReplyId={activeReplyId}
              onBranch={
                !replyMode && branchFrom && !busy && turn.role === 'assistant' && turn.branchPoint
                  ? () => void branchFrom(turn.branchPoint!)
                  : undefined
              }
              branching={branching !== null && branching === turn.branchPoint?.key}
            />
            {replyMode && i === state.inherited - 1 && (
              <div className="sky-reply-divider">
                <span>Replies</span>
              </div>
            )}
            {turn.role === 'user' && (
              <Fragment key={`${state.id}-${i}`}>
                <ChatActivity
                  active={false}
                  text={null}
                  queries={state.queries.find((entry) => entry.turn === Math.floor(i / 2) + 1)?.queries}
                />
              </Fragment>
            )}
            {!replyMode && state.parent && state.inherited > 0 && i === state.inherited - 1 && (
              <div className="sky-condensed">
                — continues{' '}
                {state.parent.id ? (
                  <a href={`/thread/${state.parent.id}`}>{state.parent.title ?? 'the chat it left'}</a>
                ) : (
                  <a href={`/explorer/${state.parent.chat}`}>{state.parent.title ?? 'the chat it left'}</a>
                )}{' '}
                from turn {state.parent.turn} —
              </div>
            )}
            {turn.role === 'assistant' && leftAt(turn.branchPoint).length > 0 && (
              <div className="sky-condensed">
                — {leftAt(turn.branchPoint).length === 1 ? 'a branch left here: ' : 'branches left here: '}
                {leftAt(turn.branchPoint).map((b, k) => (
                  <Fragment key={b.id ?? b.chat}>
                    {k > 0 && ', '}
                    {b.id !== null ? (
                      <a href={`/thread/${b.id}`}>{b.title ?? 'a new chat'}</a>
                    ) : onOpenSaved && b.chat ? (
                      <button type="button" className="sky-link" onClick={() => onOpenSaved(b.chat!)}>
                        {b.title ?? 'a saved chat'}
                      </button>
                    ) : (
                      <a href={`/explorer/${b.chat}`}>{b.title ?? 'a saved chat'}</a>
                    )}
                  </Fragment>
                ))}{' '}
                —
              </div>
            )}
          </Fragment>
        ),
      )}
      {writing.drafts
        .filter((draft) => draftAt(draft) >= state.turns.length)
        .map((draft) => (
          <Fragment key={draft.id}>
            <ChatWritingDraft
              chatId={state.id}
              draft={draft}
              disabled={busy}
              onChange={writing.update}
              onAsk={(item) => void askAboutDraft(item)}
            />
          </Fragment>
        ))}
      {writing.error && writing.drafts.length > 0 && (
        <p className="sky-chat-file-error" role="alert">
          {writing.error}
        </p>
      )}
      <ChatSelectionMenu
        root={transcript}
        chatId={state.id}
        title={title ?? state.title ?? 'Source chat'}
        saved={state.saved}
      />
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
      {state.interrupted && state.phase === 'idle' && (
        <InterruptedTurn interrupted={state.interrupted} onResend={(message) => void chat.send(message)} />
      )}
      {/* Runs for a reply that has not begun sit where it will land. */}
      {coming.length > 0 && (
        <>
          <ChatImages
            images={replyImages(
              '',
              coming.map((run) => run.output),
            )}
          />
          <RunList runs={coming} />
        </>
      )}
      {refusal && <NoteLine note={{ text: refusal, tone: 'failed' }} />}
      <ChatActivity active={Boolean(activity)} text={activity} />
      {state.phase === 'saving' && <ChatActivity active text="saving" />}
      {state.id && (
        <WritingVoiceQuestions
          key={state.id}
          source={`chat:${state.id}`}
          refreshKey={`${state.turns.length}:${state.phase}`}
          polling={busy}
        />
      )}
    </div>
  )
}

export interface ComposerAttach {
  /** The file kinds the picker offers */
  accept?: string
  onFiles: (files: File[]) => void
  files?: File[]
  onRemove?: (index: number) => void
}

export function Composer({
  chat,
  draft,
  placeholder,
  hints,
  attach,
  trailingAction,
  status,
  onSend,
  sendDisabled = false,
  hidden = false,
  autoFocus = true,
}: {
  chat: Chat
  draft: ChatDraft
  placeholder: string
  hints: ReactNode
  /** A + before the input that picks files — the door for people who don't drag */
  attach?: ComposerAttach
  /** Extra input methods stay after Send so its position remains predictable. */
  trailingAction?: ReactNode
  status?: ReactNode
  onSend?: (text: string) => void
  sendDisabled?: boolean
  /** Keep the draft in its textarea while voice owns the conversation surface. */
  hidden?: boolean
  autoFocus?: boolean
}) {
  const { state, send } = chat
  const inputRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const focus = (event: Event) => {
      if ((event as CustomEvent<string>).detail === state.id) inputRef.current?.focus()
    }
    window.addEventListener('sky-draft-focus', focus)
    return () => window.removeEventListener('sky-draft-focus', focus)
  }, [state.id])
  const fileRef = useRef<HTMLInputElement>(null)
  const threadId = useRef(state.id)
  threadId.current = state.id
  const [sendError, setSendError] = useState<string | null>(null)
  useEffect(() => setSendError(null), [state.id, attach?.files])
  const busy = state.phase !== 'idle'
  const positionedDraft = useRef<string | null>(null)
  useEffect(() => {
    if (!autoFocus || hidden || draft.loading || busy || positionedDraft.current === state.id) return
    const input = inputRef.current
    if (!input) return
    positionedDraft.current = state.id
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
    input.scrollTop = input.scrollHeight
  }, [state.id, autoFocus, hidden, draft.loading, busy])
  const canSend =
    !busy && !chat.tuning && state.settings !== null && !sendDisabled && !draft.loading && !draft.missingFiles

  const submit = () => {
    if (!canSend) return
    const el = inputRef.current
    if (!el) return
    const text = el.value
    const files = attach?.files ?? []
    if (!text.trim() && files.length === 0) return
    setSendError(null)
    if (onSend) {
      draft.accepted(text, files)
      onSend(text)
    } else {
      const id = state.id
      void send(text, files, () => {
        draft.accepted(text, files)
      }).then((result) => {
        if (!result.ok && threadId.current === id) setSendError(result.error ?? 'Wait a moment and try again.')
      })
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="sky-composer-zone" hidden={hidden} style={hidden ? { display: 'none' } : undefined}>
      <div className="sky-composer">
        {status}
        {(draft.loading || draft.saving) && (
          <p className="sky-chat-draft-status" role="status">
            {draft.loading ? 'Restoring draft…' : 'Saving attachments…'}
          </p>
        )}
        {draft.error && (
          <p className="sky-chat-file-error" role="alert">
            {draft.error}{' '}
            <button type="button" className="sky-link" onClick={draft.retry}>
              Retry
            </button>
          </p>
        )}
        {sendError && (
          <p className="sky-chat-file-error" role="alert">
            {sendError}
          </p>
        )}
        {chat.stopError && (
          <p className="sky-chat-file-error" role="alert">
            {chat.stopError}
          </p>
        )}
        <div className="sky-composer-shell">
          <FileClips files={attach?.files ?? []} onRemove={attach?.onRemove} disabled={busy || sendDisabled} pending />
          <div className="sky-composer-row">
            {attach && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  multiple
                  disabled={busy || sendDisabled || draft.loading}
                  accept={attach.accept}
                  onChange={(event) => {
                    const list = event.target.files
                    const files: File[] = list ? Array.from(list) : []
                    event.target.value = ''
                    if (files.length > 0) attach.onFiles(files)
                  }}
                />
                <ActionIcon
                  aria-label="Add a file"
                  title="Add a file"
                  disabled={busy || sendDisabled || draft.loading}
                  onClick={() => fileRef.current?.click()}
                >
                  <Paperclip />
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
                maxRows={attach?.files?.length ? 4 : 8}
                placeholder={placeholder}
                aria-label={placeholder}
                value={draft.text}
                onChange={(event) => draft.setText(event.currentTarget.value)}
                onKeyDown={onKeyDown}
                onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
                  const files: File[] = Array.from(event.clipboardData.files)
                  if (!attach || files.length === 0) return
                  event.preventDefault()
                  attach.onFiles(files)
                }}
                disabled={busy || draft.loading}
                autoFocus={autoFocus}
              />
            </div>
            <Tooltip
              label={
                state.phase === 'busy' ? (
                  chat.stopping ? (
                    'Stopping response…'
                  ) : (
                    'Stop response'
                  )
                ) : (
                  <>
                    Enter to send
                    <br />
                    Shift+Enter for a new line
                  </>
                )
              }
              withArrow
              openDelay={350}
              events={{ hover: true, focus: true, touch: false }}
            >
              <ActionIcon
                variant="primary"
                aria-label={state.phase === 'busy' ? 'Stop response' : 'Send'}
                onClick={state.phase === 'busy' ? () => void chat.stop() : submit}
                disabled={state.phase === 'busy' ? chat.stopping : !canSend}
                aria-busy={chat.stopping || undefined}
              >
                {state.phase === 'busy' ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                    <rect x="2" y="2" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  '↑'
                )}
              </ActionIcon>
            </Tooltip>
            {trailingAction}
          </div>
        </div>
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
  branches,
  onBranched,
  onOpenSaved,
}: {
  chat: Chat
  title: string
  back: { label: string; onClick: () => void }
  onEnd: () => void
  /** The branches that left this thread, live or saved */
  branches?: BranchMark[]
  /** The page turns to a new branch */
  onBranched?: (id: string) => void
  /** A saved branch opens as a thread to continue */
  onOpenSaved?: (chat: string) => void
}) {
  const { state } = chat
  const call = useChatVoice(chat)
  const voiceMode = call.active
  const [endRequested, setEndRequested] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  useFollow(scrollRef, [state.turns, state.runs, state.gather, call.voice.state.turns, voiceMode], !voiceMode)
  const busy = state.phase !== 'idle'
  const draft = useChatDraft(state.id)
  const attachments = useChatFiles(state.id, busy || voiceMode || call.preparing || call.syncing || call.unsaved, draft)
  const empty = state.turns.length === 0 && !state.gather && !call.visible
  const [panel, setPanel] = useState(false)
  const replyMode = state.parent?.kind === 'thread'
  const [replyVersion, setReplyVersion] = useState(0)
  const replies = useReplyThreads(state.id, !replyMode, replyVersion)
  const [openReplies, setOpenReplies] = useState<OpenReplyThread[]>([])
  const [activeReply, setActiveReply] = useState<string | null>(null)
  const [openingReply, setOpeningReply] = useState<BranchPoint | null>(null)
  const [replyError, setReplyError] = useState<string | null>(null)
  const replyRequest = useRef(0)
  const closeReply = useCallback(() => {
    replyRequest.current++
    setActiveReply(null)
    setOpeningReply(null)
  }, [])
  const openReply = async (point: BranchPoint, draftId?: string) => {
    if (openingReply || replyMode) return
    const request = ++replyRequest.current
    setPanel(false)
    setActiveReply(null)
    setOpeningReply(point)
    setReplyError(null)
    try {
      const response = await fetch(`/chat/${state.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...point, ...(draftId ? { draftId } : {}) }),
      })
      const result = (await response.json()) as { id?: string; message?: string }
      if (!response.ok || !result.id) throw new Error(result.message ?? 'The thread could not be opened.')
      const id = result.id
      setOpenReplies((prior) =>
        prior.some((thread) => thread.id === id)
          ? prior.map((thread) => (thread.id === id ? { ...thread, draftId: draftId ?? thread.draftId } : thread))
          : [...prior, { id, point, draftId }],
      )
      setReplyVersion((version) => version + 1)
      if (request === replyRequest.current) setActiveReply(id)
    } catch (error) {
      if (request === replyRequest.current) setReplyError((error as Error).message)
    } finally {
      if (request === replyRequest.current) setOpeningReply(null)
    }
  }
  useEffect(() => {
    if (!endRequested) return
    setEndRequested(false)
    onEnd()
  }, [endRequested, onEnd])
  const endConversation = async () => {
    if (await call.end()) setEndRequested(true)
  }

  return (
    <div className="sky-main" data-temporary={state.settings?.saves === false}>
      <header className="sky-head sky-chat-head">
        <Button size="sm" onClick={back.onClick} style={{ marginLeft: -10 }}>
          ‹ {back.label}
        </Button>
        <span className="sky-title" title={title}>
          {title}
        </span>
        {(state.saved || !voiceMode) && (
          <nav className="sky-tabs">
            {state.saved && (
              <Button size="sm" component="a" href={fileHref(state.saved)}>
                Open document
              </Button>
            )}
            {!voiceMode && state.documents !== null && (
              <Button
                size="sm"
                onClick={() => {
                  closeReply()
                  setPanel((open) => !open)
                }}
                data-active={panel}
              >
                Context · {state.documents}
              </Button>
            )}
            {!voiceMode && <TemporaryControl chat={chat} />}
            {!voiceMode && (state.turns.length > 0 || call.voice.state.turns.some((turn) => turn.who === 'you')) && (
              <Button
                size="sm"
                className="sky-chat-close"
                onClick={() => void endConversation()}
                disabled={busy || chat.tuning || call.syncing || replies.some((reply) => reply.busy)}
              >
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
        )}
      </header>

      <div
        className="sky-split"
        data-reply-open={(!voiceMode && (activeReply !== null || openingReply !== null)) || undefined}
      >
        <div className="sky-split-main sky-chat-drop-target" {...attachments.drop}>
          {!replyMode && !voiceMode && <LegalReviewSummary chatId={state.id} busy={busy} />}
          {attachments.dragging && (
            <div className="sky-chat-drop" role="status">
              <Paperclip />
              <span>Drop files to read in this chat</span>
            </div>
          )}
          <div
            className="sky-scroll"
            ref={scrollRef}
            hidden={voiceMode}
            style={voiceMode ? { display: 'none' } : undefined}
          >
            {empty ? (
              <div className="sky-blank">
                <p>Ask about your notebook. Answers come from your files.</p>
              </div>
            ) : (
              <div className="sky-col">
                <ThreadColumn
                  chat={chat}
                  title={title}
                  branches={branches}
                  onBranched={replyMode ? undefined : onBranched}
                  onOpenSaved={onOpenSaved}
                  replyMode={replyMode}
                  onReplyThread={replyMode ? undefined : (point, draftId) => void openReply(point, draftId)}
                  replyThreads={replies}
                  activeReplyId={activeReply ?? undefined}
                />
                {replyError && (
                  <p className="sky-chat-file-error" role="alert">
                    {replyError}
                  </p>
                )}
                {call.visible && <VoiceTranscript voice={call.voice} />}
              </div>
            )}
          </div>

          {voiceMode && <VoicePresence voice={call.voice} />}
          <VoiceStatus
            voice={call.voice}
            syncing={call.syncing}
            error={call.error}
            onEnd={() => void call.end()}
            onRetry={() => void call.retry()}
          />
          <Composer
            chat={chat}
            draft={draft}
            hidden={voiceMode}
            placeholder={state.saved ? 'Continue this chat…' : 'Message sky…'}
            hints={KEY_HINTS}
            attach={attachments.attach}
            status={
              attachments.error && (
                <p className="sky-chat-file-error" role="alert">
                  {attachments.error}
                </p>
              )
            }
            sendDisabled={voiceMode || call.preparing || call.syncing || call.unsaved}
            trailingAction={
              <VoiceButton
                active={call.active}
                disabled={
                  !call.active &&
                  (busy || call.preparing || call.syncing || chat.tuning || !state.loaded || !state.settings)
                }
                onClick={() => {
                  if (call.active) void call.end()
                  else void call.start()
                }}
              />
            }
          />
        </div>
        {panel && !voiceMode && (
          <ContextPanel
            id={state.id}
            version={state.contextVersion}
            busy={busy}
            live={busy ? state.gather : null}
            onClose={() => setPanel(false)}
          />
        )}
        {openingReply && !voiceMode && (
          <aside className="sky-reply-panel" aria-label="Thread" aria-busy="true">
            <header className="sky-reply-panel-head">
              <h2>Thread</h2>
              <ActionIcon aria-label="Close thread" onClick={closeReply}>
                ×
              </ActionIcon>
            </header>
            <p className="sky-reply-empty" role="status">
              Opening thread…
            </p>
          </aside>
        )}
        {openReplies.map((reply) => (
          <ReplyThreadPanel
            key={reply.id}
            thread={reply}
            visible={!voiceMode && activeReply === reply.id}
            onClose={closeReply}
          />
        ))}
      </div>
      <audio ref={call.voice.audioRef} autoPlay />
      <audio ref={call.voice.sonnyAudioRef} autoPlay />
    </div>
  )
}

export function TurnView({
  turn,
  messageId,
  streaming,
  cards,
  runs,
  shared = false,
  onBranch,
  branching = false,
  labelOf,
  onReplyThread,
  replyThread,
  activeReplyId,
  writingDrafts,
}: {
  turn: Turn
  messageId?: string
  streaming: boolean
  /** The calls answered on the way to this reply — after the reading, before the words */
  cards?: ReactNode
  /** The tools this reply ran, with what each said */
  runs?: Run[]
  /** The turn is the parent's, inherited by this branch — drawn dimmed */
  shared?: boolean
  /** "Branch from here": a branch that keeps the thread through this reply */
  onBranch?: () => void
  /** The branch from this reply is being made */
  branching?: boolean
  /** The settings' label for a profile name, for the usage line; the name itself when absent */
  labelOf?: (profile: string) => string
  onReplyThread?: () => void
  replyThread?: ReplyThreadSummary
  activeReplyId?: string
  writingDrafts?: Omit<Parameters<typeof WritingDraftReply>[0], 'content' | 'html'>
}) {
  const userMessage = useMemo(() => {
    if (turn.role !== 'user') return null
    const { text, files } = splitChatFiles(turn.content)
    return { text, files, html: text ? renderMarkdown(text) : null }
  }, [turn.role, turn.content])

  if (userMessage) {
    const { text, files, html } = userMessage
    return (
      <div
        className="sky-turn sky-turn-user"
        id={messageId}
        data-chat-message={messageId}
        data-speaker="You"
        data-shared={shared || undefined}
      >
        <div className="sky-bubble">
          {text &&
            (html ? (
              <RenderedHtml className="sky-bubble-text sky-rendered" html={html} />
            ) : (
              <div className="sky-bubble-text">{text}</div>
            ))}
          <FileClips files={files.length ? files : (turn.files ?? [])} />
        </div>
      </div>
    )
  }

  // Voice replies keep these speaker labels when saved and reopened.
  const branch = /^(?:Sky|Sonny): /.test(turn.content) ? undefined : onBranch
  const content = splitChatImages(turn.content).text
  const images = replyImages(
    turn.content,
    runs?.map((run) => run.output),
  )

  return (
    <>
      {turn.note && <div className="sky-condensed">— {turn.note} —</div>}
      {cards}
      <div
        className="sky-turn"
        id={messageId}
        data-chat-message={messageId}
        data-speaker="Sky"
        data-streaming={streaming || undefined}
        data-shared={shared || undefined}
      >
        <span className="sky-who">
          <span>sky{turn.time ? ` · ${turn.time}` : ''}</span>
        </span>
        {!streaming && writingDrafts && writingDrafts.drafts.length > 0 ? (
          <WritingDraftReply {...writingDrafts} content={content} html={turn.html} />
        ) : turn.html ? (
          <RenderedHtml className="sky-body sky-rendered" html={turn.html} />
        ) : (
          <div className="sky-body">
            {/* A reply that has only called tools so far has no paragraph yet — one caret, below. */}
            {(content === '' ? [] : content.split(/\n{2,}/)).map((para, i, all) => (
              <p key={i} className="sky-para">
                {para}
                {streaming && i === all.length - 1 && <span className="sky-caret" aria-hidden="true" />}
              </p>
            ))}
            {streaming && content === '' && (
              <p className="sky-para">
                <span className="sky-caret" aria-hidden="true" />
              </p>
            )}
          </div>
        )}
        <ChatImages images={images} />
        {turn.sources && turn.sources.length > 0 && !streaming && <SourcesFold sources={turn.sources} />}
        {runs && runs.length > 0 && <RunList runs={runs} folded={!streaming} />}
        {turn.error && <span className="sky-fate">turn failed — {turn.error}</span>}
        {!streaming && (turn.usage || turn.timing || branch || onReplyThread) && (
          <div className="sky-reply-foot">
            <ReplyDetails
              usage={turn.usage}
              model={
                turn.model
                  ? `${turn.modelLabel ?? (labelOf ?? ((p) => p))(turn.model)}${turn.effort ? ` · ${effortLabel(turn.effort)}` : ''}`
                  : undefined
              }
              timing={turn.timing}
            />
            {(branch || onReplyThread) && (
              <div className="sky-reply-acts">
                {onReplyThread && (
                  <ReplyThreadLink
                    thread={replyThread}
                    active={replyThread?.id != null && replyThread.id === activeReplyId}
                    onOpen={onReplyThread}
                  />
                )}
                {branch && (
                  <Menu position="bottom-end" withinPortal shadow="md">
                    <Menu.Target>
                      <ActionIcon variant="subtle" aria-label="Response options" disabled={branching}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                          <circle cx="5" cy="12" r="1.7" />
                          <circle cx="12" cy="12" r="1.7" />
                          <circle cx="19" cy="12" r="1.7" />
                        </svg>
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item onClick={branch}>Branch from here…</Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
