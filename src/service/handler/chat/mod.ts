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

import * as path from 'node:path'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { streamSSE } from 'hono/streaming'
import type { LegalReviewStore } from '#lib/legalReview/store.ts'
import type { WritingDraftStore } from '#lib/writingVoice/drafts.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import type { TokenUsage } from '#shared/ai/usage.ts'
import { runWithUsageSource } from '#shared/ai/usageLog.ts'
import type { RebuildReport } from '#shared/models/Chat/ChatContext/mod.ts'
import type { ApprovalDecision } from '#shared/models/Chat/ChatEngine/mod.ts'
import type ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import type {
  ChatMessageFiles,
  ChatSessionEvent,
  EndOptions,
  ModelProfile,
  TurnReport,
} from '#shared/models/Chat/ChatSession/mod.ts'
import { listDayChats, type ResumeSession } from '#shared/models/Chat/ChatStore/mod.ts'
import { branchDir } from '#shared/models/Chat/document/lineage.ts'
import type { ChatParent } from '#shared/models/Chat/document/mod.ts'
import type { ResumeState } from '#shared/models/Chat/document/resume.ts'
import type { ConversationMessage } from '#shared/models/Chat/type.d.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { thrownOutcome, TimingSpan } from '#shared/timing/mod.ts'
import { timingLine } from '#shared/timing/summary.ts'
import { chatFileError, MAX_CHAT_FILE_BYTES, MAX_CHAT_FILES, splitChatFiles } from '#universal/ai/chatFiles.ts'
import { isEffortOverride, type Effort, type EffortOverride } from '#universal/ai/effort.ts'
import { fitBudget } from '#universal/ai/readingBudget.ts'
import { type PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { hold } from '../../activity.ts'
import { prettyModel } from '../settings/mod.ts'
import { branchPoints } from './branchPoint.ts'
import { callSubject } from './callSubject.ts'
import { registerWritingDraftRoutes } from './drafts.ts'
import { createChatFileRoutes, readChatFiles } from './files.ts'
import type { InterruptedTurn } from './interrupted.ts'
import { registerLegalReviewRoutes } from './legalReview.ts'
import { registerReplyThreads, type ReplyThreadHost } from './replyThreads.ts'
import { registerSelectionStarts, type SelectionStartOptions } from './selection.ts'
import { timelineOf } from './timeline.ts'
import { inspectablePayload, recordToolExecution, restoreToolRuns, toolRunsFromMessages } from './toolRuns.ts'
import { isSpokenTurns, voiceConversation } from './voiceTranscript.ts'

/** What a thread is tuned with before its first message builds it. */
export interface ThreadPrefs {
  /** Model profile name */
  profile?: string
  effort?: EffortOverride
  /** Token budget for the assembled document context; zero keeps the notebook closed */
  contextTokens?: number
  /** Whether ending files the thread. Active threads always keep a temporary recovery snapshot. */
  saves?: boolean
}

/** A tool call awaiting the person's go, as the page shows it. */
export interface ApprovalCard {
  toolName: string
  /** The call as the tool describes it — its own formatter's lines, or the input's fields */
  lines: string[]
  /** The file the call is scoped to, when a go can stand for the session ("allow for this file") */
  sessionKey?: string
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
export type AskApproval = (card: ApprovalCard) => Promise<ApprovalDecision & { always?: boolean }>

/**
 * A tool's own words as it works, as the host hears them from the
 * command's output: where a run starts, each line it prints, how it ends —
 * and, once it has ended, one line on what it did.
 */
export type ToolOutputEvent =
  | { type: 'tool-started'; tool: string }
  | { type: 'tool-line'; tool: string; text: string; level: 'log' | 'error' }
  | { type: 'tool-finished'; tool: string; status: 'success' | 'fail' | 'error' }
  | { type: 'tool-summary'; tool: string; text: string }

/** One tool call at work, kept with the thread like the cards — the page shows it under the reply it belongs to. */
export interface ToolRun {
  callId?: string
  input?: unknown
  output?: unknown
  error?: string
  phase?: 'preparing' | 'waiting' | 'running'
  /** The tool as the model calls it (`google_agent`) */
  tool: string
  /** The reply's turn index — the run sits with that reply */
  at: number
  /** Epoch milliseconds when the run started — the page counts the wait from it */
  started: number
  /** What the command printed, oldest first, colors stripped; the newest stay when the cap is hit */
  lines: string[]
  /** How it ended; null while it runs */
  status: 'success' | 'fail' | 'error' | null
  /** Epoch milliseconds when it ended — with `started`, how long it took, kept for a reload */
  finished?: number
  /** One line on what it did, from a small model once it ended — the label its output folds under. Absent until then, or when none came */
  summary?: string
  /** What the call was about — the query, the page, the mission — from the model's record of the call, once its step ends */
  subject?: string
}

/**
 * What a thread starts from when it does not start empty: a crash snapshot
 * read back, a saved chat opened to continue, or the turns a branch
 * inherits from the thread it left.
 */
export interface ThreadRestore {
  id: string
  runs?: ToolRun[]
  prefs?: ThreadPrefs
  title?: string | null
  /** When the thread started; absent, it starts now — a fresh branch does */
  startTime?: PlainDateTime
  /** The conversation and context the thread begins with */
  state: ResumeState
  /** Files recorded by the active thread before a restart. */
  attachments?: Attachment[]
  /** The durable approval keys the snapshot carried (`tool:fileId`) */
  approvals?: readonly string[]
  /** A saved chat being continued: the session writes back to its file */
  resume?: ResumeSession
  /** A branch: the chat it left, and the turn it left after */
  parent?: ChatParent | null
  /** The live thread a branch left, when it is one */
  parentId?: string | null
  /** The message the thread was answering when the service went down — shown with the way to send it again, never given to the model */
  interrupted?: InterruptedTurn | null
}

/** Where a branch came from, as a thread carries it: the parent's file, the turn, the live thread when there is one, and its name. */
/** A branch filed beside a thread's file. */
export interface SavedBranch {
  /** The branch's file, relative to the notebook root */
  chat: string
  /** The turn it left after */
  turn: number
  title: string | null
  /** `HH:MM`, from its filename */
  time: string
}

export interface ThreadParent extends ChatParent {
  id: string | null
  /** The parent's name as the page shows it; null when nothing knows it */
  title: string | null
}

/**
 * Builds a session for a thread; the host's wiring of producers, tools,
 * prompt, and model. With `restore`, the session picks up that state and
 * starts where it did.
 */
export type ChatSessionFactory = (
  id: string,
  onEvent: (event: ChatSessionEvent | ToolOutputEvent) => void,
  prefs: ThreadPrefs,
  ask: AskApproval,
  restore?: ThreadRestore,
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
  /** Tokens the host serves in one request; absent when the model takes any budget */
  contextWindow?: number
  effort?: { default: Effort | null; levels: readonly Effort[] }
  /** Same model and non-effort options: built-in effort variants share one picker entry. */
  group?: string
  builtin?: boolean
}

/** How a thread is tuned: the model it thinks with and the reading budget. */
export interface ThreadSettings {
  model: { current: string; default: string; choices: ModelChoice[] }
  effort?: EffortOverride
  /** Token budget for the assembled document context; zero keeps the notebook closed */
  contextTokens: number
  /** How many documents the model sees as the context stands; null before any turn */
  kept: number | null
  /** Documents in the universe, shipped and cut alike; null before any turn */
  documents: number | null
  /** Whether ending files the thread; false keeps nothing of it */
  saves: boolean
}

/** The host's catalog and defaults behind the settings routes. */
export interface ChatSettingsHost {
  defaultModel: string
  defaultContextTokens: number
  choices(): ModelChoice[]
  /** A choice as a session takes it; throws on a name it doesn't know */
  resolve(
    name: string,
    effort?: EffortOverride,
  ): {
    model: ResolvedModel
    profile: ModelProfile
    contextWindow?: number
  }
  /**
   * The profile a model id answers to, for a turn read back from a log —
   * the thread's current profile when it is that model, else the first
   * profile on it; undefined when no profile has it.
   */
  profileFor?(model: string, current: string): string | undefined
}

export interface ChatRoutesOptions {
  selectionStarts?: SelectionStartOptions
  writingDrafts?: WritingDraftStore
  legalReviews?: LegalReviewStore
  createSession: ChatSessionFactory
  /** The console reader's attachment directory; uploads and their permanent download links use it too. */
  attachmentsRoot?: string
  /**
   * Where a thread's temporary recovery snapshot lives.
   */
  snapshotPath?: (id: string, startTime: PlainDateTime) => string
  /**
   * Names a thread from its first message, alongside the reply. A failed
   * attempt can retry with the first exchange; saved titles stay fixed.
   */
  title?: (turns: ConversationMessage[]) => Promise<string | undefined>
  /**
   * How often a turn's stream carries a heartbeat frame while nothing else
   * is said — the page reads silence past it as a lost connection. Ten
   * seconds unless set.
   */
  heartbeatMs?: number
  /**
   * The threads that were live when the service last ran, from their crash
   * snapshots, oldest start first. Read once at start so a restart never
   * loses a thread: every snapshot becomes a thread again, its conversation
   * on the page at once and its context restored at its next message.
   */
  snapshots?: () => Promise<ThreadRestore[]>
  /**
   * A saved chat, by its path relative to the notebook root, as a thread to
   * continue: the session that writes back to it, and when it started.
   * Null for a path that is not a saved chat. Absent, saved chats cannot be
   * opened as threads.
   */
  openSaved?: (chat: string) => Promise<{ resume: ResumeSession; startTime: PlainDateTime } | null>
  /** The models to choose from and the budget's default — absent, a thread cannot be tuned */
  settings?: ChatSettingsHost
  /** Hears each message before the turn runs — a pasted file reference is a go for that file */
  onMessage?: (id: string, message: string) => void
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
  /** The generated subject, else the full first message; null before any */
  title: string | null
  state: ThreadState
  /** The reply so far while streaming, the last reply when done, the error when failed */
  line: string | null
  /** Notebook time of the last message, `HH:MM`; null before any */
  when: string | null
  /** The day the thread started, `YYYY-MM-DD` — the day it belongs to and files under */
  day: string
  turns: number
  busy: boolean
  /** False for a thread that will not be kept — the list says so */
  saves: boolean
  /** The chat this thread branched from; null for one that began on its own */
  parent: ThreadParent | null
  /** Messages at the head of the thread that are its parent's */
  inherited: number
  /** The saved chat this thread continues, relative to the notebook root; null for one with no file yet */
  saved: string | null
}

/** What travels the turn's stream: the session's events, and what the routes add around them — approvals and tool runs. */
type WireEvent =
  | ChatSessionEvent
  | { type: 'tool-updated'; run: ToolRun }
  | { type: 'approval-request'; approval: PendingApproval }
  | { type: 'approval-answered'; id: string; approved: boolean; at: number }
  | { type: 'tool-call'; toolName: string; input: unknown; subject?: string }
  | { type: 'tool-started'; run: ToolRun }
  | { type: 'tool-line'; tool: string; at: number; text: string; level: 'log' | 'error' }
  | { type: 'tool-finished'; tool: string; at: number; status: 'success' | 'fail' | 'error'; finished: number }
  | { type: 'tool-summary'; tool: string; at: number; text: string }
  | { type: 'title'; title: string }

export interface Thread {
  session: ChatSession
  /** The generated subject; null until the thread has been named */
  title: string | null
  /** Prevent overlapping title requests while the reply or another message finishes. */
  naming: boolean
  /** The chat this thread branched from, with the live thread it left when there is one */
  parent: ThreadParent | null
  started: boolean
  /** One turn at a time: a second message while one runs is refused, not queued */
  busy: boolean
  /** Where the running turn's events go; null between turns */
  sink: ((event: WireEvent) => void) | null
  /** Tool calls held for the person's go, by approval id */
  pending: Map<string, PendingApproval & { resolve: (decision: ApprovalDecision & { always?: boolean }) => void }>
  /** The calls answered so far, oldest first */
  answered: AnsweredApproval[]
  /** Every tool run so far, oldest first — the running one is the last without a status */
  runs: ToolRun[]
  /** The query set currently being gathered, before its context log entry exists. */
  liveQueries: { turn: number; queries: string[] } | null
  /** Whether ending files the thread; both choices retain recovery while active. */
  saves: boolean
  /** Each reply's token counts and the profile that answered, by the reply's turn index */
  usage: Map<number, TokenUsage & { model: string; modelLabel?: string; effort?: Effort }>
  timings: Map<number, string>
  /** The message the service was answering when it went down, until the person sends again */
  interrupted: InterruptedTurn | null
  state: ThreadState
  /** The reply as it streams, for the list's last line */
  partial: string
  /** A tick from a monotonic counter — ordering the list only, never a time */
  updatedAt: number
  /** The last rebuild's full report — the per-document records the wire leaves out */
  context: RebuildReport | null
  /** Model profile name the thread thinks with */
  profile: string
  effort?: EffortOverride
}

const LINE_CHARS = 140
/** How long a branch waits for the titler to name the family before the first words stand in. */
const NAMING_PATIENCE_MS = 4000
/** Lines kept per tool run — a mission narrates for an hour; the newest lines are the ones that matter */
const RUN_LINES = 400

function head(text: string, chars = LINE_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > chars ? `${flat.slice(0, chars - 1)}…` : flat
}

/** Keep the full opening message as a fallback so a subject near its end survives. */
function threadTitle(turns: ConversationMessage[]): string | null {
  const first = turns.find((t) => t.role === 'user')
  if (!first) return null
  const { text, files } = splitChatFiles(first.content)
  const words = (text || files.map((file) => file.name).join(', ')).replace(/\s+/g, ' ').trim()
  return words || null
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

/** The tool run under way, if any. */
function runningOf(thread: Thread): ToolRun | undefined {
  return thread.runs.findLast((run) => run.status === null)
}

/**
 * Keep a tool's output with the thread and shape it for the wire. A line
 * from a tool nobody announced starts its run — a host without boundaries
 * still gets its lines shown.
 */
function recordToolOutput(thread: Thread, event: ToolOutputEvent): WireEvent | null {
  const at = thread.session.turns.length
  const open = thread.runs.findLast((run) => run.tool === event.tool && run.status === null)
  switch (event.type) {
    case 'tool-started': {
      if (open) return null
      // A call that asked first was recorded before it ran: that record becomes the run.
      const record = thread.runs.findLast(
        (run) => !run.callId && run.tool === event.tool && run.at === at && run.lines.length === 0,
      )
      if (record) {
        record.status = null
        record.started = Date.now()
        return { type: 'tool-started', run: record }
      }
      const run: ToolRun = { tool: event.tool, at, started: Date.now(), lines: [], status: null }
      thread.runs.push(run)
      return { type: 'tool-started', run }
    }
    case 'tool-line': {
      let run = open
      if (!run) {
        run = { tool: event.tool, at, started: Date.now(), lines: [], status: null }
        thread.runs.push(run)
        thread.sink?.({ type: 'tool-started', run })
      }
      if (run.lines.length >= RUN_LINES) run.lines.shift()
      run.lines.push(event.text)
      return { type: 'tool-line', tool: run.tool, at: run.at, text: event.text, level: event.level }
    }
    case 'tool-finished': {
      if (!open) return null
      // Command activity can finish before its enclosing tool returns. The engine owns that lifecycle.
      if (open.callId) return null
      open.status = event.status
      open.finished = Date.now()
      return { type: 'tool-finished', tool: open.tool, at: open.at, status: event.status, finished: open.finished }
    }
    case 'tool-summary': {
      // The line comes after the run ended: it labels the newest ended run of that tool still without one.
      const ended = thread.runs.findLast(
        (run) => run.tool === event.tool && run.status !== null && run.summary === undefined,
      )
      if (!ended) return null
      ended.summary = event.text
      return { type: 'tool-summary', tool: ended.tool, at: ended.at, text: event.text }
    }
  }
}

/**
 * The model's record of a call, as its step ends — after the tool ran, or
 * before it when the call waits on a go. What the call was about lands on
 * the run that spoke for it; a tool that ran without a word (a web search)
 * gets a run for the record alone, so the page can name the call and a
 * reload still shows it.
 */
function recordToolCall(
  thread: Thread,
  tool: string,
  subject: string | undefined,
  input?: unknown,
  callId?: string,
): void {
  const at = thread.session.turns.length
  const run =
    (callId ? thread.runs.find((r) => r.callId === callId) : undefined) ??
    thread.runs.findLast((r) => !r.callId && r.tool === tool && r.at === at && r.subject === undefined)
  if (run) {
    if (subject) run.subject = subject
    run.input = inspectablePayload(input)
    run.callId = callId ?? run.callId
    return
  }
  thread.runs.push({
    tool,
    at,
    started: new ZonedDateTime().epochMilliseconds,
    lines: [],
    status: 'success',
    subject,
    input: inspectablePayload(input),
    callId,
  })
}

function summarize(id: string, thread: Thread, baseDir: string): ThreadSummary {
  const { session, state } = thread
  const lastReply = [...session.turns].reverse().find((t) => t.role === 'assistant')
  const running = thread.busy ? runningOf(thread) : undefined
  let line: string | null = null
  if (state === 'streaming') line = head(thread.partial)
  else if (state === 'waiting') line = 'needs your go'
  else if (running && running.lines.length > 0) line = head(running.lines.at(-1) ?? '')
  else if (state === 'done' && lastReply) line = head(lastReply.content)
  else if (state === 'failed') line = thread.partial || null
  return {
    id,
    // A branch goes by its own first words, never its parent's.
    title: titleOf(thread),
    state,
    line,
    when: (session.turns.at(-1)?.when ?? thread.interrupted?.when ?? undefined)?.slice(11) ?? null,
    day: session.startTime.plainDate.ymd,
    turns: session.turns.length,
    busy: thread.busy,
    saves: thread.saves,
    parent: thread.parent,
    inherited: session.inherited,
    saved: savedOf(thread, baseDir),
  }
}

/** The file a thread writes back to, relative to the notebook root; null before it has one. */
function savedOf(thread: Thread, baseDir: string): string | null {
  const file = thread.session.resume?.filePath
  return file ? path.relative(baseDir, file) : null
}

/**
 * The branches filed beside a thread's file, each with the turn it left
 * after, earliest turn first. A thread with no file has none: a branch
 * files its parent before it files itself.
 */
async function savedBranchesOf(saved: string | null, baseDir: string): Promise<SavedBranch[]> {
  if (!saved) return []
  const rows = await listDayChats(branchDir(path.join(baseDir, saved))).catch(() => [])
  return rows
    .filter((row) => row.parent?.chat === saved && row.parent.kind !== 'thread')
    .map((row) => ({
      chat: path.relative(baseDir, row.path),
      turn: row.parent!.turn,
      title: row.summary || null,
      time: row.time,
    }))
    .sort((a, b) => a.turn - b.turn || a.time.localeCompare(b.time))
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
  return { ...rest, timingText: turn.timing ? timingLine(turn.timing) : undefined, context: { errors: context.errors } }
}

/** A turn's stream says something at least this often, so the page can tell a thinking model from a dead connection. */
const HEARTBEAT_MS = 10_000

/** What a restored thread says in the list when the service went down answering it */
const INTERRUPTED_LINE = 'sky restarted while replying — send it again'

/** The generated subject, else the first own message or the message a restart took. */
function titleOf(thread: Thread): string | null {
  return (
    thread.title ??
    threadTitle(thread.session.turns.slice(thread.session.inherited)) ??
    (thread.interrupted ? threadTitle([{ role: 'user', content: thread.interrupted.message }]) : null)
  )
}

export function createChatRoutes(options: ChatRoutesOptions): Hono {
  const threads = new Map<string, Thread>()
  // Parent keys are written relative to the notebook root, the time directory's parent.
  const baseDir = path.dirname(options.timeDir)
  const opening = new Map<string, Promise<Thread>>()
  // Reserve a turn before awaiting restoration or construction, including its settings.
  const accepting = new Set<string>()
  const activeTurns = new Map<string, AbortController>()
  // Tuning chosen before a thread's first message — applied when it is built.
  const pending = new Map<string, ThreadPrefs>()
  const app = new Hono()
  registerSelectionStarts(app, options.selectionStarts)
  if (options.attachmentsRoot) app.route('/files', createChatFileRoutes(options.attachmentsRoot))
  app.use('/:id/messages', bodyLimit({ maxSize: MAX_CHAT_FILE_BYTES + 1024 * 1024 }))
  // Two threads can move within one millisecond; a counter keeps "newest
  // activity first" true where a clock would tie.
  let tick = 0

  // A thread exists from its first message — or from the snapshot it left
  // behind. Two first messages racing for the same id share one session
  // rather than each building their own.
  const open = (id: string, restore?: ThreadRestore): Promise<Thread> => {
    const existing = threads.get(id)
    if (existing) return Promise.resolve(existing)
    let building = opening.get(id)
    if (!building) {
      const prefs = pending.get(id) ?? restore?.prefs ?? {}
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
          if (!thread.busy || activeTurns.get(id)?.signal.aborted) {
            resolve({ approved: false, reason: 'The response was stopped.' })
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
            if (event.type === 'tool-execution-start' || event.type === 'tool-execution-end') {
              const run = recordToolExecution(thread.runs, thread.session.turns.length, event)
              thread.updatedAt = ++tick
              thread.sink?.({ type: 'tool-updated', run })
              void thread.session.snapshot()
              return
            }
            if (
              event.type === 'tool-started' ||
              event.type === 'tool-line' ||
              event.type === 'tool-finished' ||
              event.type === 'tool-summary'
            ) {
              const wire = recordToolOutput(thread, event)
              thread.updatedAt = ++tick
              if (wire) thread.sink?.(wire)
              return
            }
            if (event.type === 'tool-call') {
              const subject = callSubject(inspectablePayload(event.input))
              recordToolCall(thread, event.toolName, subject, event.input, event.toolCallId)
              thread.updatedAt = ++tick
              thread.sink?.({ ...event, input: inspectablePayload(event.input), subject })
              return
            }
            const next = stateAfter(event)
            if (next) thread.state = next
            if (event.type === 'model-start') thread.partial = ''
            if (event.type === 'text-delta') thread.partial += event.text
            if (event.type === 'context-rebuilt') thread.context = event.report
            if (event.type === 'context-queries') thread.liveQueries = { turn: event.turn, queries: event.queries }
            thread.updatedAt = ++tick
            thread.sink?.(event)
          },
          prefs,
          ask,
          restore,
        )
        .then((session) => {
          if (restore?.title) session.pinTitle(restore.title)
          const thread: Thread = {
            session,
            // A continued chat goes by its saved title from the start.
            title: restore?.title ?? (restore?.resume?.summary || null),
            naming: false,
            parent: restore?.parent
              ? {
                  ...restore.parent,
                  id: restore.parentId ?? null,
                  title: (restore.parentId ? threads.get(restore.parentId)?.title : null) ?? null,
                }
              : null,
            started: false,
            busy: false,
            sink: null,
            pending: new Map(),
            answered: [],
            runs:
              restore?.runs ??
              restoreToolRuns(restore?.resume?.recovery?.host?.runs) ??
              toolRunsFromMessages(restore?.state.modelMessages),
            liveQueries: null,
            usage: new Map(),
            timings: new Map(),
            interrupted: restore?.interrupted ?? null,
            // Kept unless told otherwise before the first message.
            saves: prefs.saves ?? true,
            // A restored thread's last turn is complete — unless the service went
            // down answering it, which the thread says until the person sends again.
            state: restore?.interrupted ? 'failed' : restore ? 'done' : 'new',
            partial: restore?.interrupted ? INTERRUPTED_LINE : '',
            updatedAt: ++tick,
            context: null,
            profile: prefs.profile ?? options.settings?.defaultModel ?? '',
            effort: prefs.effort ?? 'default',
          }
          // A thread read back from a snapshot or a saved chat carries each
          // turn's token counts and timing in its context log; the reply they
          // belong to is the assistant message that closed that turn.
          if (restore) {
            // The state's own log: the session takes it up at its first message, so it is not on the session yet.
            for (const entry of restore.state.contextLog) {
              const at = entry.turn * 2 - 1
              if (at < 0 || at >= session.turns.length) continue
              if (entry.usage) {
                const ran = entry.settings
                const model = (ran && options.settings?.profileFor?.(ran.model, thread.profile)) || thread.profile
                thread.usage.set(at, {
                  ...entry.usage,
                  model: ran?.preset ?? model,
                  modelLabel: ran ? prettyModel(ran.model) : undefined,
                  effort: ran?.effort,
                })
              }
              if (entry.timing) thread.timings.set(at, timingLine(entry.timing))
            }
          }
          threads.set(id, thread)
          session.snapshotOnSend = true
          session.snapshotHostState = () => ({
            saves: thread.saves,
            profile: thread.profile,
            effort: thread.effort,
            title: thread.title,
            parentId: thread.parent?.id ?? null,
            saved: savedOf(thread, baseDir),
            runs: thread.runs,
          })
          pending.delete(id)
          return thread
        })
        .finally(() => opening.delete(id))
      opening.set(id, building)
    }
    return building
  }

  const snapshotThread = async (thread: Thread) => {
    const release = hold('chat recovery')
    try {
      await thread.session.snapshot()
    } finally {
      release()
    }
  }

  // Name the opening question while context and the reply are being prepared.
  // A branch uses its own question; a failed attempt can retry with the reply.
  const name = (id: string, thread: Thread, message?: string) => {
    const from = thread.session.inherited
    const turns = thread.session.turns.slice(from, from + 2)
    const openingMessage = message ?? thread.interrupted?.message
    if (turns.length === 0 && openingMessage) turns.push({ role: 'user', content: openingMessage })
    if (!options.title || thread.title !== null || thread.naming || turns.length === 0) return
    thread.naming = true
    void Promise.resolve()
      .then(() => runWithUsageSource('ai:chat', () => options.title!(turns)))
      .then(async (named) => {
        const title = named?.trim()
        if (!title || threads.get(id) !== thread || thread.title !== null) return
        thread.title = title
        thread.updatedAt = ++tick
        thread.sink?.({ type: 'title', title })
        if (thread.state !== 'saving') await snapshotThread(thread)
      })
      .catch(() => {})
      .finally(() => {
        thread.naming = false
      })
  }

  // The threads the last run left behind come back first, in start order,
  // so the newest ends up newest in the list. A snapshot that will not
  // build is skipped, never fatal — the rest of the day must still open.
  const restored = (async () => {
    if (!options.snapshots) return
    let refs: ThreadRestore[]
    try {
      refs = await options.snapshots()
    } catch {
      return
    }
    for (const ref of refs) {
      if (threads.has(ref.id)) continue
      try {
        const thread = await open(ref.id, ref)
        name(ref.id, thread)
      } catch {
        // Left where it is for a later run to try again.
      }
    }
  })()

  const replyHost: ReplyThreadHost = {
    threads,
    baseDir,
    options,
    ready: restored,
    open,
    changed: (thread) => {
      thread.updatedAt = ++tick
    },
  }
  const openingReply = registerReplyThreads(app, replyHost)

  // The window the host serves for a profile, as the picker lists it; undefined takes any budget.
  const windowOf = (host: ChatSettingsHost, profile: string) =>
    host.choices().find((choice) => choice.name === profile)?.contextWindow

  // A thread's tuning: the live thread's own, else what was chosen for it, else the host's defaults.
  const settingsOf = (id: string): ThreadSettings | null => {
    const host = options.settings
    if (!host) return null
    const thread = threads.get(id)
    const prefs = pending.get(id)
    const current = thread?.profile ?? prefs?.profile ?? host.defaultModel
    return {
      model: {
        current,
        default: host.defaultModel,
        choices: host.choices(),
      },
      effort: thread?.effort ?? prefs?.effort ?? 'default',
      contextTokens:
        thread?.session.contextTokens ??
        fitBudget(prefs?.contextTokens ?? host.defaultContextTokens, windowOf(host, current)),
      kept: thread ? keptOf(thread) : null,
      documents: thread?.context?.collectionSize ?? null,
      saves: thread?.saves ?? prefs?.saves ?? true,
    }
  }

  // A pin, a drop, or a new budget reassembles between turns without a log
  // entry, so the latest assembly answers before the log does.
  const keptOf = (thread: Thread): number | null => thread.context?.stats?.kept ?? thread.session.kept

  app.post('/:id/stop', (c) => {
    const id = c.req.param('id')
    const active = activeTurns.get(id)
    if (!active) {
      if (!threads.has(id)) return c.json({ message: 'no such thread' }, 404)
      return c.json({ stopping: false })
    }
    active.abort()
    const thread = threads.get(id)
    if (thread) {
      for (const approval of thread.pending.values()) {
        approval.resolve({ approved: false, reason: 'The response was stopped.' })
      }
      thread.pending.clear()
      thread.updatedAt = ++tick
    }
    return c.json({ stopping: true })
  })

  app.post('/:id/messages', async (c) => {
    const id = c.req.param('id')
    const multipart = c.req.header('content-type')?.startsWith('multipart/form-data')
      ? await c.req.formData().catch(() => null)
      : null
    const uploads = multipart ? multipart.getAll('files') : []
    if (uploads.some((file) => !(file instanceof File))) return c.json({ message: 'Expected file attachments.' }, 400)
    const uploadError = chatFileError(uploads as File[])
    if (uploadError) return c.json({ message: uploadError }, 400)
    let rawBody: unknown
    try {
      rawBody = multipart ? JSON.parse(String(multipart.get('message') ?? 'null')) : await c.req.json()
    } catch {
      return c.json({ message: 'Invalid message.' }, 400)
    }
    const body = rawBody as {
      message?: unknown
      profile?: unknown
      effort?: unknown
      contextTokens?: unknown
      saves?: unknown
      continuing?: unknown
    } | null
    let message = typeof body?.message === 'string' ? body.message.trim() : ''
    const linked = splitChatFiles(message)
    const hasFiles = uploads.length > 0 || linked.files.length > 0
    if (!message && !hasFiles) return c.json({ message: 'message is required' }, 400)
    if (uploads.length + linked.files.length > MAX_CHAT_FILES)
      return c.json({ message: `Attach up to ${MAX_CHAT_FILES} files at a time.` }, 400)
    if (hasFiles && !options.attachmentsRoot) return c.json({ message: 'File attachments are unavailable.' }, 400)
    // A message carries the choices visible when Send was pressed. Missing
    // choices must never turn a restarted service's defaults into consent.
    if (body?.profile === undefined || body.contextTokens === undefined || body.saves === undefined) {
      return c.json({ message: 'Each message needs model, reading budget, and save settings. Reload the page.' }, 400)
    }
    if (typeof body.profile !== 'string') return c.json({ message: 'profile must be a name' }, 400)
    if (body.effort !== undefined && !isEffortOverride(body.effort))
      return c.json({ message: 'Choose a supported effort level or default.' }, 400)
    if (
      !(typeof body.contextTokens === 'number' && Number.isSafeInteger(body.contextTokens) && body.contextTokens >= 0)
    ) {
      return c.json({ message: 'contextTokens must be a whole number, zero or more' }, 400)
    }
    if (typeof body.saves !== 'boolean') return c.json({ message: 'saves must be true or false' }, 400)
    if (body.continuing !== undefined && typeof body.continuing !== 'boolean')
      return c.json({ message: 'continuing must be true or false' }, 400)
    const host = options.settings
    if (!host) return c.json({ message: 'this host has no settings' }, 400)
    let chosen: ReturnType<ChatSettingsHost['resolve']>
    const priorPrefs = threads.get(id)
      ? { profile: threads.get(id)!.profile, effort: threads.get(id)!.effort }
      : pending.get(id)
    const effort = isEffortOverride(body.effort)
      ? body.effort
      : priorPrefs?.profile === body.profile
        ? (priorPrefs.effort ?? 'default')
        : 'default'
    try {
      chosen = host.resolve(body.profile, effort)
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
    if (fitBudget(body.contextTokens, chosen.contextWindow) !== body.contextTokens) {
      return c.json({ message: 'The reading budget exceeds this model’s limit. Choose a smaller budget.' }, 400)
    }
    const prefs = { profile: body.profile, effort, contextTokens: body.contextTokens, saves: body.saves }
    if (accepting.has(id) || threads.get(id)?.busy) {
      return c.json({ message: 'a turn is already running on this thread' }, 409)
    }
    accepting.add(id)
    const active = new AbortController()
    activeTurns.set(id, active)
    const release = hold('chat turn')

    // Start at acceptance of a valid prompt, before thread construction or initial context.
    const timing = new TimingSpan({ kind: 'turn', name: 'ai:chat' }, undefined, true)
    let thread: Thread | undefined
    let files: ChatMessageFiles | undefined
    try {
      thread = await timing.run(async () => {
        await restored
        await opening.get(id)
        if (body.continuing === true && !threads.has(id)) return undefined
        if (!threads.has(id)) pending.set(id, prefs)
        return open(id)
      })
      if (!thread) {
        activeTurns.delete(id)
        release()
        timing.finish('error')
        return c.json(
          { message: 'This chat could not be restored. Keep this page open so its earlier messages remain available.' },
          409,
        )
      }
      thread.busy = true
      if (hasFiles) {
        try {
          const read = await readChatFiles(
            linked.text,
            uploads as File[],
            linked.files,
            thread.session.startTime.plainDate,
            options.attachmentsRoot!,
          )
          message = read.message
          files = read.files
        } catch (error) {
          activeTurns.delete(id)
          thread.busy = false
          release()
          timing.finish('error')
          return c.json({ message: (error as Error).message }, 400)
        }
      }
      thread.session.setModel(chosen.model, chosen.profile)
      thread.profile = prefs.profile
      thread.effort = prefs.effort
      if (thread.session.contextTokens !== prefs.contextTokens) thread.session.setContextTokens(prefs.contextTokens)
      thread.saves = prefs.saves
      options.onMessage?.(id, message)
    } catch (error) {
      activeTurns.delete(id)
      if (thread) thread.busy = false
      release()
      timing.finish(thrownOutcome(error))
      throw error
    } finally {
      accepting.delete(id)
    }
    // Whatever the person sends now answers for the message a restart took — a resend or a new one.
    thread.interrupted = null
    // The baseline gather before the first event is a read too.
    thread.state = 'reading'
    thread.partial = ''
    thread.updatedAt = ++tick

    return streamSSE(
      c,
      async (stream) => {
        // Frames leave in emission order, each write queued behind the last —
        // and say what was known when emitted: a run's record keeps changing
        // after its started frame, and a frame written later must not carry that.
        let chain = Promise.resolve()
        const frame = (event: string, data: unknown) => {
          const body = JSON.stringify(data)
          chain = chain.then(() => stream.writeSSE({ event, data: body }))
        }
        thread.sink = (event) => frame(event.type, wireEvent(event))
        // The model can think for a minute before its first token. A frame on
        // a timer keeps the page told the connection lives; silence past it
        // is a lost connection, however the socket looks from the browser.
        const beat = setInterval(() => frame('heartbeat', { type: 'heartbeat' }), options.heartbeatMs ?? HEARTBEAT_MS)
        try {
          frame('turn-started', {})
          if (files) frame('user-message', { content: message })
          name(id, thread, message)
          const turn = await timing.run(async () => {
            if (!thread.started && !active.signal.aborted) {
              await thread.session.start()
              thread.started = true
              frame('session-started', {
                documents: thread.session.paths.length,
                closed: thread.session.contextTokens === 0,
              })
            }
            // The first reply includes the initial context gathering in its timing.
            return runWithUsageSource('ai:chat', () => thread.session.send(message, files, active.signal))
          })
          if (turn.usage)
            thread.usage.set(thread.session.turns.length - 1, {
              ...turn.usage,
              model: thread.profile,
              modelLabel: prettyModel(chosen.profile.model),
              effort: chosen.profile.effort,
            })
          if (turn.timing && !turn.error) thread.timings.set(thread.session.turns.length - 1, timingLine(turn.timing))
          clearInterval(beat)
          // A run still open when the turn ends never reported its end — the turn did.
          for (const run of thread.runs) {
            if (run.status !== null) continue
            run.status = turn.error || turn.stopped ? 'error' : 'success'
            run.finished = new ZonedDateTime().epochMilliseconds
          }
          thread.state = turn.error ? 'failed' : 'done'
          if (turn.error) thread.partial = turn.error
          thread.updatedAt = ++tick
          frame('turn', {
            ...(wireTurn(turn) as object),
            model: thread.profile,
            modelLabel: prettyModel(chosen.profile.model),
            effort: chosen.profile.effort,
            branchPoint: turn.error ? undefined : branchPoints(thread.session.turns).at(-1),
          })
          await chain
          if (!turn.error) name(id, thread)
        } catch (error) {
          timing.finish(thrownOutcome(error))
          throw error
        } finally {
          timing.finish('incomplete')
          clearInterval(beat)
          thread.sink = null
          thread.busy = false
          activeTurns.delete(id)
          release()
        }
      },
      async (err, stream) => {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: err.message }) })
      },
    )
  })

  // A completed voice segment joins the same durable thread, without asking the text model to answer again.
  app.post('/:id/voice', async (c) => {
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as {
      after?: unknown
      turns?: unknown
      profile?: unknown
      effort?: unknown
      contextTokens?: unknown
      saves?: unknown
    } | null
    if (!body || !Number.isSafeInteger(body.after) || (body.after as number) < 0 || !isSpokenTurns(body.turns)) {
      return c.json({ message: 'expected a conversation position and voice transcript' }, 400)
    }
    const host = options.settings
    if (
      !host ||
      typeof body.profile !== 'string' ||
      typeof body.saves !== 'boolean' ||
      typeof body.contextTokens !== 'number' ||
      !Number.isSafeInteger(body.contextTokens) ||
      body.contextTokens < 0
    ) {
      return c.json(
        { message: 'Voice needs the chat’s model, reading budget, and save settings. Reload the page.' },
        400,
      )
    }
    if (body.effort !== undefined && !isEffortOverride(body.effort))
      return c.json({ message: 'Choose a supported effort level or default.' }, 400)
    const effort = isEffortOverride(body.effort) ? body.effort : 'default'
    try {
      const chosen = host.resolve(body.profile, effort)
      if (fitBudget(body.contextTokens, chosen.contextWindow) !== body.contextTokens) {
        return c.json({ message: 'The reading budget exceeds this model’s limit.' }, 400)
      }
    } catch (error) {
      return c.json({ message: (error as Error).message }, 400)
    }
    if (accepting.has(id) || threads.get(id)?.busy)
      return c.json({ message: 'a turn is already running on this thread' }, 409)
    accepting.add(id)
    const release = hold('chat voice transcript')
    let thread: Thread | undefined
    let reserved = false
    try {
      await restored
      await opening.get(id)
      if (!threads.has(id) && body.after !== 0) {
        return c.json(
          { message: 'This chat could not be restored. Keep this page open to preserve its voice transcript.' },
          409,
        )
      }
      const conversation = voiceConversation(body.turns)
      if (conversation.length === 0) return c.json({ appended: 0 })
      if (!threads.has(id))
        pending.set(id, { profile: body.profile, effort, contextTokens: body.contextTokens, saves: body.saves })
      thread = await open(id)
      if (thread.busy) return c.json({ message: 'a turn is already running on this thread' }, 409)
      thread.busy = true
      try {
        reserved = true
        await thread.session.appendConversation(body.after as number, conversation)
      } catch (error) {
        return c.json({ message: (error as Error).message }, 409)
      }
      thread.state = 'done'
      thread.updatedAt = ++tick
      name(id, thread)
      return c.json({ appended: conversation.length })
    } finally {
      if (thread && reserved) thread.busy = false
      accepting.delete(id)
      release()
    }
  })

  // The day's view of its threads: newest activity first.
  app.get('/', async (c) => {
    await restored
    const list = [...threads.entries()]
      .filter(([, thread]) => thread.parent?.kind !== 'thread')
      .sort(([, a], [, b]) => b.updatedAt - a.updatedAt)
      .map(([id, thread]) => summarize(id, thread, baseDir))
    return c.json({ threads: list })
  })

  if (options.legalReviews)
    registerLegalReviewRoutes(app, options.legalReviews, async (id) => {
      await restored
      const thread = threads.get(id)
      return thread ? { reviewId: thread.session.legalReviewId } : null
    })

  if (options.writingDrafts) registerWritingDraftRoutes(app, options.writingDrafts, replyHost)

  app.get('/:id', async (c) => {
    await restored
    const id = c.req.param('id')
    const thread = threads.get(id)
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    return c.json({
      id,
      title: titleOf(thread),
      parent: thread.parent,
      inherited: thread.session.inherited,
      saved: savedOf(thread, baseDir),
      branches: await savedBranchesOf(savedOf(thread, baseDir), baseDir),
      turns: thread.session.turns,
      branchPoints: branchPoints(thread.session.turns),
      interrupted: thread.interrupted,
      documents: thread.session.paths.length,
      kept: keptOf(thread),
      busy: thread.busy,
      pending: [...thread.pending.values()].map(({ id: approvalId, toolName, lines, sessionKey }) => ({
        id: approvalId,
        toolName,
        lines,
        sessionKey,
      })),
      answered: thread.answered,
      runs: thread.runs,
      queries: [
        ...thread.session.contextLog
          .filter((entry) => entry.turn !== thread.liveQueries?.turn)
          .map((entry) => ({ turn: entry.turn, queries: entry.stats?.budget === 0 ? [] : entry.queries })),
        ...(thread.liveQueries ? [thread.liveQueries] : []),
      ],
      usage: [...thread.usage].map(([at, usage]) => ({ at, ...usage })),
      timings: [...thread.timings].map(([at, text]) => ({ at, text })),
    })
  })

  // The person's answer to a held tool call. The turn resumes with it: an
  // approved call runs, a declined one is reported to the model as such.
  app.post('/:id/approvals/:approvalId', async (c) => {
    const thread = threads.get(c.req.param('id'))
    if (!thread) return c.json({ message: 'no such thread' }, 404)
    const approval = thread.pending.get(c.req.param('approvalId'))
    if (!approval) return c.json({ message: 'no such approval — it may have been answered already' }, 404)
    const body = (await c.req.json().catch(() => null)) as { approved?: unknown; always?: unknown } | null
    if (typeof body?.approved !== 'boolean') return c.json({ message: 'expected { approved: true | false }' }, 400)
    // "Allow for this file": a go that stands for the session, when the card offered one.
    const always = body.approved && body.always === true && approval.sessionKey !== undefined

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
        ? { approved: true, reason: 'User approved', always }
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

  // A saved chat opened to continue: a thread whose session writes back to
  // the file. One thread per file — opening it again finds the same one.
  app.post('/open', async (c) => {
    await restored
    if (!options.openSaved) return c.json({ message: 'this host does not open saved chats' }, 404)
    const body = (await c.req.json().catch(() => null)) as { chat?: unknown } | null
    const chat = typeof body?.chat === 'string' ? body.chat.trim() : ''
    if (!chat) return c.json({ message: 'chat is required — a path relative to the notebook root' }, 400)
    for (const [id, thread] of threads) if (savedOf(thread, baseDir) === chat) return c.json({ id, opened: false })
    const found = await options.openSaved(chat)
    if (!found) return c.json({ message: `no saved chat at ${chat}` }, 404)
    const id = crypto.randomUUID()
    await open(id, {
      id,
      startTime: found.startTime,
      state: found.resume.state,
      resume: found.resume,
      parent: found.resume.parent,
      parentId: null,
      approvals: found.resume.approvals,
      attachments: found.resume.attachments,
      prefs: {
        profile:
          typeof found.resume.recovery?.host?.profile === 'string' ? found.resume.recovery.host.profile : undefined,
        effort: isEffortOverride(found.resume.recovery?.host?.effort) ? found.resume.recovery.host.effort : 'default',
        contextTokens: found.resume.recovery?.contextTokens,
      },
    })
    return c.json({ id, opened: true }, 201)
  })

  // A new chat from here: a branch that keeps the thread's first `turn`
  // turns and goes its own way after them. Nothing is written — the branch
  // is a thread like any other until it is ended. What branching does pin
  // is the family's name on the thread it left, so the folder the branch
  // will file into is known: the parent keeps that name when it saves.
  app.post('/:id/branch', async (c) => {
    await restored
    const id = c.req.param('id')
    const source = threads.get(id)
    if (!source) {
      return c.json(
        { message: 'Sky could not recover this chat. Keep this page open to preserve the messages shown here.' },
        409,
      )
    }
    if (source.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
    if (source.session.parent?.kind === 'thread')
      return c.json({ message: 'Continue in this thread. Threads cannot contain more conversations.' }, 409)
    const body = (await c.req.json().catch(() => null)) as { turn?: unknown; key?: unknown } | null
    const turn = body?.turn
    if (!(typeof turn === 'number' && Number.isInteger(turn) && turn >= 1)) {
      return c.json({ message: 'turn must be a positive whole number' }, 400)
    }
    // Existing tabs send only { turn }. Keep that protocol working; newer
    // pages also identify the reply so a changed history can be detected.
    const point = branchPoints(source.session.turns)[turn * 2 - 1]
    if (!point || (body?.key !== undefined && point.key !== body.key)) {
      return c.json(
        {
          message:
            'This reply no longer matches the chat held by Sky. Keep this page open to preserve the messages shown here.',
        },
        409,
      )
    }
    // The family's name: what the thread is called, else the titler over the
    // shared turns — given a few seconds, no more, since the person is waiting
    // on the click; past that the first words stand and the titler's later
    // answer names the thread on the page only.
    let title = source.title ?? source.session.title
    if (!title && options.title) {
      const named = options.title(source.session.turns.slice(0, turn * 2)).catch(() => undefined)
      const patience = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), NAMING_PATIENCE_MS))
      title = (await Promise.race([named, patience]))?.trim() || null
    }
    title ??= threadTitle(source.session.turns)
    if (!title) return c.json({ message: 'the thread has nothing to be named by yet' }, 409)
    source.title ??= title
    source.session.pinTitle(title)
    const parentPath = source.session.filePath(title)
    if (!parentPath) return c.json({ message: 'the thread has no file to branch beside' }, 409)
    const parent: ChatParent = { chat: path.relative(baseDir, parentPath), turn }
    const branchId = crypto.randomUUID()
    const state = source.session.stateAt(turn)
    if (options.writingDrafts && state.writingDrafts) {
      const store = options.writingDrafts
      state.writingDrafts = await Promise.all(
        state.writingDrafts.map(async (ref) => {
          const draft = await store.fork(ref.id, `chat:${branchId}`)
          if (state.writingDraftFocus === ref.id) state.writingDraftFocus = draft.id
          return { ...ref, id: draft.id }
        }),
      )
    }
    const branch = await open(branchId, {
      id: branchId,
      state,
      parent,
      parentId: id,
      prefs: {
        profile: source.profile,
        effort: source.effort,
        contextTokens: source.session.contextTokens,
        saves: source.saves,
      },
    })
    await branch.session.snapshot()
    source.updatedAt = ++tick
    return c.json({ id: branchId, parent }, 201)
  })

  app.get('/:id/settings', async (c) => {
    await restored
    const settings = settingsOf(c.req.param('id'))
    return settings ? c.json(settings) : c.json({ message: 'this host has no settings' }, 404)
  })

  // Tune a thread: the model it thinks with, the reading budget, whether it
  // is kept. A live thread changes between turns — a new budget reassembles
  // its context at once. Filing preferences never disable restart recovery;
  // a thread not yet built keeps the choice for when it is. A budget of
  // zero keeps the notebook closed: nothing read, nothing queried, until a
  // budget opens it again.
  app.post('/:id/settings', async (c) => {
    const id = c.req.param('id')
    const host = options.settings
    if (!host) return c.json({ message: 'this host has no settings' }, 404)
    const body = (await c.req.json().catch(() => null)) as {
      profile?: unknown
      effort?: unknown
      contextTokens?: unknown
      saves?: unknown
    } | null
    await restored
    if (accepting.has(id)) return c.json({ message: 'a turn is still running on this thread' }, 409)
    const profile = body?.profile
    const tokens = body?.contextTokens
    const saves = body?.saves
    const effort = body?.effort
    if (profile === undefined && tokens === undefined && saves === undefined && effort === undefined) {
      return c.json({ message: 'expected { profile?, effort?, contextTokens?, saves? }' }, 400)
    }
    if (profile !== undefined && typeof profile !== 'string') return c.json({ message: 'profile must be a name' }, 400)
    if (tokens !== undefined && !(typeof tokens === 'number' && Number.isInteger(tokens) && tokens >= 0)) {
      return c.json({ message: 'contextTokens must be a whole number, zero or more' }, 400)
    }
    if (saves !== undefined && typeof saves !== 'boolean')
      return c.json({ message: 'saves must be true or false' }, 400)
    if (effort !== undefined && !isEffortOverride(effort))
      return c.json({ message: 'Choose a supported effort level or default.' }, 400)
    const thread = threads.get(id)
    const held = pending.get(id)
    const ridingWith = typeof profile === 'string' ? profile : (thread?.profile ?? held?.profile ?? host.defaultModel)
    const nextEffort = isEffortOverride(effort)
      ? effort
      : typeof profile === 'string'
        ? 'default'
        : (thread?.effort ?? held?.effort ?? 'default')
    let chosen: ReturnType<ChatSettingsHost['resolve']> | undefined
    if (typeof profile === 'string' || effort !== undefined) {
      try {
        chosen = host.resolve(ridingWith, nextEffort)
      } catch (err) {
        return c.json({ message: (err as Error).message }, 400)
      }
    }

    // The budget is fitted to the model it will ride with: the one chosen
    // now, else the thread's. A model with a smaller window lowers a budget
    // that no longer fits, whether or not this change names one.
    const window = chosen ? chosen.contextWindow : windowOf(host, ridingWith)
    const standing = thread?.session.contextTokens ?? held?.contextTokens ?? host.defaultContextTokens
    const budget = fitBudget(typeof tokens === 'number' ? tokens : standing, window)
    const budgetChanges = typeof tokens === 'number' || budget !== standing
    if (thread) {
      if (thread.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
      if (chosen) {
        thread.session.setModel(chosen.model, chosen.profile)
        thread.profile = ridingWith
        thread.effort = nextEffort
      }
      if (budgetChanges) thread.session.setContextTokens(budget)
      if (typeof saves === 'boolean') {
        thread.saves = saves
      }
      await snapshotThread(thread)
      thread.updatedAt = ++tick
    } else {
      const prefs = held ?? {}
      if (chosen) {
        prefs.profile = ridingWith
        prefs.effort = nextEffort
      }
      if (budgetChanges) prefs.contextTokens = budget
      if (typeof saves === 'boolean') prefs.saves = saves
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
    await restored
    const id = c.req.param('id')
    const body = (await c.req.json().catch(() => null)) as { save?: unknown } | null
    const thread = threads.get(id)
    if (!thread) {
      if (opening.has(id)) return c.json({ message: 'a turn is still running on this thread' }, 409)
      // Never started: the id holds only the tuning chosen for it. Ending lets that go.
      if (!pending.delete(id)) return c.json({ message: 'no such thread' }, 404)
      return c.json({ saved: null, ended: [id] })
    }
    if (thread.busy) return c.json({ message: 'a turn is still running on this thread' }, 409)
    if (openingReply(id)) return c.json({ message: 'A reply thread is opening. Try saving in a moment.' }, 409)
    // The thread's own setting decides; a caller may still say so outright.
    const save = typeof body?.save === 'boolean' ? body.save : thread.saves

    const ownerPath = thread.session.filePath(thread.title ?? undefined)
    const children = [...threads.entries()].filter(
      ([, child]) =>
        child.parent?.kind === 'thread' &&
        (child.parent.id === id || (ownerPath && child.parent.chat === path.relative(baseDir, ownerPath))),
    )
    if (children.some(([, child]) => child.busy))
      return c.json(
        {
          message:
            'A reply thread is still working. Close its panel to keep chatting, or wait before saving this conversation.',
        },
        409,
      )

    // File the full lineage before its descendants. Reserve every participant
    // before awaiting a write so another tab cannot start a turn mid-save.
    const ancestors: Thread[] = []
    const seen = new Set([thread])
    let above = thread.parent?.id ? threads.get(thread.parent.id) : undefined
    while (save && above && !seen.has(above)) {
      if (above.busy) return c.json({ message: 'an earlier chat in this conversation is still working' }, 409)
      seen.add(above)
      ancestors.unshift(above)
      above = above.parent?.id ? threads.get(above.parent.id) : undefined
    }

    // The thread stays until the end succeeds, so a failed save can be retried.
    const participants = [thread, ...children.map(([, child]) => child), ...ancestors]
    const priorStates = new Map(participants.map((participant) => [participant, participant.state]))
    for (const participant of participants) {
      participant.busy = true
      participant.state = 'saving'
    }
    const release = hold('chat save')
    try {
      for (const ancestor of ancestors) {
        const filed = await ancestor.session.fileNow()
        if (filed?.aborted) return c.json({ saved: filed })
        ancestor.updatedAt = ++tick
      }
      const checkpoint = save && children.length ? await thread.session.fileNow(options.endDefaults) : null
      if (checkpoint?.aborted) return c.json({ saved: checkpoint })
      for (const [childId, child] of children) {
        const childSaved = await child.session.end({ ...options.endDefaults, save, logToDay: null })
        if (childSaved?.aborted) return c.json({ saved: childSaved })
        threads.delete(childId)
      }
      const saved = (await thread.session.end({ ...options.endDefaults, save })) ?? checkpoint
      threads.delete(id)
      return c.json({ saved, ended: [...children.map(([childId]) => childId), id] })
    } finally {
      release()
      for (const participant of participants) {
        participant.busy = false
        participant.state = priorStates.get(participant) ?? 'done'
      }
    }
  })

  return app
}
