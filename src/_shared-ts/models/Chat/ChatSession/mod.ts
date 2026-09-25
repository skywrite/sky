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

import * as path from 'node:path'
import type { UserContent } from 'ai'
import { type AIErrorEntry, logAIError } from '#shared/ai/errorLog.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import type { TokenUsage } from '#shared/ai/usage.ts'
import type { ContextTurnLog, PreflightVerdict, TurnSettings } from '#shared/models/Chat/document/ContextLog/mod.ts'
import type { ResumeState } from '#shared/models/Chat/document/resume.ts'
import type { ResearchContext } from '#shared/models/Chat/researchContext.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { currentTimingSpan, thrownOutcome, TimingSpan } from '#shared/timing/mod.ts'
import { timingDetail, type TimingDetail } from '#shared/timing/summary.ts'
import { type ChatImage, withChatImages } from '#universal/ai/chatImages.ts'
import type { ContextAdjustment } from '#universal/ai/contextAdjustment.ts'
import type { Effort } from '#universal/ai/effort.ts'
import { withSources } from '#universal/ai/sources.ts'
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
import type { Preflight } from '../ChatContext/preflight.ts'
import ChatEngine, {
  type ApprovalHandler,
  type ChatEngineEvent,
  type ModelInvoker,
  type ToolApprovalConfig,
  TurnError,
  type TurnCut,
} from '../ChatEngine/mod.ts'
import { clearChatAutosave, writeChatAutosave } from '../ChatStore/autosave.ts'
import { loadResumeSession, type ResumeSession } from '../ChatStore/mod.ts'
import { chatFilePath, type SaveChatReport, type SaveEnricher, type SaveProgress, saveChat } from '../ChatStore/save.ts'
import { conversationKey, hasCompleteModelHistory, modelHistoryThrough } from '../document/history.ts'
import { inheritedMessages, prefixOf } from '../document/lineage.ts'
import type { ChatParent } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import { type AmbientContext, buildContextPrompt } from './contextPrompt.ts'

/**
 * The activity block of a closed notebook, said outright: an empty block
 * reads to the model as a notebook with nothing in it.
 */
const CLOSED_ACTIVITY =
  '(Not read. The notebook is closed for this thread: the person set the reading budget to nothing. Answer from the conversation and your tools, and never describe the notebook as empty or missing.)'

/**
 * The activity block of a turn the preflight skipped before anything was
 * assembled: the notebook is open, it just was not read for this message.
 */
const SKIPPED_ACTIVITY =
  '(Not read for this message: a quick check judged it needs nothing from the notebook. The notebook is open, and a later message can read it. Answer from the conversation and your tools, never describe the notebook as empty or missing, and say so if the answer would need the notebook after all.)'

export interface ChatMessageFiles {
  content: Exclude<UserContent, string>
  attachments: Attachment[]
}

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
  /** The preflight judged the message needs nothing from the notebook; nothing new is read this turn. */
  | { type: 'context-skipped'; preflight: PreflightVerdict }
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
  /** Standing instructions and the current reading budget, without the retrieved document context. */
  researchContext?: ResearchContext
  /** The context actually supplied to this turn, with conversation roles preserved. */
  context: { instructions: string; conversation: readonly ConversationMessage[] }
  attachments: () => Attachment[]
  legalReview: { id: () => string | undefined; link: (id: string) => Promise<void> }
  writingDrafts?: {
    list: () => readonly { id: string; turn: number }[]
    focus: () => string | undefined
    /** `turn` places a draft at the reply it first appeared in; the current turn otherwise. */
    link: (id: string, turn?: number) => Promise<void>
  }
  /** A tool reported touching external files — the session records them for the transcript's rel. */
  onExternalFiles: (files: ExternalFileRef[]) => void
  /** A tool copied files into the day's attachments — the session records them for the transcript's attachments. */
  onAttachments: (files: Attachment[]) => void
  /** Renderable results are appended to the reply even when the model omits their links. */
  onImages: (images: ChatImage[]) => void
}

/** Builds the turn's tool set. Called every turn; hosts cache discovery themselves. */
export type ToolFactory = (
  hooks: ToolHooks,
) => Promise<{ tools: Record<string, unknown>; toolApproval: ToolApprovalConfig; instructions?: string }>

/** The model a host sets for the session — what each turn's `settings` record, less the budget the context owns. */
export type ModelProfile = Omit<TurnSettings, 'contextTokens'>

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
  /**
   * The host's preflight, run before each turn's reading: a quick judge of
   * whether the message needs the notebook. A skip verdict reads nothing
   * new; null means no preflight ran. A throw reads as usual and is logged.
   */
  preflight?: Preflight
  summaryBaseline?: boolean
  /** The transcript being continued, or null for a new chat */
  resume: ResumeSession | null
  /**
   * A conversation to pick up that has no file yet — a crash snapshot the
   * host read back, or the turns a branch inherits. The session seeds and
   * restores from it exactly as from a resume, but files as a new chat when
   * it ends. Ignored when `resume` is set.
   */
  restore?: ResumeState
  /** Attachment metadata carried by a recovery snapshot independently of the final saved file. */
  attachments?: Attachment[]
  /**
   * For a new branch: the chat it left and the turn it left after. The
   * inherited turns are `restore`; the file the session writes holds only
   * what follows, in the folder beside the parent. A resumed branch
   * carries its parent on the resume instead.
   */
  parent?: ChatParent | null
  /** Spread into every model invocation */
  model: ResolvedModel
  /** What the transcript records as provider and model */
  profile: ModelProfile
  producers: ContextProducers
  ambient: AmbientContext
  /** Rendered once per session, concurrently with the baseline gather */
  systemPrompt: () => Promise<string>
  tools: ToolFactory
  approvalHandler: ApprovalHandler
  /** The durable approval keys the host holds — snapshotted and saved with the transcript */
  approvals?: () => readonly string[]
  /** Crash snapshot written after every turn; null for none */
  autosavePath: string | null
  /** Record durable links before ending clears the recovery snapshot. */
  onSaved?: (report: SaveChatReport) => Promise<void>
  onEvent?: (event: ChatSessionEvent) => void
  /** Test seams — production uses the real model, service, clock, and error log. */
  invokeModel?: ModelInvoker
  fetchContext?: ChatContextOptions['fetchContext']
  now?: () => Promise<PlainDateTime>
  logError?: (entry: AIErrorEntry) => Promise<void>
}

/** One of the three is set: a restored context log, a fresh baseline, or a closed notebook that gathered nothing. */
export interface StartReport {
  restored?: RestoreReport
  seeded?: SeedReport
  /** The budget was zero, so no baseline was gathered; the first message under a budget gathers it then. */
  closed?: boolean
}

export interface TurnReport {
  adjustment?: ContextAdjustment
  stopped?: boolean
  timing?: TimingDetail
  context: TurnContextReport
  /** The reply; absent when the turn failed */
  text?: string
  /** Deduplicated web-search sources; the saved turn ends in one Sources list holding these and any the reply named itself */
  sourceUrls: string[]
  approvalRoundsExhausted: boolean
  /** Set when the engine ended the tool loop (step cap, or repeated calls) and a closing step wrote the reply's last paragraph. */
  cutShort?: TurnCut
  /** The turn's token counts, every model step summed; absent when the turn failed */
  usage?: TokenUsage
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
  // Files the session's tools copied into the day's attachments, by
  // filename — saved as the transcript's attachments: entries.
  private readonly attachments = new Map<string, Attachment>()
  private systemPrompt = ''
  private contextPrompt = ''
  /** What the transcript records — the model answering from now on, which a host may change between turns. */
  private profile: ModelProfile
  /** The file being written back to — the resume the host gave, or the file this session filed mid-life. */
  private resumeSession: ResumeSession | null
  /** A title pinned before the save: a branch names its family on the parent so the folder is known. */
  private pinnedTitle: string | null = null
  private firstTurnPending = true
  /** The baseline universe exists, gathered or restored — a closed start leaves it for the first open turn. */
  private seeded = false
  private toolsAnnounced = false
  private newMessages = false
  private started = false
  private snapshotWrite: Promise<void> = Promise.resolve()
  /** The host's settings and identity, recorded with every recovery snapshot. */
  snapshotHostState?: () => Record<string, unknown>

  private legalReview: ResumeState['legalReview']
  private writingDrafts: NonNullable<ResumeState['writingDrafts']> = []
  private writingDraftFocus?: string

  get writingDraftLinks(): readonly { id: string; turn: number }[] {
    return this.writingDrafts
  }

  get focusedWritingDraft(): string | undefined {
    return this.writingDraftFocus
  }

  async linkWritingDraft(id: string, turn = Math.ceil(this.turns.length / 2)): Promise<void> {
    if (!this.writingDrafts.some((ref) => ref.id === id)) this.writingDrafts.push({ id, turn })
    this.newMessages = true
    await this.snapshot()
  }

  async focusWritingDraft(id: string): Promise<void> {
    if (!this.writingDrafts.some((ref) => ref.id === id))
      throw new Error('This draft is not linked to the conversation.')
    this.writingDraftFocus = id
    this.newMessages = true
    await this.snapshot()
  }

  get legalReviewId(): string | undefined {
    return this.legalReview?.id
  }

  constructor(opts: ChatSessionOptions) {
    this.opts = opts
    this.profile = opts.profile
    this.resumeSession = opts.resume
    // The conversation is the host's to show from the first moment — a
    // thread read back from a snapshot, or a branch, has turns before its
    // next message.
    const seed = this.seed
    this.legalReview = seed?.legalReview
    this.writingDrafts = seed?.writingDrafts?.map((ref) => ({ ...ref })) ?? []
    this.writingDraftFocus = seed?.writingDraftFocus
    if (seed) this.turns.push(...seed.conversation)
    for (const file of opts.attachments ?? []) this.attachments.set(file.file, file)
    // A recovered continuation may contain replies not yet filed in its original transcript.
    if (opts.resume)
      this.newMessages =
        JSON.stringify(this.turns.slice(opts.resume.inherited)) !== JSON.stringify(opts.resume.own.conversation)
    this.now = opts.now ?? (async () => (await fetchNow()).plainDateTime)
    this.logError = opts.logError ?? logAIError
    this.context = new ChatContext({
      today: opts.today,
      days: opts.days,
      baseDir: opts.baseDir,
      maxTokens: opts.contextTokens,
      summaryBaseline: opts.summaryBaseline,
      ownChatPath: opts.resume?.filePath ?? null,
      // A branch's lineage is its own conversation already; a fresh branch's
      // parent may have no file yet, and its path keeps out of retrieval too.
      ancestors:
        opts.resume?.ancestors ?? (opts.parent ? [path.join(path.dirname(opts.timeDir), opts.parent.chat)] : []),
      producers: opts.producers,
      onProgress: (event) => this.emit(event),
      fetchContext: opts.fetchContext,
      logError: opts.logError,
    })
    this.engine = new ChatEngine({
      model: opts.model,
      approvalHandler: opts.approvalHandler,
      onEvent: (event) => {
        if (event.type === 'context-adjusted') this.context.recordTurnAdjustment(event.adjustment)
        this.emit(event)
      },
      invokeModel: opts.invokeModel,
    })
    if (seed) this.engine.seedConversation(seed.conversation, seed.modelMessages)
  }

  /** Absolute paths of the documents in the context universe. */
  get paths(): string[] {
    return this.context.paths
  }

  /** The per-turn context log so far — what the context did each turn, as the transcript will record it. */
  get contextLog(): ContextTurnLog[] {
    return this.started ? this.context.log : (this.seed?.contextLog ?? this.context.log)
  }

  /** How many documents the model actually saw last turn — what "in context" means to a host. Null before any turn. */
  get kept(): number | null {
    for (let i = this.context.log.length - 1; i >= 0; i--) {
      const stats = this.context.log[i].stats
      if (stats) return stats.kept
    }
    return null
  }

  /** The file this session writes back to, or null for a chat that has none yet. */
  get resume(): ResumeSession | null {
    return this.resumeSession
  }

  /** When the session started — the day it files under, and the key of its snapshot. */
  get startTime(): PlainDateTime {
    return this.opts.startTime
  }

  /** The chat this one branched from, or null for a chat that began on its own. */
  get parent(): ChatParent | null {
    return this.resumeSession?.parent ?? this.opts.parent ?? null
  }

  /** Messages at the head of `turns` that are the parent's — a branch shows them, its file leaves them out. */
  get inherited(): number {
    if (this.resumeSession) return this.resumeSession.inherited
    if (this.opts.parent)
      return Math.min(inheritedMessages(this.opts.parent.turn), this.opts.restore?.conversation.length ?? 0)
    return 0
  }

  /** The title pinned on this session, if a branch named its family. */
  get title(): string | null {
    return this.pinnedTitle
  }

  /**
   * Pin the title the session files under. A branch pins its family's name
   * on the parent so the parent's filename — the branch folder's name — is
   * known before either saves. Pinned once; the first name stands.
   */
  pinTitle(title: string): void {
    if (this.pinnedTitle === null && title.trim()) this.pinnedTitle = title.trim()
    const file = this.filePath()
    if (file) this.context.excludeConversation(file)
  }

  /**
   * Where this session's file is, or will be: the file it writes back to,
   * else the path a save would choose now — which needs a title, pinned or
   * given, since the slug is the title. Null when there is nothing to name
   * it by yet.
   */
  filePath(title?: string): string | null {
    if (this.resumeSession) return this.resumeSession.filePath
    const summary = this.pinnedTitle ?? title?.trim()
    if (!summary) return null
    return chatFilePath({
      timeDir: this.opts.timeDir,
      day: this.opts.today,
      startTime: this.opts.startTime,
      summary,
      parent: this.opts.parent ?? null,
    })
  }

  /**
   * The thread as it stands through `turn`, as a branch would inherit it —
   * or the whole thread when no turn is given. Pure derivation over what
   * the session holds; nothing is read or written.
   */
  stateAt(turn?: number, includeTools = false): ResumeState {
    const whole: ResumeState = {
      conversation: [...this.turns],
      universePaths: [],
      queries: [],
      lastTurn: 0,
      contextLog: [...this.contextLog],
      ...(this.legalReview ? { legalReview: this.legalReview } : {}),
      ...(this.writingDrafts.length ? { writingDrafts: this.writingDrafts } : {}),
      ...(this.writingDraftFocus ? { writingDraftFocus: this.writingDraftFocus } : {}),
    }
    const through = turn ?? Math.floor(this.turns.length / 2)
    const state = prefixOf(whole, through)
    if (includeTools) {
      const history = modelHistoryThrough(this.engine.snapshotMessages(), through)
      if (hasCompleteModelHistory(history, state.conversation)) state.modelMessages = history
    }
    return state
  }

  /** A reply thread inherits the completed review, file clips, and existing file-scoped approvals. */
  threadSeedAt(turn: number) {
    return {
      state: this.stateAt(turn, true),
      attachments: [...this.attachments.values()],
      approvals: [...(this.opts.approvals?.() ?? this.resumeSession?.approvals ?? [])],
    }
  }

  /** The state a session picks up from, whether it writes back to a file or not; null for a fresh chat. */
  private get seed(): ResumeState | null {
    return this.opts.resume?.state ?? this.opts.restore ?? null
  }

  /** True once a message was sent this session — a resumed chat with none leaves its file untouched. */
  get hasNewMessages(): boolean {
    return this.newMessages
  }

  /** Import speech already delivered to the user without rerunning it through the text model. */
  async appendConversation(after: number, conversation: ConversationMessage[]): Promise<void> {
    const existing = this.turns.slice(after)
    const same =
      existing.length === conversation.length &&
      existing.every(
        (turn, i) => turn.role === conversation[i].role && turn.content.trim() === conversation[i].content.trim(),
      )
    if (same) return
    if (after !== this.turns.length || after % 2 !== 0) {
      throw new Error(
        'This chat changed while voice was running. Keep this page open to preserve the voice transcript.',
      )
    }
    const when = await this.stamp()
    const turns = conversation.map((turn) => ({ ...turn, ...(when ? { when } : {}) }))
    this.turns.push(...turns)
    this.engine.seedConversation(turns)
    this.newMessages = true
    await this.snapshot()
  }

  /**
   * Seed the session: a resumed or restored conversation reseeds the model's
   * history (the turns themselves were seeded at construction), and a
   * transcript with a context log restores its recorded universe exactly
   * (new documents enter only through the evolve path afterward). Anything
   * else — a new chat, or a pre-log transcript — gathers a fresh baseline.
   * The system prompt renders concurrently; both are service round-trips.
   */
  async start(): Promise<StartReport> {
    const seed = this.seed

    const prompt = this.opts.systemPrompt()
    if (seed && seed.contextLog.length > 0) {
      const [restored, rendered] = await Promise.all([this.context.restore(seed), prompt])
      this.systemPrompt = rendered
      this.firstTurnPending = false
      this.seeded = true
      this.started = true
      this.contextPrompt = buildContextPrompt(this.opts.ambient, restored.rebuild.activityMarkdown)
      return { restored }
    }

    if (this.context.budget === 0) {
      // A closed notebook: nothing to gather. The prompt still says so, or
      // the model would read an empty activity block as an empty life.
      this.systemPrompt = await prompt
      this.contextPrompt = buildContextPrompt(this.opts.ambient, CLOSED_ACTIVITY)
      this.started = true
      return { closed: true }
    }

    const [seeded, rendered] = await Promise.all([this.context.seedBaseline(), prompt])
    this.systemPrompt = rendered
    this.seeded = true
    this.started = true
    return { seeded }
  }

  /** Drop the whole universe; the next message evolves from nothing rather than gathering afresh. */
  clearContext(): void {
    this.firstTurnPending = false
    this.context.clear()
  }

  /** The provider and model answering from now on. */
  get modelProfile(): ModelProfile {
    return this.profile
  }

  /**
   * Think with another model from the next turn on. The frontmatter records
   * one model — the one set when the transcript is saved; each turn's log
   * entry records the one it ran on.
   */
  setModel(model: ResolvedModel, profile: ModelProfile): void {
    this.engine.setModel(model)
    this.profile = profile
  }

  /** The token budget the document context is assembled within. */
  get contextTokens(): number {
    return this.context.budget
  }

  /**
   * Change the budget. Once a turn has built the context it is reassembled
   * at once and reported like any rebuild; before that, the first turn
   * simply builds within the new budget. Zero closes the notebook from the
   * next turn on; a budget after a closed start gathers at the next message.
   */
  setContextTokens(tokens: number): RebuildReport | null {
    this.context.setBudget(tokens)
    return this.firstTurnPending || !this.seeded ? null : this.reassembled()
  }

  /**
   * The context by hand: pin a document in (adding it if absent), keep one
   * out, or let one go — reassembled at once, between turns, and reported
   * like any rebuild so every host sees the same report.
   */
  async pinDocument(relPath: string): Promise<RebuildReport> {
    await this.context.pin(relPath)
    return this.reassembled()
  }

  excludeDocument(relPath: string): RebuildReport {
    this.context.exclude(relPath)
    return this.reassembled()
  }

  releaseDocument(relPath: string): RebuildReport {
    this.context.release(relPath)
    return this.reassembled()
  }

  private reassembled(): RebuildReport {
    const report = this.context.reassemble()
    this.contextPrompt = buildContextPrompt(
      this.opts.ambient,
      this.context.budget === 0 ? CLOSED_ACTIVITY : report.activityMarkdown,
    )
    this.emit({ type: 'context-rebuilt', report })
    return report
  }

  /**
   * One conversation turn: settle the context for the message, run the
   * model over it, record what the turn did, and snapshot the session.
   * A failed model turn is reported, never thrown — the conversation goes
   * on, and any tool that already ran stays in the record.
   */
  async send(userMessage: string, files?: ChatMessageFiles, abortSignal?: AbortSignal): Promise<TurnReport> {
    // A trace is one reply, never an interactive session's idle time between messages.
    const parent = currentTimingSpan()
    const span =
      parent?.record.kind === 'turn' && parent.record.name === 'ai:chat'
        ? parent
        : new TimingSpan({ kind: 'turn', name: 'ai:chat' }, undefined, true)
    try {
      const report = await span.run(() => this.sendTimed(userMessage, files, abortSignal))
      // Result-ready is the boundary. Persist its measurements in the very first
      // snapshot, rather than trying to include the write of those measurements.
      span.finish(report.stopped ? 'aborted' : report.error ? 'error' : 'success')
      const timing = timingDetail(span)
      this.context.recordTurnTiming(timing)
      await this.snapshot()
      return { ...report, timing }
    } catch (error) {
      span.finish(thrownOutcome(error))
      throw error
    }
  }

  /** An assembly the model has seen: a rebuild this session, or a restored one. Closed and skipped turns are not. */
  private hasAssembly(): boolean {
    return this.context.log.some((entry) => (entry.stats?.budget ?? 0) > 0 && !entry.preflight?.skipped)
  }

  /**
   * The preflight's verdict for a message, or null: no preflight, a closed
   * notebook, an aborted turn, or a check that failed — which is logged and
   * reads as usual, since the check is a saving, never a gate.
   */
  private async preflightOf(userMessage: string, abortSignal?: AbortSignal): Promise<PreflightVerdict | null> {
    if (!this.opts.preflight || abortSignal?.aborted || this.context.budget === 0) return null
    try {
      return await this.opts.preflight(userMessage, this.turns.slice(-6), { assembled: this.hasAssembly() })
    } catch (error) {
      await this.logError({
        source: 'ai:chat',
        stage: 'context:preflight',
        message: error instanceof Error ? error.message : String(error),
        question: userMessage,
      })
      return null
    }
  }

  private async sendTimed(
    userMessage: string,
    files?: ChatMessageFiles,
    abortSignal?: AbortSignal,
  ): Promise<TurnReport> {
    // Stamped at submit time — the gather below can take a while, and the
    // stamp should say when the message was sent, not when the model ran.
    const turnWhen = await this.stamp()

    // A notebook opened after a closed start gathers its baseline now, and
    // the turn runs as the first gathering turn.
    if (!abortSignal?.aborted && !this.seeded && this.context.budget > 0) {
      await this.context.seedBaseline()
      this.seeded = true
      this.firstTurnPending = true
    }

    // The host's preflight, when it runs one: a quick judge reads the message
    // first, and a message that needs nothing from the notebook is answered
    // without reading it.
    const preflight = await this.preflightOf(userMessage, abortSignal)

    // Spoken exchanges also occupy turn numbers, although they did not run this context pipeline.
    this.context.continueAfter(Math.floor(this.turns.length / 2))
    let context: TurnContextReport
    if (abortSignal?.aborted) {
      this.context.continueAfter(Math.floor(this.turns.length / 2) + 1)
      context = { errors: [] }
    } else if (preflight?.skipped) {
      // Nothing read for this message. The first gathering turn, when it has
      // not run yet, waits for a message that needs it.
      if (!this.hasAssembly()) this.contextPrompt = buildContextPrompt(this.opts.ambient, SKIPPED_ACTIVITY)
      context = this.context.skippedTurn(preflight)
      this.emit({ type: 'context-skipped', preflight })
    } else if (this.firstTurnPending) {
      this.firstTurnPending = false
      // A closed notebook gathers nothing — no gathering to announce.
      if (this.context.budget > 0) this.emit({ type: 'context-gathering' })
      context = await this.context.firstTurn(userMessage)
    } else {
      context = await this.context.evolveTurn(userMessage, this.turns.slice(-6))
    }
    if (context.rebuilt) {
      this.contextPrompt = buildContextPrompt(this.opts.ambient, context.rebuilt.activityMarkdown)
      this.emit({ type: 'context-rebuilt', report: context.rebuilt })
    }
    if (context.errors.length > 0) this.emit({ type: 'context-errors', errors: context.errors })
    // The turn's settings go on its log entry now, before the reply: a turn
    // that fails, or a snapshot taken while the answer is running, still
    // says which model, effort, and reading budget it ran under.
    this.context.recordTurnSettings(this.profile)
    if (preflight) this.context.recordPreflight(preflight)

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
    this.engine.appendUserMessage(userMessage, turnWhen, files?.content)
    for (const file of files?.attachments ?? []) this.attachments.set(file.file, file)
    // The turn has begun: for a host that keeps the thread, the snapshot holds
    // the message now, before the reply, in case the process dies answering.
    if (this.snapshotOnSend) await this.snapshot()

    const report: TurnReport = { context, sourceUrls: [], approvalRoundsExhausted: false }
    const replyImages: ChatImage[] = []
    try {
      const { tools, toolApproval, instructions } = abortSignal?.aborted
        ? { tools: {}, toolApproval: {}, instructions: undefined }
        : await this.opts.tools({
            researchContext: { contextTokens: this.context.budget, instructions: this.systemPrompt },
            context: {
              instructions: [this.systemPrompt, this.contextPrompt].join('\n\n'),
              conversation: this.turns.map((turn) => ({ ...turn })),
            },
            attachments: () => [...(this.resumeSession?.attachments ?? []), ...this.attachments.values()],
            writingDrafts: {
              list: () => this.writingDraftLinks,
              focus: () => this.writingDraftFocus,
              link: (id, turn) => this.linkWritingDraft(id, turn),
            },
            legalReview: {
              id: () => this.legalReview?.id,
              link: async (id) => {
                if (this.legalReview?.id === id) return
                this.legalReview = { id, turn: Math.ceil(this.turns.length / 2) }
                this.newMessages = true
                await this.snapshot()
              },
            },
            onExternalFiles: (files) => recordExternalFiles(this.externalFiles, files),
            onAttachments: (files) => {
              for (const file of files) this.attachments.set(file.file, file)
            },
            onImages: (images) => replyImages.push(...images),
          })
      if (!this.toolsAnnounced) {
        this.toolsAnnounced = true
        this.emit({ type: 'tools', names: Object.keys(tools) })
      }
      if (!abortSignal?.aborted) this.emit({ type: 'model-start' })

      const result = await this.engine.runTurn({
        abortSignal,
        instructions: [this.systemPrompt, this.contextPrompt, ...(instructions ? [instructions] : [])],
        notebook: {
          instructions: this.contextPrompt,
          tokens: this.context.log.findLast((entry) => entry.stats)?.stats?.docTokens ?? 0,
          fit: (tokens) => {
            const rebuilt = this.context.fitForRequest(tokens)
            this.contextPrompt = buildContextPrompt(this.opts.ambient, rebuilt.activityMarkdown)
            context.rebuilt = rebuilt
            this.emit({ type: 'context-rebuilt', report: rebuilt })
            return { instructions: this.contextPrompt, tokens: rebuilt.stats?.docTokens ?? 0 }
          },
        },
        tools,
        toolApproval,
      })
      // Tool records and usage join the turn's entry, beside its settings.
      this.context.recordTurnTools(result.toolRecords)
      this.context.recordTurnUsage(result.usage)

      const sourceUrls = [...new Set(result.sourceUrls)]
      const text = withChatImages(result.text, replyImages)
      const assistant: ConversationMessage = { role: 'assistant', content: withSources(text, sourceUrls) }
      const when = await this.stamp()
      if (when) assistant.when = when
      this.turns.push(assistant)

      report.text = text
      report.sourceUrls = sourceUrls
      report.approvalRoundsExhausted = result.approvalRoundsExhausted
      if (result.stopped) report.stopped = true
      if (result.cutShort) report.cutShort = result.cutShort
      report.usage = result.usage
    } catch (err) {
      // A failed turn keeps its tool trail — an executed side-effectful
      // call (a sent post, a created doc) must not vanish from the
      // transcript because the turn later died.
      if (err instanceof TurnError && err.toolRecords.length > 0) this.context.recordTurnTools(err.toolRecords)
      // TurnError arrives pre-clamped; foreign errors get the same cap —
      // a validation failure embeds the whole message array in .message.
      const message = truncate((err as Error).message ?? String(err), MAX_ERROR_CHARS)
      report.error = message
      if (replyImages.length > 0) {
        // A completed image must survive filing even if the model's final
        // reply fails after the paid generation has finished.
        const text = withChatImages('The images were created, but the reply was interrupted.', replyImages)
        const assistant: ConversationMessage = { role: 'assistant', content: text }
        if (turnWhen) assistant.when = turnWhen
        this.turns.push(assistant)
        this.engine.seedConversation([assistant])
        report.text = text
      }
      await this.logError({ source: 'ai:chat', stage: 'turn', message, question: userMessage })
    }

    report.adjustment = this.context.log.at(-1)?.adjustment
    return report
  }

  /**
   * Finish the session. A wanted save files the transcript through the
   * store's gate and returns its report; otherwise nothing is written. In
   * both cases the crash snapshot goes — the transcript is either durably
   * on disk (saved, or parked as a recovery copy) or deliberately dropped.
   */
  async end(opts: EndOptions): Promise<SaveChatReport | null> {
    const resume = this.resumeSession
    // A resumed session with no new messages leaves its file untouched.
    const wanted = opts.save && this.turns.length > this.inherited && (!resume || this.newMessages)
    if (!wanted) {
      await this.clearSnapshot()
      return null
    }

    const saved = await this.save(opts)
    await this.clearSnapshot()
    return saved
  }

  /**
   * File the conversation now and go on talking: what a branch asks of a
   * parent that has no file yet, since the branch's own file goes in the
   * folder beside its parent's. A light save — the pinned title, no tags,
   * rel, memory or profile work; those come at the real end — after which
   * the session writes back to that file like a resumed chat. Already filed,
   * it answers with where. Returns null when there is nothing to file.
   */
  async fileNow(options?: Omit<EndOptions, 'save'>): Promise<SaveChatReport | null> {
    if (this.resumeSession && !this.newMessages) return null
    if (this.turns.length <= this.inherited) return null
    const saved = await this.save({
      save: true,
      autoTag: false,
      autoRel: false,
      memoryDir: null,
      people: false,
      ...options,
    })
    if (!saved.aborted) {
      this.resumeSession = await loadResumeSession(saved.path, { baseDir: path.dirname(this.opts.timeDir) })
      this.newMessages = false
    }
    return saved
  }

  private async save(opts: EndOptions): Promise<SaveChatReport> {
    const history = this.engine.snapshotMessages()
    const saved = await saveChat({
      continuation: {
        version: 1,
        historyKey: conversationKey(this.turns),
        legalReview: this.legalReview,
        writingDrafts: this.writingDrafts,
        writingDraftFocus: this.writingDraftFocus,
        modelMessages: hasCompleteModelHistory(history, this.turns) ? history : undefined,
        contextTokens: this.contextTokens,
        host: this.snapshotHostState?.(),
      },
      turns: this.turns,
      contextLog: this.contextLog,
      resume: this.resumeSession,
      parent: this.opts.parent ?? null,
      inherited: this.inherited,
      title: this.pinnedTitle ?? undefined,
      timeDir: this.opts.timeDir,
      day: this.opts.today,
      startTime: this.opts.startTime,
      endTime: await this.now(),
      externalFiles: this.externalFiles,
      attachments: [...this.attachments.values()],
      approvals: this.opts.approvals?.(),
      autoTag: opts.autoTag,
      autoRel: opts.autoRel,
      memoryDir: opts.memoryDir,
      people: opts.people,
      logToDay: opts.logToDay,
      onProgress: (event) => this.emit(event),
      enricher: opts.enricher,
    })
    if (!saved.aborted) await this.opts.onSaved?.(saved)
    return saved
  }

  /**
   * Crash insurance: the session as it now stands, every turn — ephemeral
   * sessions included, since -E decides what a clean exit keeps, not what
   * a crash may lose. Must never break the conversation: failures are
   * reported and logged, then the turn is over.
   */
  snapshot(): Promise<void> {
    this.snapshotWrite = this.snapshotWrite.then(
      () => this.writeSnapshot(),
      () => this.writeSnapshot(),
    )
    return this.snapshotWrite
  }

  private async writeSnapshot(): Promise<void> {
    if (!this.opts.autosavePath || this.turns.length === 0) return
    try {
      await writeChatAutosave(this.opts.autosavePath, {
        turns: this.turns,
        contextLog: this.contextLog,
        resume: this.resumeSession,
        parent: this.parent,
        startTime: this.opts.startTime,
        externalFiles: this.externalFiles,
        attachments: [...this.attachments.values()],
        approvals: this.opts.approvals?.(),
        recovery: {
          version: 1,
          legalReview: this.legalReview,
          writingDrafts: this.writingDrafts,
          writingDraftFocus: this.writingDraftFocus,
          modelMessages: this.engine.snapshotMessages(),
          contextTokens: this.contextTokens,
          host: this.snapshotHostState?.(),
        },
      })
    } catch (err) {
      const message = (err as Error).message
      this.emit({ type: 'autosave-failed', message })
      await this.logError({ source: 'ai:chat', stage: 'autosave', message })
    }
  }

  /**
   * Whether the crash snapshot is also written as each turn begins, so a
   * host gets it back knowing what it was asked if the service dies before
   * the reply. Independent of whether ending the session files a transcript.
   */
  snapshotOnSend = false

  private async clearSnapshot(): Promise<void> {
    await this.snapshotWrite
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
