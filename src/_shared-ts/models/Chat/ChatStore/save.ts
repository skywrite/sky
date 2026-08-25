/**
 * The write half of the chat store: turning a finished session into the
 * file it lives in.
 *
 * Everything a saved chat *is* gets decided here — where it files, what
 * titles it, which tags and rel it carries, and, on a resume, whether the
 * original may be overwritten at all. That last question is why this is a
 * gate and not just a writer: a resumed session rewrites a file that
 * already holds history, so the candidate has to prove it still contains
 * that history before it replaces anything.
 *
 * Host-neutral, like the rest of the store. The CLI renders the report
 * this returns and a web session serializes it; neither decides any of the
 * above for itself, which is the point — two hosts filing chats by
 * different rules would fracture the archive the corpus reads back.
 */

import { mkdir, rename } from 'node:fs/promises'
import * as path from 'node:path'
import { autoRelMessage, mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import { distillMemories } from '#lib/notebook/enrich/distillMemories.ts'
import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import { AI_ERROR_LOG_PATH, logAIError } from '#shared/ai/errorLog.ts'
import { exists, writeTextFile } from '#shared/fs/mod.ts'
import { loadMemories, type MemoryEntry } from '#shared/models/Memory/mod.ts'
import { applyMemoryOps, type MemoryOp, type MemoryOpOutcome } from '#shared/models/Memory/write.ts'
import { dayDir, readDay, writeDay } from '#shared/nbfs/mod.ts'
import type { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { artifactRelEntries } from '../artifactRel.ts'
import { type ContextTurnLog, serializeContextLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { firstWordsSummary, userSpeakerLabel } from '../document/mod.ts'
import { verifyResumeCandidate } from '../document/resume.ts'
import { buildChatTranscript, CHAT_ENRICH } from '../enrich.ts'
import type { ConversationMessage } from '../type.d.ts'
import type { ResumeSession } from './mod.ts'

// -----------------------------------------------------------------------------
// Enrichment — the AI-backed choices a save makes
// -----------------------------------------------------------------------------

/** What the tag and rel choosers read: who wrote it, what it's called, what it says. */
export interface EnrichSubject {
  from: string
  summary: string
  body: string
}

/**
 * The choices that need a model. Injectable so tests run offline — the
 * default is the real corpus-backed implementation, so a host that passes
 * nothing gets the same filing behavior as every other host.
 */
export interface SaveEnricher {
  summarize(transcript: string): Promise<string | undefined>
  chooseTags(subject: EnrichSubject): Promise<string | undefined>
  chooseRel(subject: EnrichSubject): Promise<string[] | undefined>
  /**
   * Distill cross-session memories (ai/memory/ ops) from the finished
   * conversation. Optional: a host that passes no memoryDir never invokes
   * it, and undefined means abstain — the save proceeds without memory ops.
   */
  distillMemories?(transcript: string, memories: MemoryEntry[]): Promise<MemoryOp[] | undefined>
}

export const corpusEnricher: SaveEnricher = {
  summarize: (transcript) => summarizeTranscript(transcript, { kind: CHAT_ENRICH.kind }),
  chooseTags: (subject) => autoTagMessage(subject, CHAT_ENRICH),
  chooseRel: (subject) => autoRelMessage(subject, CHAT_ENRICH),
  distillMemories: (transcript, memories) => distillMemories({ transcript, memories, kind: CHAT_ENRICH.kind }),
}

/**
 * The distiller reads a wider packing than the 8k classifier budget: a
 * remember-request or correction can sit mid-conversation, exactly where the
 * head+tail clip cuts. Still bounded — the save path must stay a save, not a
 * second context assembly.
 */
const MEMORY_TRANSCRIPT_CHARS = 48_000

// -----------------------------------------------------------------------------
// Filenames
// -----------------------------------------------------------------------------

const SLUG_MAX_WORDS = 7

function slugify(text: string, maxWords = SLUG_MAX_WORDS): string {
  // First N words, case preserved, everything non-alphanumeric becoming dashes
  const words = text.trim().split(/\s+/).slice(0, maxWords).join(' ')

  return words
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * `HH-MM_Slugified-Summary.md`. The time key leads so a day's chats sort
 * chronologically by name, which is what listDayChats relies on.
 */
export function chatFilename(startTime: PlainDateTime, summary: string): string {
  return `${startTime.time.replace(':', '-')}_${slugify(summary)}.md`
}

// -----------------------------------------------------------------------------
// Save
// -----------------------------------------------------------------------------

export interface SaveChatInput {
  /** The full conversation, oldest first */
  turns: ConversationMessage[]
  /** Per-turn context log, including entries a resume carried forward */
  contextLog: ContextTurnLog[]
  /** The session being written back, or null for a chat that has no file yet */
  resume: ResumeSession | null
  /** Notebook time root — a new chat files under its day directory */
  timeDir: string
  /** The day the chat files under (--when can shift this off the start stamp) */
  day: PlainDate
  /** Session start: names the file and keys the day-file entry */
  startTime: PlainDateTime
  /** Session end: stamps updated: and any recovery copy */
  endTime: PlainDateTime
  provider: string
  model: string
  /** url → title for external artifacts the session's tools touched */
  externalFiles?: ReadonlyMap<string, string>
  /** Choose tags from the archived-chat corpus when the chat has none */
  autoTag?: boolean
  /** Choose rel from the entity graph when the chat has none */
  autoRel?: boolean
  /** Record the chat as a day-file complete item (new chats only) */
  logToDay?: { category: string } | null
  /**
   * The AI-owned memory store (ai/memory/) — the one notebook space with a
   * standing write license. When set, the save distills the conversation
   * into memory ops and applies them; absent, no memory work happens.
   */
  memoryDir?: string | null
  /** Where a refused write-back parks its transcript; defaults beside the AI error log */
  recoveryDir?: string
  onProgress?: (event: SaveProgress) => void
  /** Test seam — see SaveEnricher */
  enricher?: SaveEnricher
}

/** Emitted before the corpus calls, which are the slow part of a save. */
export type SaveProgress = { type: 'enriching'; choosing: Array<'tags' | 'rel'> }

export type DayLogOutcome =
  | { logged: true; category: string }
  | { logged: false; reason: 'resume' }
  | { logged: false; reason: 'error'; message: string }

export interface SaveChatReport {
  /** Where the transcript landed — the recovery copy when `aborted` is set */
  path: string
  exchanges: number
  resumed: boolean
  /** The title the chat was saved under */
  summary: string
  /** Set when a write-back was refused: the original is untouched */
  aborted?: { originalPath: string; reason: string }
  /** What the corpus chose, when it was asked and answered */
  autoTags?: string
  autoRel?: string[]
  /** Memory distillation outcomes, applied and skipped alike — the host's 🧠 lines */
  memoryOps?: MemoryOpOutcome[]
  /** Present only when logToDay was requested */
  dayLog?: DayLogOutcome
}

export async function saveChat(input: SaveChatInput): Promise<SaveChatReport> {
  const { turns, contextLog, resume, timeDir, day, startTime, endTime } = input
  const enricher = input.enricher ?? corpusEnricher
  const exchanges = Math.floor(turns.length / 2)

  // A resumed chat keeps its saved summary verbatim (filled only when the
  // file lacks one); a new chat is titled here from the packed transcript,
  // whose head-biased packing anchors the title to the opening topic
  // rather than the latest exchange.
  const priorSummary = resume?.summary || undefined
  const firstWords = firstWordsSummary(turns)

  // Hand-written values always win: auto-enrichment fills tags and rel only
  // when the chat (or the file a resume carries forward) has none.
  const priorTags = resume && resume.tags.length > 0 ? resume.tags : undefined
  const priorRel = resume && resume.rel.length > 0 ? resume.rel : undefined
  const wantTags = !priorTags && input.autoTag === true
  const wantRel = !priorRel && input.autoRel === true

  if (wantTags || wantRel) {
    const choosing: Array<'tags' | 'rel'> = []
    if (wantTags) choosing.push('tags')
    if (wantRel) choosing.push('rel')
    input.onProgress?.({ type: 'enriching', choosing })
  }

  const transcript = buildChatTranscript(turns)
  const subject: EnrichSubject = { from: userSpeakerLabel(), summary: priorSummary ?? firstWords, body: transcript }
  const wantMemory = Boolean(input.memoryDir && enricher.distillMemories)
  const [autoSummary, autoTags, autoRel, memoryOps] = await Promise.all([
    priorSummary ? Promise.resolve(undefined) : enricher.summarize(transcript),
    wantTags ? enricher.chooseTags(subject) : Promise.resolve(undefined),
    wantRel ? enricher.chooseRel(subject) : Promise.resolve(undefined),
    // A distillation failure must never fail the save — abstain instead,
    // logged: this catch covers the store read (the distiller logs its own
    // model failures before returning undefined).
    wantMemory
      ? loadMemories(input.memoryDir as string)
          .then((memories) =>
            enricher.distillMemories!(buildChatTranscript(turns, { maxChars: MEMORY_TRANSCRIPT_CHARS }), memories),
          )
          .catch(async (err) => {
            await logAIError({ source: 'ai:chat', stage: 'memory', message: (err as Error).message })
            return undefined
          })
      : Promise.resolve(undefined),
  ])
  const summary = priorSummary ?? autoSummary ?? firstWords

  let savePath: string
  if (resume) {
    // Write back to the original file: filename and created stay stable
    // (day-file links and the chats resolver depend on the filename).
    savePath = resume.filePath
  } else {
    const chatsDir = path.join(timeDir, dayDir(day), 'actions', 'ai-chats')
    if (!(await exists(chatsDir))) {
      await mkdir(chatsDir, { recursive: true })
    }
    savePath = path.join(chatsDir, chatFilename(startTime, summary))
  }

  const doc = ChatDocument.create({
    summary,
    messages: turns,
    created: resume?.created ?? startTime.plainDate.ymd,
    updated: endTime.plainDate.ymd,
    provider: input.provider,
    model: input.model,
    // Artifact links ride alongside whichever rel won (hand-written,
    // resumed, or auto) — a session that touched a Google file always
    // records it, deduped against entries already carrying the URL.
    rel: mergeRel(priorRel ?? autoRel, artifactRelEntries(input.externalFiles ?? new Map(), priorRel)),
    tags: priorTags ?? autoTags?.split('; '),
  })

  // Memory ops apply before the transcript serializes so this save's
  // context log records them — as a NEW final entry, never a mutation of a
  // carried-forward one: the resume write-back self-check compares restored
  // entries byte-for-byte. The memory files themselves are written even if
  // a resume write-back is later refused — the conversation happened, and
  // the refusal gate protects the original transcript, not the store.
  let logEntries = contextLog
  let memoryOutcomes: MemoryOpOutcome[] | undefined
  if (input.memoryDir && memoryOps && memoryOps.length > 0) {
    memoryOutcomes = await applyMemoryOps({
      memoryDir: input.memoryDir,
      ops: memoryOps,
      today: endTime.plainDate.ymd,
      source: path.relative(path.dirname(timeDir), savePath),
    })
    logEntries = [...contextLog, { turn: contextLog.at(-1)?.turn ?? 0, queries: [], memory: memoryOutcomes }]
  }

  // The per-turn context log trails as hidden comments — resume reads it
  // back via splitContextLog, and the format is locked byte for byte by
  // contextLog_test.ts.
  const markdown = doc.toMarkdown() + serializeContextLog(logEntries)

  const report: SaveChatReport = { path: savePath, exchanges, resumed: resume !== null, summary }
  if (autoTags) report.autoTags = autoTags
  if (autoRel) report.autoRel = autoRel
  if (memoryOutcomes && memoryOutcomes.length > 0) report.memoryOps = memoryOutcomes

  if (resume) {
    const refusal = await refuseWriteBack(resume, markdown)
    if (refusal) {
      report.path = await writeRecoveryCopy(markdown, endTime, input.recoveryDir)
      report.aborted = { originalPath: resume.filePath, reason: refusal }
      return report
    }
    // Atomic replace: a crash mid-write must never leave a truncated
    // transcript at the original path.
    const tmpPath = path.join(path.dirname(savePath), `.${path.basename(savePath)}.resume-tmp`)
    await writeTextFile(tmpPath, markdown)
    await rename(tmpPath, savePath)
  } else {
    await writeTextFile(savePath, markdown)
  }

  if (input.logToDay) {
    report.dayLog = await logChatToDay({
      day,
      startTime,
      summary,
      savePath,
      category: input.logToDay.category,
      resumed: resume !== null,
    })
  }

  return report
}

/** The reason a resumed session must not overwrite its file, or null to proceed. */
async function refuseWriteBack(resume: ResumeSession, markdown: string): Promise<string | null> {
  if (!resume.frontmatterHealthy) {
    return 'its frontmatter is malformed and a rewrite would lose data'
  }
  const check = verifyResumeCandidate(markdown, resume.state)
  return check.ok ? null : `the write-back self-check failed (${check.reason})`
}

/**
 * Park a refused transcript somewhere durable. The session's work is real
 * even when the original file can't accept it, so losing it to a failed
 * gate would be the worse outcome by far.
 */
async function writeRecoveryCopy(markdown: string, endTime: PlainDateTime, recoveryDir?: string): Promise<string> {
  const dir = recoveryDir ?? path.dirname(AI_ERROR_LOG_PATH)
  await mkdir(dir, { recursive: true })
  const name = `resume-recovery_${endTime.plainDate.ymd}_${endTime.time.replace(':', '-')}.md`
  const recoveryPath = path.join(dir, name)
  await writeTextFile(recoveryPath, markdown)
  return recoveryPath
}

/**
 * Record the chat as a complete item on its day. Skipped on resume: the
 * chat was logged when it was first saved, and a second time key would
 * duplicate it. A day-file failure never fails the save — the transcript
 * is already on disk by this point.
 */
async function logChatToDay(input: {
  day: PlainDate
  startTime: PlainDateTime
  summary: string
  savePath: string
  category: string
  resumed: boolean
}): Promise<DayLogOutcome> {
  if (input.resumed) return { logged: false, reason: 'resume' }

  try {
    const relativePath = `actions/ai-chats/${path.basename(input.savePath)}`
    const key = `${input.startTime.time} > AI Chat`
    const value = `[${input.summary}](${relativePath})`

    let dayDoc = await readDay(input.day)
    dayDoc = dayDoc.setCompleteItem(key, value, { time: input.startTime.time, category: input.category })
    await writeDay(dayDoc)

    return { logged: true, category: input.category }
  } catch (err) {
    return { logged: false, reason: 'error', message: (err as Error).message }
  }
}
