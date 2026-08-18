/**
 * The session-lived context state machine behind ai:chat.
 *
 * ChatContext decides what is in the candidate document pool and remembers
 * why; ContextAssembler (models/AI) decides what fits the token budget each
 * turn and renders it. Everything that shapes the model-facing document
 * context lives here — the baseline gather, query-driven growth across
 * turns, the retrieval evidence and topic terms feeding the chat scorer
 * (score.ts), goal/decision pinning, own-transcript exclusion, and the
 * per-turn context log that makes a session resumable.
 *
 * The class is host-neutral: it never prints and never talks to a terminal.
 * A host (the CLI command today, a web session later) injects the query
 * producers, calls one method per turn, and renders the returned report
 * however it likes.
 */

import * as path from 'node:path'
import { type AIErrorEntry, logAIError } from '#shared/ai/errorLog.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import ContextAssembler, { type ReserveOptions, type ScoredItem } from '#shared/models/AI/ContextAssembler/mod.ts'
import { withPinnedPaths } from '#shared/models/AI/ContextAssembler/scorers.ts'
import DomainCollection from '#shared/models/DomainCollection/mod.ts'
import { parseDuration } from '#shared/models/DomainCollection/query/filters/mod.ts'
import type { QueryTruncation } from '#shared/models/DomainCollection/query/resolvers/shared.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { parseTimePath, weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import {
  type ContextDocRecord,
  type ContextTurnLog,
  type ToolCallRecord,
  type TurnStats,
} from '../document/ContextLog/mod.ts'
import type { ResumeState } from '../document/resume.ts'
import type { ConversationMessage } from '../type.d.ts'
import createDayLabeler from './dayLabel.ts'
import { fetchContextFromServer } from './fetchContext.ts'
import { resolveUniverse, type UniverseResolution } from './resolveUniverse.ts'
import {
  CHAT_SCORE,
  createChatScorer,
  type DocProvenance,
  extractTopicTerms,
  SCORING,
  strongerTier,
  tierForResultSize,
} from './score.ts'

// -----------------------------------------------------------------------------
// Producers — the query pipeline a host injects
// -----------------------------------------------------------------------------

/**
 * A producer either delivers a value or reports why it couldn't. The two
 * failure channels are deliberate: `ok: false` means the pipeline ran and
 * failed (it already logged its own details — the class records only the
 * turn impact), while a thrown error means the pipeline itself broke and
 * the class logs it to the AI error log.
 */
export type ProducerResult<T> = { ok: true; value: T } | { ok: false; message: string }

export interface ContextProducers {
  /**
   * Turn 1: question → GraphQL query + matching paths. CLI: ai:context:files.
   * `since`/`until` carry the user-stated window when the question named one
   * — the signal that switches admission to the sweep-stratified policy.
   */
  produceInitialQuery(userMessage: string): Promise<
    ProducerResult<{
      paths: string[]
      query?: string
      truncations?: QueryTruncation[]
      since?: string
      until?: string
      /** Exact first day of a closed range, when the window resolved one. */
      start?: string
    }>
  >
  /** Turns 2+: should the query set change, and to what. CLI: ai:context:evolve. */
  evolveQueries(
    userMessage: string,
    queries: string[],
    recentConversation: ConversationMessage[],
  ): Promise<ProducerResult<{ queries: string[]; changed: boolean }>>
  /** Execute one GraphQL query → matching paths. CLI: markdown:sel. */
  executeQuery(query: string): Promise<ProducerResult<{ paths: string[]; truncations?: QueryTruncation[] }>>
}

// -----------------------------------------------------------------------------
// Reports — what a host renders
// -----------------------------------------------------------------------------

/** One reassembly of the context: what shipped, what changed, what was cut. */
export interface RebuildReport {
  /** Rendered kept-documents markdown, null when the universe is empty. */
  activityMarkdown: string | null
  stats?: TurnStats
  /** Docs new to the universe this turn (turn 1 records them in the log's universe instead). */
  added: ContextDocRecord[]
  /** Docs cut this rebuild: budget-pruned and scorer-excluded alike. */
  cut: ContextDocRecord[]
  turn: number
  /** Documents in the universe, for the host's "Context loaded (N documents)" line. */
  collectionSize: number
  /** False for the resume-setup rebuild, which must not render a changelog. */
  recorded: boolean
}

/** What a turn's context work produced. */
export interface TurnContextReport {
  /** Set when the context was reassembled — the host must rebuild its context prompt. */
  rebuilt?: RebuildReport
  /** Context failures this turn, already recorded in the log and error file. */
  errors: string[]
}

export interface SeedReport {
  counts: { today: number; prev: number; goals: number; decisions: number }
  fetchMs: number
  collectionMs: number
  /** Deduplicated universe size — the host's "Found: N documents" count. */
  size: number
}

export interface RestoreReport {
  resolution: UniverseResolution
  rebuild: RebuildReport
}

/** Mid-turn signals a host may surface while a turn's context work runs. */
export type ContextProgressEvent =
  | { type: 'queries-changed' }
  | { type: 'no-new-queries' }
  // Evolve-turn queries run through markdown:sel composed (which prints
  // nothing), so capped results surface through this event. Turn 1 needs no
  // event: ai:context:files prints its own warning into the host's output.
  | { type: 'truncated'; items: QueryTruncation[] }

// -----------------------------------------------------------------------------
// Options
// -----------------------------------------------------------------------------

export interface ChatContextOptions {
  /** The session's anchor day — recency scoring and the baseline window key off it. */
  today: PlainDate
  /** Days of history the baseline sweeps (today plus days-1 previous). */
  days: number
  /** Absolute notebook root; log paths relativize and universe paths resolve against it. */
  baseDir: string
  /** The query pipeline. See ContextProducers for the CLI implementations. */
  producers: ContextProducers
  /** Token budget for the assembled document context. */
  maxTokens?: number
  /**
   * This session's own transcript path. A session must never retrieve its
   * own transcript into its own context: a resumed chat exists on disk
   * mid-session, so recency/body queries can match it (observed:
   * `chats(recent: "2d")` returning the very chat being continued —
   * thousands of tokens duplicating the conversation the model already
   * has). Fresh sessions only write at exit and cannot self-match.
   */
  ownChatPath?: string | null
  /**
   * Opt-in lean baseline: previous days before yesterday seed from their
   * summary.md — or the day.md ledger alone when no summary exists —
   * instead of every raw file. Today and yesterday always seed whole.
   * Default off: a no-summary day sweeps in all its raw files.
   */
  summaryBaseline?: boolean
  onProgress?: (event: ContextProgressEvent) => void
  /** Test seams — production uses the real service fetch and error log. */
  fetchContext?: typeof fetchContextFromServer
  logError?: (entry: AIErrorEntry) => Promise<void>
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/**
 * Read the given files from disk and merge them into the collection,
 * stripping chat metadata comments and transcript sections. Builds DomainCollection without a local MarkdownStore.
 */
async function mergePathsIntoCollection(
  paths: string[],
  existing: DomainCollection | null,
): Promise<DomainCollection | null> {
  if (paths.length === 0) return existing
  const docs: Array<{ doc: Document; path: string }> = []
  for (const filePath of paths) {
    try {
      const content = await readTextFile(filePath)
      const doc = Document.fromMarkdown(content)
        .stripHtmlComments()
        .filterSections((h) => !h.text.toLowerCase().includes('transcript'))
      docs.push({ doc, path: filePath })
    } catch (err) {
      // Skip unreadable files
      console.warn(`[ai:chat] skipping context file ${filePath}: ${(err as Error).message}`)
    }
  }
  if (docs.length === 0) return existing
  const newCollection = DomainCollection.fromDocuments(docs, null, { depth: 0 })
  return existing ? existing.merge(newCollection) : newCollection
}

// -----------------------------------------------------------------------------
// ChatContext
// -----------------------------------------------------------------------------

export default class ChatContext {
  private readonly today: PlainDate
  private readonly days: number
  private readonly baseDir: string
  private readonly maxTokens: number
  private readonly ownChatPath: string | null
  private readonly summaryBaseline: boolean
  private readonly producers: ContextProducers
  private readonly onProgress?: (event: ContextProgressEvent) => void
  private readonly fetchContext: typeof fetchContextFromServer
  private readonly logError: (entry: AIErrorEntry) => Promise<void>
  private readonly dayLabel: (path: string) => string | undefined

  private collection: DomainCollection | null = null
  private contextPaths: string[] = []
  private queries: string[] = []
  private provenance = new Map<string, DocProvenance>()
  private topicTerms: string[] = []
  private pinnedPaths: ReadonlySet<string> = new Set()
  /**
   * The user-stated window from turn 1, when the question named one. While
   * set, every rebuild admits with the sweep-stratified policy — evolve
   * turns inherit it, because the stated window governs the conversation,
   * not just the turn that stated it.
   */
  private sweep: { since: string; until?: string; start?: string } | null = null
  private contextLog: ContextTurnLog[] = []
  private turnNumber = 0
  // Context failures for the current turn. Reset when a turn starts (both
  // first-turn and evolve paths), recorded into the turn's ContextTurnLog
  // entry by rebuild, and returned for the host to surface — the chat used
  // to swallow these and answer from silently thinner context.
  private turnErrors: string[] = []
  /** Capped query results this turn, recorded into the turn's stats. */
  private turnTruncations: QueryTruncation[] = []

  constructor(opts: ChatContextOptions) {
    this.today = opts.today
    this.days = opts.days
    this.baseDir = opts.baseDir
    this.maxTokens = opts.maxTokens ?? 300_000
    this.ownChatPath = opts.ownChatPath ?? null
    this.summaryBaseline = opts.summaryBaseline ?? false
    this.producers = opts.producers
    this.onProgress = opts.onProgress
    this.fetchContext = opts.fetchContext ?? fetchContextFromServer
    this.logError = opts.logError ?? logAIError
    this.dayLabel = createDayLabeler(opts.today)
  }

  /** Universe paths as of the last rebuild (what the model would see). */
  get paths(): string[] {
    return this.contextPaths
  }

  /** The per-turn context log, for serialization on save. */
  get log(): ContextTurnLog[] {
    return this.contextLog
  }

  // ---------------------------------------------------------------------------
  // Session setup — exactly one of seedBaseline/restore runs per session
  // ---------------------------------------------------------------------------

  /**
   * Fresh session: gather the baseline universe from the notebook service —
   * today's documents, the previous days' activity, goals, and pending
   * decisions.
   */
  async seedBaseline(): Promise<SeedReport> {
    const prevStart = this.today.addDays(-(this.days - 1))
    const yesterday = this.today.addDays(-1)

    // pathContains scopes the date sweeps to the time tree: project folder
    // files carry created: dates too, and large project docs in a date
    // sweep cost seconds of serialize for content the query-targeted rel
    // path (ai:context:files) is meant to fetch when relevant.
    let t0 = performance.now()
    const [todayDocs, prevDocsRaw, goalDocs, decisionDocs] = await Promise.all([
      this.fetchContext(`{ documents(where: { date: "${this.today}", pathContains: "/time/" }) { path } }`, 1),
      this.fetchContext(
        `{ documents(where: { dateGte: "${prevStart}", dateLte: "${yesterday}", pathContains: "/time/" }) { path } }`,
        0,
      ),
      this.fetchContext(`{ goals { path } }`, 0),
      this.fetchContext(`{ decisions(where: { pending: true }) { path } }`, 0),
    ])
    const fetchMs = performance.now() - t0

    // Group previous day docs by date and apply per-day strategy. Week- and
    // month-level docs (the week plan, a week summary) are real context but
    // belong to no single day, so the per-day summary policy never applies
    // to them — they seed whole alongside whatever the grouping keeps.
    const byDate = new Map<string, Array<{ doc: Document; path: string }>>()
    const spanDocs: Array<{ doc: Document; path: string }> = []
    for (const d of prevDocsRaw) {
      if (!d.path.includes('/time/')) continue
      const info = parseTimePath(d.path)
      if (!info) continue
      if (info.kind !== 'day') {
        spanDocs.push(d)
        continue
      }
      const date = info.date.toString()
      const list = byDate.get(date) ?? []
      list.push(d)
      byDate.set(date, list)
    }

    const prevDocs: Array<{ doc: Document; path: string }> = []
    const yesterdayKey = yesterday.toString()
    for (const [date, files] of byDate) {
      // The opt-in summary baseline exempts yesterday: like today it seeds
      // whole — recent enough that conversations usually need the raw
      // record, summarized or not.
      const exempt = this.summaryBaseline && date === yesterdayKey
      const hasSummary = files.some((f) => f.path.endsWith('/summary.md'))
      if (hasSummary && !exempt) {
        // Summary replaces raw activity, but journals and AI chats carry
        // context the summary doesn't (mirrors journal:new's gatherContext)
        prevDocs.push(
          ...files.filter(
            (f) => f.path.endsWith('/summary.md') || f.path.includes('/journal/') || f.path.includes('/ai-chats/'),
          ),
        )
      } else if (this.summaryBaseline && !exempt) {
        // No summary under the lean baseline: the day.md ledger stands in —
        // it links every artifact of the day, so query evolution can still
        // reach anything dropped here.
        prevDocs.push(...files.filter((f) => f.path.endsWith('/day.md')))
      } else {
        prevDocs.push(...files)
      }
    }
    prevDocs.push(...spanDocs)

    // Deduplicate all docs by path
    const seen = new Set<string>()
    const allDocs: Array<{ doc: Document; path: string }> = []
    for (const d of [...todayDocs, ...prevDocs, ...goalDocs, ...decisionDocs]) {
      if (!seen.has(d.path)) {
        seen.add(d.path)
        allDocs.push(d)
      }
    }

    // Goals and pending decisions are the strategic spine — never prune them.
    // Unpinned they cap at score 8 (flat recency 3 + type 5) and lose to any
    // query-boosted (+10) document when the token budget forces pruning.
    // The current week's plan is pinned with them: it governs the whole
    // week's conversations. Pinning the path is a no-op when no plan exists.
    const pinned = new Set([...goalDocs, ...decisionDocs].map((d) => d.path))
    pinned.add(this.weekPlanPath())
    this.pinnedPaths = pinned

    t0 = performance.now()
    this.collection = allDocs.length > 0 ? DomainCollection.fromDocuments(allDocs, null, { depth: 0 }) : null
    const collectionMs = performance.now() - t0
    this.contextPaths = this.collection?.paths ?? []

    return {
      counts: {
        today: todayDocs.length,
        prev: prevDocsRaw.length,
        goals: goalDocs.length,
        decisions: decisionDocs.length,
      },
      fetchMs,
      collectionMs,
      size: allDocs.length,
    }
  }

  /**
   * Resumed session with a context log: restore the recorded universe
   * exactly — no fresh baseline injection. New documents enter only through
   * the normal evolve path afterward. The rebuild is not recorded: it must
   * not append a duplicate entry for an already-recorded turn.
   */
  async restore(state: ResumeState): Promise<RestoreReport> {
    // Carry the recorded log state forward so a re-save appends rather
    // than restarts, and turn numbering continues where it left off.
    this.contextLog.push(...state.contextLog)
    this.queries = [...state.queries]
    this.turnNumber = state.lastTurn

    // Re-arm the sweep policy the recorded session was running — the stated
    // window governs the conversation, resumed or not.
    for (let i = state.contextLog.length - 1; i >= 0; i--) {
      const stats = state.contextLog[i].stats
      if (stats?.sweep) {
        const [since, until] = stats.sweep.split('..')
        this.sweep = { since, ...(until ? { until } : {}), ...(stats.sweepFrom ? { start: stats.sweepFrom } : {}) }
        break
      }
    }

    const resolution = await resolveUniverse(state.universePaths, this.baseDir)
    this.collection = await mergePathsIntoCollection(
      this.excludeOwnChat(resolution.resolved.map((r) => path.join(this.baseDir, r))),
      null,
    )
    // The recorded goals/decisions keep their never-prune pinning on resume,
    // as does the current week's plan when the universe carries it.
    this.pinnedPaths = new Set([
      ...resolution.resolved
        .filter((r) => r.startsWith('goals/') || r.startsWith('decisions/'))
        .map((r) => path.join(this.baseDir, r)),
      this.weekPlanPath(),
    ])
    // Recorded diffs are the docs queries added in the original session,
    // so they re-seed the retrieval evidence. Result-set sizes weren't
    // recorded; each diff's own length stands in for selectivity —
    // understating evidence rather than inventing it. Turn-1 query hits
    // are mixed into the universe with the baseline and stay unboosted —
    // a best-effort restore, not an exact one.
    for (const entry of state.contextLog) {
      if (!entry.diff || entry.diff.length === 0) continue
      const diffPaths = entry.diff.map((r) => path.join(this.baseDir, r.path))
      this.recordRetrieval(diffPaths, entry.diff.length, entry.turn)
    }
    const recentUser = state.conversation
      .filter((m) => m.role === 'user')
      .slice(-3)
      .map((m) => m.content)
      .reverse()
    this.topicTerms = extractTopicTerms(recentUser.join('\n') || undefined, this.queries)

    return { resolution, rebuild: this.rebuild(undefined, false) }
  }

  // ---------------------------------------------------------------------------
  // Turns
  // ---------------------------------------------------------------------------

  /** Turn 1: produce the initial query from the question and merge its results. */
  async firstTurn(userMessage: string): Promise<TurnContextReport> {
    this.turnNumber = 1
    this.turnErrors = []
    this.turnTruncations = []

    let newPaths: string[] | undefined
    try {
      const produced = await this.producers.produceInitialQuery(userMessage)
      if (produced.ok && produced.value.truncations?.length) {
        // ai:context:files already printed the warning; record for the log.
        this.turnTruncations.push(...produced.value.truncations)
      }
      // A stated window arms the sweep policy even when the query itself
      // returned nothing — the baseline universe still admits stratified.
      if (produced.ok && produced.value.since) {
        this.sweep = {
          since: produced.value.since,
          ...(produced.value.until ? { until: produced.value.until } : {}),
          ...(produced.value.start ? { start: produced.value.start } : {}),
        }
      }
      if (produced.ok && produced.value.paths.length > 0) {
        if (produced.value.query) this.queries.push(produced.value.query)
        const fetched = this.excludeOwnChat(produced.value.paths)
        // Selectivity from the raw result size — excluding the own chat
        // doesn't change how targeted the query was.
        this.recordRetrieval(fetched, produced.value.paths.length)
        newPaths = fetched
        this.collection = await mergePathsIntoCollection(fetched, this.collection)
      } else if (!produced.ok) {
        // The producer already logged the query + GraphQL errors; record the pipeline impact
        this.turnErrors.push(produced.message)
        await this.logError({
          source: 'ai:chat',
          stage: 'context:files',
          message: produced.message,
          question: userMessage,
        })
      }
    } catch (err) {
      const message = (err as Error).message
      this.turnErrors.push(message)
      await this.logError({ source: 'ai:chat', stage: 'context:files', message, question: userMessage })
    }

    // Terms come from the question even when the query pipeline failed —
    // lexical scoring still works over the baseline universe.
    this.topicTerms = extractTopicTerms(userMessage, this.queries)
    const rebuilt = this.rebuild(newPaths, true)
    this.ensureErrorEntry()
    return { rebuilt, errors: [...this.turnErrors] }
  }

  /**
   * Turns 2+: evolve the query set if the conversation direction shifted,
   * execute whatever queries are genuinely new, and reassemble when
   * anything changed. An unchanged turn returns no rebuild — the host's
   * context prompt stays as it was.
   */
  async evolveTurn(userMessage: string, recentConversation: ConversationMessage[]): Promise<TurnContextReport> {
    this.turnNumber++
    this.turnErrors = []
    this.turnTruncations = []

    let rebuilt: RebuildReport | undefined
    try {
      const evolved = await this.producers.evolveQueries(userMessage, [...this.queries], recentConversation)
      if (evolved.ok && evolved.value.changed && evolved.value.queries.length > 0) {
        this.onProgress?.({ type: 'queries-changed' })
        const prevQuerySet = new Set(this.queries)
        this.queries = evolved.value.queries

        // Only execute queries that are actually new or modified
        const newQueries = evolved.value.queries.filter((q) => !prevQuerySet.has(q))
        if (newQueries.length === 0) {
          this.onProgress?.({ type: 'no-new-queries' })
        }

        const allNewPaths: string[] = []
        for (const query of newQueries) {
          try {
            const executed = await this.producers.executeQuery(query)
            if (executed.ok && executed.value.truncations?.length) {
              // Composed markdown:sel printed nothing — the host surfaces this.
              this.turnTruncations.push(...executed.value.truncations)
              this.onProgress?.({ type: 'truncated', items: executed.value.truncations })
            }
            if (executed.ok && executed.value.paths.length > 0) {
              const fetched = this.excludeOwnChat(executed.value.paths)
              this.recordRetrieval(fetched, executed.value.paths.length)
              allNewPaths.push(...fetched)
              this.collection = await mergePathsIntoCollection(fetched, this.collection)
            } else if (!executed.ok) {
              // The producer already logged the query + GraphQL errors
              this.turnErrors.push(executed.message)
            }
          } catch (err) {
            const message = (err as Error).message
            this.turnErrors.push(message)
            await this.logError({
              source: 'ai:chat',
              stage: 'context:evolve:query',
              message,
              query,
              question: userMessage,
            })
          }
        }

        // Evidence was recorded per query execution above. Terms follow
        // the current queries plus the recent conversation window — the
        // current message alone loses subjects still under discussion
        // (a drafting turn that stops naming the person it is about),
        // while old queries dropping out still tracks real drift.
        const recentUser = recentConversation
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
          .reverse()
        this.topicTerms = extractTopicTerms([userMessage, ...recentUser].join('\n'), this.queries)
        rebuilt = this.rebuild(allNewPaths, true)
      } else if (!evolved.ok) {
        this.turnErrors.push(evolved.message)
        await this.logError({
          source: 'ai:chat',
          stage: 'context:evolve',
          message: evolved.message,
          question: userMessage,
        })
      }
    } catch (err) {
      const message = (err as Error).message
      this.turnErrors.push(message)
      await this.logError({ source: 'ai:chat', stage: 'context:evolve', message, question: userMessage })
    }

    this.ensureErrorEntry()
    return { rebuilt, errors: [...this.turnErrors] }
  }

  /**
   * Attach the turn's tool records to its log entry — creating one when the
   * turn changed no context and so recorded nothing else. Every turn writes
   * an entry even when nothing changed and no tool ran: an absent turn is
   * indistinguishable from a recording gap.
   */
  recordTurnTools(turnTools: ToolCallRecord[]): void {
    if (turnTools.length > 0) {
      let turnEntry: ContextTurnLog | undefined
      for (let i = this.contextLog.length - 1; i >= 0; i--) {
        if (this.contextLog[i].turn === this.turnNumber) {
          turnEntry = this.contextLog[i]
          break
        }
      }
      if (turnEntry) turnEntry.tools = turnTools
      else this.contextLog.push({ turn: this.turnNumber, queries: [...this.queries], tools: turnTools })
    }

    if (!this.contextLog.some((e) => e.turn === this.turnNumber)) {
      this.contextLog.push({ turn: this.turnNumber, queries: [...this.queries] })
    }
  }

  /** Drop the whole universe (the /no-context escape hatch). */
  clear(): void {
    this.collection = null
    this.contextPaths = []
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private excludeOwnChat(paths: string[]): string[] {
    return this.ownChatPath ? paths.filter((p) => p !== this.ownChatPath) : paths
  }

  /** Absolute path of the current week's plan — pinned whenever the universe has it. */
  private weekPlanPath(): string {
    return path.join(this.baseDir, 'time', weekDir(this.today), 'week.md')
  }

  /**
   * Reserve options for the sweep-stratified admission policy, when a
   * user-stated window is armed: month slices over [today − since,
   * until ‖ today], sliced by the day-path date; docs off the time tree
   * (or outside the window) compete normally. Returns undefined — plain
   * rank admission — without a sweep or when the window fails to resolve.
   */
  private sweepReserve(): ReserveOptions | undefined {
    if (!this.sweep) return undefined
    let start: PlainDate
    let end: PlainDate
    try {
      // The stated start is exact; the duration-derived start is the
      // fallback (an over-generous duration would reserve months before
      // the window the user named).
      start = this.sweep.start ? PlainDate.from(this.sweep.start) : this.today.addDays(-parseDuration(this.sweep.since))
      end = this.sweep.until ? PlainDate.from(this.sweep.until) : this.today
    } catch {
      return undefined
    }
    return {
      sliceOf: (item) => {
        const info = parseTimePath(item.path)
        if (info?.kind !== 'day') return null
        if (PlainDate.compare(info.date, start) < 0 || PlainDate.compare(info.date, end) > 0) return null
        return info.date.toString().slice(0, 7)
      },
      maxDocs: CHAT_SCORE.sweepReserveDocs,
      maxTokens: CHAT_SCORE.sweepReserveTokens,
    }
  }

  /**
   * Record retrieval evidence for query-returned paths. Evidence
   * accumulates over what queries actually returned — never the whole
   * universe, which would hand every document the same boost and let the
   * recency baseline outrank deliberate retrieval (the old binary +10's
   * failure mode). Alias-repeated paths within one execution count once;
   * `hits` counts distinct executions.
   */
  private recordRetrieval(paths: string[], resultSize: number, turn = this.turnNumber): void {
    const tier = tierForResultSize(resultSize)
    for (const p of new Set(paths)) {
      const prev = this.provenance.get(p)
      this.provenance.set(
        p,
        prev
          ? { tier: strongerTier(prev.tier, tier), hits: prev.hits + 1, lastHitTurn: turn }
          : { tier, hits: 1, lastHitTurn: turn },
      )
    }
  }

  private relPath(p: string): string {
    return p.startsWith(this.baseDir) ? p.slice(this.baseDir.length + 1) : p
  }

  /**
   * Log record for a scored doc with its explainable score parts: the
   * lexical component when it contributed, and the retrieval tier when
   * queries returned the doc. Scores round for log legibility; ranking
   * uses the raw values.
   */
  private scoredRecord(s: ScoredItem, lexicalByPath: ReadonlyMap<string, number>): ContextDocRecord {
    const rec: ContextDocRecord = {
      path: this.relPath(s.item.path),
      score: Math.round(s.score * 100) / 100,
      tokens: s.tokens,
    }
    const lex = lexicalByPath.get(s.item.path) ?? 0
    if (lex >= 0.05) rec.lex = Math.round(lex * 10) / 10
    const prov = this.provenance.get(s.item.path)
    if (prov) rec.prov = prov.tier
    return rec
  }

  /**
   * A turn whose pipeline failed outright never reaches rebuild, so its
   * errors would vanish from the saved log — record a minimal entry.
   */
  private ensureErrorEntry(): void {
    if (this.turnErrors.length > 0 && this.contextLog.at(-1)?.turn !== this.turnNumber) {
      this.contextLog.push({ turn: this.turnNumber, queries: [...this.queries], errors: [...this.turnErrors] })
    }
  }

  /** Reassemble the context from the current universe and record the turn log. */
  private rebuild(newPaths: string[] | undefined, record: boolean): RebuildReport {
    const prevPaths = new Set(this.contextPaths)
    this.contextPaths = this.collection?.paths ?? []

    let activityMarkdown: string | null = null
    let turnStats: TurnStats | undefined
    // Typed record for every universe path — shipped docs carry a score
    // (or pinned), cut docs additionally say why. One map serves the
    // turn-1 universe list, the diff, and the pruned snapshot.
    const docRecords = new Map<string, ContextDocRecord>()
    const cutRecords: ContextDocRecord[] = []

    if (this.collection) {
      const { scorer, lexicalByPath } = createChatScorer({
        today: this.today,
        collection: this.collection,
        terms: this.topicTerms,
        provenance: this.provenance,
      })
      const assembler = ContextAssembler.from(this.collection, {
        scorer: withPinnedPaths(scorer, this.pinnedPaths),
        maxTokens: this.maxTokens,
        floorFraction: CHAT_SCORE.floorFraction,
        reserve: this.sweepReserve(),
      })
      activityMarkdown = assembler.toMarkdown({ relativeTo: this.baseDir, delimited: true, label: this.dayLabel })
      const reservedPaths = new Set(assembler.reserved.map((s) => s.item.path))
      for (const s of assembler.kept) {
        const rec: ContextDocRecord =
          s.verdict.keep === 'always'
            ? { path: this.relPath(s.item.path), tokens: s.tokens, pinned: true }
            : this.scoredRecord(s, lexicalByPath)
        if (reservedPaths.has(s.item.path)) rec.via = 'reserve'
        docRecords.set(s.item.path, rec)
      }
      for (const s of assembler.pruned) {
        const rec: ContextDocRecord = { ...this.scoredRecord(s, lexicalByPath), cut: 'budget' }
        docRecords.set(s.item.path, rec)
        cutRecords.push(rec)
      }
      for (const s of assembler.floored) {
        const rec: ContextDocRecord = { ...this.scoredRecord(s, lexicalByPath), cut: 'floor' }
        docRecords.set(s.item.path, rec)
        cutRecords.push(rec)
      }
      for (const s of assembler.excluded) {
        const reason = s.verdict.keep === 'never' ? (s.verdict.reason ?? 'excluded') : 'excluded'
        const rec: ContextDocRecord = { path: this.relPath(s.item.path), tokens: s.tokens, cut: reason }
        docRecords.set(s.item.path, rec)
        cutRecords.push(rec)
      }
      // The scoring parameters in effect ride along in stats: recorded
      // scores and cuts are only interpretable against them, and none are
      // reconstructable from the transcript once they become tunable.
      turnStats = {
        kept: assembler.size,
        pruned: assembler.pruned.length,
        excluded: assembler.excluded.length,
        docTokens: assembler.totalTokens,
        budget: this.maxTokens,
        scoring: SCORING,
      }
      if (this.sweep) {
        turnStats.policy = 'sweep-stratified'
        turnStats.sweep = this.sweep.until ? `${this.sweep.since}..${this.sweep.until}` : this.sweep.since
        if (this.sweep.start) turnStats.sweepFrom = this.sweep.start
      }
      if (this.summaryBaseline) turnStats.baseline = 'summary'
      if (assembler.floorValue !== null) {
        turnStats.floor = Math.round(assembler.floorValue * 100) / 100
        turnStats.floored = assembler.floored.length
      }
      if (this.turnTruncations.length > 0) {
        turnStats.truncated = [...this.turnTruncations]
      }
    }

    // Compute diff: files new to the universe this turn. Query results
    // repeat a path once per alias that matched it — dedupe within the
    // pass so the diff lists each new doc once.
    const turnDiff: ContextDocRecord[] = []
    if (newPaths) {
      const seen = new Set<string>()
      for (const p of newPaths) {
        if (prevPaths.has(p) || seen.has(p)) continue
        seen.add(p)
        turnDiff.push(docRecords.get(p) ?? { path: this.relPath(p), tokens: 0 })
      }
    }

    if (record) {
      const entry: ContextTurnLog = { turn: this.turnNumber, queries: [...this.queries] }
      if (turnStats) entry.stats = turnStats
      if (this.turnNumber === 1) {
        // The full universe, shipped and cut alike — cut docs carry their
        // reason inline, so turn 1 needs no separate pruned section.
        entry.universe = this.contextPaths
          .map((p) => docRecords.get(p) ?? { path: this.relPath(p), tokens: 0 })
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      } else {
        if (turnDiff.length > 0) entry.diff = turnDiff
        if (cutRecords.length > 0) entry.pruned = cutRecords
      }
      if (this.turnErrors.length > 0) entry.errors = [...this.turnErrors]
      this.contextLog.push(entry)
    }

    return {
      activityMarkdown,
      stats: turnStats,
      added: turnDiff,
      cut: cutRecords,
      turn: this.turnNumber,
      collectionSize: this.collection?.size ?? 0,
      recorded: record,
    }
  }
}
