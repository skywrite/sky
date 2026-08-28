/**
 * A chat session: everything a conversation is, apart from the surface it
 * runs on.
 *
 * ChatContext decides what the model sees, ChatEngine runs the model, and
 * ChatStore keeps the transcript. This class composes the three into the
 * turn cycle every host would otherwise re-author — gather context, run
 * the turn, record the tools, snapshot the session — behind start / send /
 * end, and emits one event stream while it works. A terminal renders that
 * stream as lines and an SSE endpoint forwards it; neither decides any of
 * the above, which is what keeps two hosts from drifting.
 *
 * What a host injects is exactly what differs between hosts: how a
 * question becomes documents (the query producers), which tools exist,
 * how a tool gets approved, and the rendered system prompt.
 */

import { type AIErrorEntry, logAIError } from '#shared/ai/errorLog.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import type { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { type ExternalFileRef, recordExternalFiles } from '../artifactRel.ts'
import ChatContext, {
  type ChatContextOptions,
  type ContextProducers,
  type ContextProgressEvent,
  type RebuildReport,
  type RestoreReport,
  type SeedReport,
  type TurnContextReport,
} from '../ChatContext/mod.ts'
import ChatEngine, {
  type ApprovalHandler,
  type ChatEngineEvent,
  type ModelInvoker,
  TurnError,
} from '../ChatEngine/mod.ts'
import { clearChatAutosave, writeChatAutosave } from '../ChatStore/autosave.ts'
import type { ResumeSession } from '../ChatStore/mod.ts'
import { type SaveChatReport, type SaveEnricher, type SaveProgress, saveChat } from '../ChatStore/save.ts'
import type { ConversationMessage } from '../type.d.ts'
import { type AmbientContext, buildContextPrompt } from './contextPrompt.ts'

// -----------------------------------------------------------------------------
// Events — the one stream a host renders
// -----------------------------------------------------------------------------

/**
 * Everything a host renders while a session works, in the order it
 * happens. The engine's and context's own events pass through unchanged;
 * the rest mark the points in a turn a host prints something at.
 */
export type ChatSessionEvent =
  | ChatEngineEvent
  | ContextProgressEvent
  | SaveProgress
  | { type: 'context-gathering' }
  | { type: 'context-rebuilt'; report: RebuildReport }
  | { type: 'context-errors'; errors: string[] }
  /** Once per session, the first time the tool set is built. */
  | { type: 'tools'; names: string[] }
  /** Context settled, tools built — the model is about to run. */
  | { type: 'model-start' }
  | { type: 'autosave-failed'; message: string }

// -----------------------------------------------------------------------------
// Options & reports
// -----------------------------------------------------------------------------

export interface ToolHooks {
  /** A tool reported touching external files — the session records them for the transcript's rel. */
  onExternalFiles: (files: ExternalFileRef[]) => void
}

/** Builds the turn's tool set. Called every turn; hosts cache discovery themselves. */
export type ToolFactory = (
  hooks: ToolHooks,
) => Promise<{ tools: Record<string, unknown>; toolApproval: Record<string, 'user-approval'> }>

export interface ChatSessionOptions {
  today: PlainDate
  /** Session start: names the file and keys the day-file entry at save time */
  startTime: PlainDateTime
  /** Days of history the baseline sweeps */
  days: number
  /** Absolute notebook root */
  baseDir: string
  /** Notebook time root — a new chat files under its day directory */
  timeDir: string
  contextTokens?: number
  summaryBaseline?: boolean
  /** The transcript being continued, or null for a new chat */
  resume: ResumeSession | null
  /** Spread into every model invocation */
  model: ResolvedModel
  /** What the transcript records as provider and model */
  profile: { provider: string; model: string }
  producers: ContextProducers
  ambient: AmbientContext
  /** Rendered once per session, concurrently with the baseline gather */
  systemPrompt: () => Promise<string>
  tools: ToolFactory
  approvalHandler: ApprovalHandler
  /** Crash snapshot written after every turn; null for none */
  autosavePath: string | null
  onEvent?: (event: ChatSessionEvent) => void
  /** Test seams — production uses the real model, service, clock, and error log. */
  invokeModel?: ModelInvoker
  fetchContext?: ChatContextOptions['fetchContext']
  now?: () => Promise<PlainDateTime>
  logError?: (entry: AIErrorEntry) => Promise<void>
}

/** Exactly one of the two is set: a restored context log, or a fresh baseline. */
export interface StartReport {
  restored?: RestoreReport
  seeded?: SeedReport
}

export interface TurnReport {
  context: TurnContextReport
  /** The reply; absent when the turn failed */
  text?: string
  /** Deduplicated web-search sources, already appended to the saved turn */
  sourceUrls: string[]
  approvalRoundsExhausted: boolean
  /** The turn died — already logged; the conversation continues without a reply */
  error?: string
}

export interface EndOptions {
  /** False leaves nothing behind: no transcript, no crash snapshot */
  save: boolean
  autoTag?: boolean
  autoRel?: boolean
  memoryDir?: string | null
  people?: boolean
  logToDay?: { category: string } | null
  /** Test seam — see SaveEnricher */
  enricher?: SaveEnricher
}

const MAX_ERROR_CHARS = 2000

function withSources(text: string, urls: string[]): string {
  if (urls.length === 0) return text
  return `${text}\n\nSources:\n${urls.map((u) => `- ${u}`).join('\n')}`
}

// -----------------------------------------------------------------------------
// ChatSession
// -----------------------------------------------------------------------------

export default class ChatSession {
  /** The conversation so far, oldest first — the host's view of the transcript. */
  readonly turns: ConversationMessage[] = []

  private readonly opts: ChatSessionOptions
  private readonly context: ChatContext
  private readonly engine: ChatEngine
  private readonly now: () => Promise<PlainDateTime>
  private readonly logError: (entry: AIErrorEntry) => Promise<void>
  // External files the session's tools touched (title by URL) — saved as
  // "[Title](url)" rel entries so the transcript points at its artifacts.
  private readonly externalFiles = new Map<string, string>()
  private systemPrompt = ''
  private contextPrompt = ''
  private firstTurnPending = true
  private toolsAnnounced = false
  private newMessages = false

  constructor(opts: ChatSessionOptions) {
    this.opts = opts
    this.now = opts.now ?? (async () => (await fetchNow()).plainDateTime)
    this.logError = opts.logError ?? logAIError
    this.context = new ChatContext({
      today: opts.today,
      days: opts.days,
      baseDir: opts.baseDir,
      maxTokens: opts.contextTokens,
      summaryBaseline: opts.summaryBaseline,
      ownChatPath: opts.resume?.filePath ?? null,
      producers: opts.producers,
      onProgress: (event) => this.emit(event),
      fetchContext: opts.fetchContext,
      logError: opts.logError,
    })
    this.engine = new ChatEngine({
      model: opts.model,
      approvalHandler: opts.approvalHandler,
      onEvent: (event) => this.emit(event),
      invokeModel: opts.invokeModel,
    })
  }

  /** Absolute paths of the documents in the context universe. */
  get paths(): string[] {
    return this.context.paths
  }

  get resume(): ResumeSession | null {
    return this.opts.resume
  }

  /** True once a message was sent this session — a resumed chat with none leaves its file untouched. */
  get hasNewMessages(): boolean {
    return this.newMessages
  }

  /**
   * Seed the session: a resumed conversation reseeds the history, and a
   * transcript with a context log restores its recorded universe exactly
   * (new documents enter only through the evolve path afterward). Anything
   * else — a new chat, or a pre-log transcript — gathers a fresh baseline.
   * The system prompt renders concurrently; both are service round-trips.
   */
  async start(): Promise<StartReport> {
    const { resume } = this.opts
    if (resume) {
      this.turns.push(...resume.state.conversation)
      this.engine.seedConversation(resume.state.conversation)
    }

    const prompt = this.opts.systemPrompt()
    if (resume && resume.state.contextLog.length > 0) {
      const [restored, rendered] = await Promise.all([this.context.restore(resume.state), prompt])
      this.systemPrompt = rendered
      this.firstTurnPending = false
      this.contextPrompt = buildContextPrompt(this.opts.ambient, restored.rebuild.activityMarkdown)
      return { restored }
    }

    const [seeded, rendered] = await Promise.all([this.context.seedBaseline(), prompt])
    this.systemPrompt = rendered
    return { seeded }
  }

  /** Drop the whole universe; the next message evolves from nothing rather than gathering afresh. */
  clearContext(): void {
    this.firstTurnPending = false
    this.context.clear()
  }

  /**
   * One conversation turn: settle the context for the message, run the
   * model over it, record what the turn did, and snapshot the session.
   * A failed model turn is reported, never thrown — the conversation goes
   * on, and any tool that already ran stays in the record.
   */
  async send(userMessage: string): Promise<TurnReport> {
    // Stamped at submit time — the gather below can take a while, and the
    // stamp should say when the message was sent, not when the model ran.
    const turnWhen = await this.stamp()

    let context: TurnContextReport
    if (this.firstTurnPending) {
      this.firstTurnPending = false
      this.emit({ type: 'context-gathering' })
      context = await this.context.firstTurn(userMessage)
    } else {
      context = await this.context.evolveTurn(userMessage, this.turns.slice(-6))
    }
    if (context.rebuilt) {
      this.contextPrompt = buildContextPrompt(this.opts.ambient, context.rebuilt.activityMarkdown)
      this.emit({ type: 'context-rebuilt', report: context.rebuilt })
    }
    if (context.errors.length > 0) this.emit({ type: 'context-errors', errors: context.errors })

    // The user's actual message, never the context. A resumed transcript
    // can end mid-exchange on a user message; merge into it so roles keep
    // alternating.
    this.newMessages = true
    const prior = this.turns.at(-1)
    if (prior?.role === 'user') {
      prior.content += '\n\n' + userMessage
    } else {
      const turn: ConversationMessage = { role: 'user', content: userMessage }
      if (turnWhen) turn.when = turnWhen
      this.turns.push(turn)
    }
    this.engine.appendUserMessage(userMessage, turnWhen)

    const report: TurnReport = { context, sourceUrls: [], approvalRoundsExhausted: false }
    try {
      const { tools, toolApproval } = await this.opts.tools({
        onExternalFiles: (files) => recordExternalFiles(this.externalFiles, files),
      })
      if (!this.toolsAnnounced) {
        this.toolsAnnounced = true
        this.emit({ type: 'tools', names: Object.keys(tools) })
      }
      this.emit({ type: 'model-start' })

      const result = await this.engine.runTurn({
        instructions: [this.systemPrompt, this.contextPrompt],
        tools,
        toolApproval,
      })
      // Attach tool records to this turn's log entry — creating one when
      // the turn changed no context and so recorded nothing else.
      this.context.recordTurnTools(result.toolRecords)

      const sourceUrls = [...new Set(result.sourceUrls)]
      const assistant: ConversationMessage = { role: 'assistant', content: withSources(result.text, sourceUrls) }
      const when = await this.stamp()
      if (when) assistant.when = when
      this.turns.push(assistant)

      report.text = result.text
      report.sourceUrls = sourceUrls
      report.approvalRoundsExhausted = result.approvalRoundsExhausted
    } catch (err) {
      // A failed turn keeps its tool trail — an executed side-effectful
      // call (a sent post, a created doc) must not vanish from the
      // transcript because the turn later died.
      if (err instanceof TurnError && err.toolRecords.length > 0) this.context.recordTurnTools(err.toolRecords)
      // TurnError arrives pre-clamped; foreign errors get the same cap —
      // a validation failure embeds the whole message array in .message.
      const message = truncate((err as Error).message ?? String(err), MAX_ERROR_CHARS)
      report.error = message
      await this.logError({ source: 'ai:chat', stage: 'turn', message, question: userMessage })
    }

    await this.snapshot()
    return report
  }

  /**
   * Finish the session. A wanted save files the transcript through the
   * store's gate and returns its report; otherwise nothing is written. In
   * both cases the crash snapshot goes — the transcript is either durably
   * on disk (saved, or parked as a recovery copy) or deliberately dropped.
   */
  async end(opts: EndOptions): Promise<SaveChatReport | null> {
    const { resume } = this.opts
    // A resumed session with no new messages leaves its file untouched.
    const wanted = opts.save && this.turns.length > 0 && (!resume || this.newMessages)
    if (!wanted) {
      await this.clearSnapshot()
      return null
    }

    const saved = await saveChat({
      turns: this.turns,
      contextLog: this.context.log,
      resume,
      timeDir: this.opts.timeDir,
      day: this.opts.today,
      startTime: this.opts.startTime,
      endTime: await this.now(),
      provider: this.opts.profile.provider,
      model: this.opts.profile.model,
      externalFiles: this.externalFiles,
      autoTag: opts.autoTag,
      autoRel: opts.autoRel,
      memoryDir: opts.memoryDir,
      people: opts.people,
      logToDay: opts.logToDay,
      onProgress: (event) => this.emit(event),
      enricher: opts.enricher,
    })
    await this.clearSnapshot()
    return saved
  }

  /**
   * Crash insurance: the session as it now stands, every turn — ephemeral
   * sessions included, since -E decides what a clean exit keeps, not what
   * a crash may lose. Must never break the conversation: failures are
   * reported and logged, then the turn is over.
   */
  private async snapshot(): Promise<void> {
    if (!this.opts.autosavePath || this.turns.length === 0) return
    try {
      await writeChatAutosave(this.opts.autosavePath, {
        turns: this.turns,
        contextLog: this.context.log,
        resume: this.opts.resume,
        startTime: this.opts.startTime,
        provider: this.opts.profile.provider,
        model: this.opts.profile.model,
        externalFiles: this.externalFiles,
      })
    } catch (err) {
      const message = (err as Error).message
      this.emit({ type: 'autosave-failed', message })
      await this.logError({ source: 'ai:chat', stage: 'autosave', message })
    }
  }

  private async clearSnapshot(): Promise<void> {
    if (this.opts.autosavePath) await clearChatAutosave(this.opts.autosavePath)
  }

  /** Notebook datetime for a turn stamp; undefined when now can't be computed — the turn proceeds unstamped. */
  private async stamp(): Promise<string | undefined> {
    try {
      return (await this.now()).toString()
    } catch {
      return undefined
    }
  }

  private emit(event: ChatSessionEvent): void {
    this.opts.onEvent?.(event)
  }
}
