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
import { distillPersonFactsFromText } from '#lib/notebook/enrich/distillPersonFacts.ts'
import {
  type DocumentRelInput,
  documentTimeRef,
  mergeDocumentRel,
  resolveDocumentRel,
} from '#lib/notebook/enrich/documentRel.ts'
import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import { serviceDocumentIO } from '#lib/service/documents.ts'
import { AI_ERROR_LOG_PATH, logAIError } from '#shared/ai/errorLog.ts'
import { exists, writeTextFile } from '#shared/fs/mod.ts'
import { unclosedFence } from '#shared/models/Markdown/Document/_stripHtmlComments.ts'
import { type Attachment, mergeAttachments } from '#shared/models/Markdown/Document/attachment.ts'
import { loadMemories, type MemoryEntry } from '#shared/models/Memory/mod.ts'
import { applyMemoryOps, type MemoryOp, type MemoryOpOutcome } from '#shared/models/Memory/write.ts'
import {
  applyPersonFacts,
  type DocumentIO,
  type PersonFacts,
  type PersonOpOutcome,
  type PersonSubjectRef,
  type UnlistedPerson,
} from '#shared/models/Person/write.ts'
import { dayAIChatsDir, readDay, writeDay } from '#shared/nbfs/mod.ts'
import type { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { artifactRelEntries } from '../artifactRel.ts'
import { type ContextTurnLog, serializeContextLog } from '../document/ContextLog/mod.ts'
import { branchDir } from '../document/lineage.ts'
import ChatDocument, { type ChatParent, firstWordsSummary, userSpeakerLabel } from '../document/mod.ts'
import { universeOf, verifyResumeCandidate } from '../document/resume.ts'
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
  /** Ground overt conversational references to notebook files, including on resume. */
  chooseDocumentRel?(input: DocumentRelInput): Promise<string[] | undefined>
  /**
   * Distill cross-session memories (ai/memory/ ops) from the finished
   * conversation. Optional: a host that passes no memoryDir never invokes
   * it, and undefined means abstain — the save proceeds without memory ops.
   */
  distillMemories?(transcript: string, memories: MemoryEntry[]): Promise<MemoryOp[] | undefined>
  /**
   * Discover who the conversation discussed and distill durable person
   * facts (people/ profile ops) for them. Owns its subject discovery so the
   * save needs no people transport of its own. Optional: a host that does
   * not opt into `people` never invokes it, and undefined means abstain —
   * the save proceeds without profile ops.
   */
  distillPersonFacts?(transcript: string, today: string): Promise<PersonSaveDistill | undefined>
}

/** What a person distillation hands the save: who was seen, what was learned. */
export interface PersonSaveDistill {
  subjects: PersonSubjectRef[]
  facts: PersonFacts[]
  unlisted: UnlistedPerson[]
}

export const corpusEnricher: SaveEnricher = {
  summarize: (transcript) => summarizeTranscript(transcript, { kind: CHAT_ENRICH.kind }),
  chooseTags: (subject) => autoTagMessage(subject, CHAT_ENRICH),
  chooseRel: (subject) => autoRelMessage(subject, CHAT_ENRICH),
  chooseDocumentRel: resolveDocumentRel,
  distillMemories: (transcript, memories) => distillMemories({ transcript, memories, kind: CHAT_ENRICH.kind }),
  // Discovery + distill live in the lib (shared with meeting:new): subjects
  // resolve through the service's people index, so people/ vs people-old/
  // never reaches this side, and the user is never their own subject.
  distillPersonFacts: (transcript, today) =>
    distillPersonFactsFromText({ text: transcript, today, userLabel: userSpeakerLabel(), kind: CHAT_ENRICH.kind }),
}

/**
 * The distillers read a wider packing than the 8k classifier budget: a
 * remember-request, a correction, or the one biographical aside can sit
 * mid-conversation, exactly where the head+tail clip cuts. Still bounded —
 * the save path must stay a save, not a second context assembly.
 */
const DISTILL_TRANSCRIPT_CHARS = 48_000

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

/**
 * Where a new chat files: in its day's chats folder, or — for a branch —
 * in the folder beside its parent, carrying the parent's name. The
 * notebook root is the time directory's parent, the footing parent keys
 * are written on.
 */
export function chatFilePath(input: {
  timeDir: string
  day: PlainDate
  startTime: PlainDateTime
  summary: string
  parent?: ChatParent | null
}): string {
  const name = chatFilename(input.startTime, input.summary)
  if (input.parent) return path.join(branchDir(path.join(path.dirname(input.timeDir), input.parent.chat)), name)
  return path.join(input.timeDir, dayAIChatsDir(input.day), name)
}

// -----------------------------------------------------------------------------
// Save
// -----------------------------------------------------------------------------

export interface SaveChatInput {
  /** The full conversation, oldest first — a branch's parent turns included */
  turns: ConversationMessage[]
  /** Per-turn context log, including entries a resume carried forward */
  contextLog: ContextTurnLog[]
  /** The session being written back, or null for a chat that has no file yet */
  resume: ResumeSession | null
  /**
   * For a new branch: the chat it left and the turn it left after. The
   * file holds only what follows — the shared turns stay in the parent's
   * file — and it lands in the folder beside the parent. A resumed branch
   * carries this on its resume instead.
   */
  parent?: ChatParent | null
  /** Messages at the head of `turns` that are the parent's; left out of the file. A resume carries its own count. */
  inherited?: number
  /**
   * A title chosen before the save — a branch pins its family's name on
   * the parent so the folder is known. Wins over the saved summary and
   * the titler alike.
   */
  title?: string
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
  /** Files the session's tools copied into the day's attachments */
  attachments?: readonly Attachment[]
  /** Durable approval keys the session holds (already seeded from any resume) */
  approvals?: readonly string[]
  /** Choose tags from the archived-chat corpus when the chat has none */
  autoTag?: boolean
  /** Suggest entities when rel is empty, and add explicitly referenced notebook records on every save */
  autoRel?: boolean
  /** Record the chat as a day-file complete item (new chats only) */
  logToDay?: { category: string } | null
  /**
   * The AI-owned memory store (ai/memory/) — the one notebook space with a
   * standing write license. When set, the save distills the conversation
   * into memory ops and applies them; absent, no memory work happens.
   */
  memoryDir?: string | null
  /**
   * Distill durable person facts and curate the people/ profiles of
   * whoever the conversation discussed — resolved and written through the
   * notebook service, never deleting (see models/Person/write.ts). Off by
   * default; no profile work happens unless set.
   */
  people?: boolean
  /** Test seam: the document transport profile writes go through */
  personIO?: DocumentIO
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
  /** Person-profile distillation outcomes, applied and skipped alike — the host's 👤 lines */
  personOps?: PersonOpOutcome[]
  /** Present only when logToDay was requested */
  dayLog?: DayLogOutcome
}

export async function saveChat(input: SaveChatInput): Promise<SaveChatReport> {
  const { resume, timeDir, day, startTime, endTime } = input
  const enricher = input.enricher ?? corpusEnricher

  // A branch writes only its own turns and its own log entries: the turns
  // it inherited are its parent's, in the parent's file. A chat that began
  // on its own writes everything — and so does a new branch whose parent
  // never got a file (discarded before the branch saved): the shared turns
  // have nowhere else to live, so the branch becomes a chat of its own,
  // whole, filed under its day, with no parent to point at.
  let parent = resume ? resume.parent : (input.parent ?? null)
  if (parent && !resume && !(await exists(path.join(path.dirname(timeDir), parent.chat)))) parent = null
  const inherited = parent ? (resume ? resume.inherited : (input.inherited ?? 0)) : 0
  const turns = input.turns.slice(inherited)
  const contextLog = parent ? input.contextLog.filter((entry) => entry.turn > parent.turn) : input.contextLog
  const exchanges = Math.floor(turns.length / 2)

  // A pinned title wins; a resumed chat keeps its saved summary verbatim
  // (filled only when the file lacks one); a new chat is titled here from
  // the packed transcript of its own turns, whose head-biased packing
  // anchors the title to the opening topic rather than the latest exchange.
  const priorSummary = input.title?.trim() || resume?.summary || undefined
  const firstWords = firstWordsSummary(turns)

  // Existing tags and entity relationships win. Referenced notebook records
  // are additive on every save, including when an earlier session had rel.
  const priorTags = resume && resume.tags.length > 0 ? resume.tags : undefined
  const priorRel = resume && resume.rel.length > 0 ? resume.rel : undefined
  const wantTags = !priorTags && input.autoTag === true
  const wantRel = !priorRel && input.autoRel === true
  const wantDocumentRel = input.autoRel === true && Boolean(enricher.chooseDocumentRel)
  const baseDir = path.dirname(timeDir)

  if (wantTags || wantRel || wantDocumentRel) {
    const choosing: Array<'tags' | 'rel'> = []
    if (wantTags) choosing.push('tags')
    if (wantRel || wantDocumentRel) choosing.push('rel')
    input.onProgress?.({ type: 'enriching', choosing })
  }

  const transcript = buildChatTranscript(turns)
  const subject: EnrichSubject = { from: userSpeakerLabel(), summary: priorSummary ?? firstWords, body: transcript }
  const wantMemory = Boolean(input.memoryDir && enricher.distillMemories)
  const wantPeople = Boolean(input.people && enricher.distillPersonFacts)
  const distillTranscript =
    wantMemory || wantPeople ? buildChatTranscript(turns, { maxChars: DISTILL_TRANSCRIPT_CHARS }) : ''
  const [autoSummary, autoTags, autoRel, documentRel, memoryOps, personDistill] = await Promise.all([
    priorSummary ? Promise.resolve(undefined) : enricher.summarize(transcript),
    wantTags ? enricher.chooseTags(subject) : Promise.resolve(undefined),
    wantRel ? enricher.chooseRel(subject) : Promise.resolve(undefined),
    wantDocumentRel
      ? enricher.chooseDocumentRel!({
          turns,
          today: endTime.plainDate.ymd,
          baseDir,
          // A branch can refer to a record its parent had in context, but
          // only its own conversation supplies references to be filed.
          contextPaths: universeOf(input.contextLog),
          excludePaths: resume ? [resume.filePath] : [],
        }).catch(async (err) => {
          await logAIError({ source: 'ai:chat', stage: 'rel:documents', message: (err as Error).message })
          return undefined
        })
      : Promise.resolve(undefined),
    // A distillation failure must never fail the save — abstain instead,
    // logged: this catch covers the store read (the distiller logs its own
    // model failures before returning undefined).
    wantMemory
      ? loadMemories(input.memoryDir as string)
          .then((memories) => enricher.distillMemories!(distillTranscript, memories))
          .catch(async (err) => {
            await logAIError({ source: 'ai:chat', stage: 'memory', message: (err as Error).message })
            return undefined
          })
      : Promise.resolve(undefined),
    // Same abstain contract for the CRM — the enricher owns its subject
    // discovery, so this catch is the whole safety net around it.
    wantPeople
      ? enricher.distillPersonFacts!(distillTranscript, endTime.plainDate.ymd).catch(async (err) => {
          await logAIError({ source: 'ai:chat', stage: 'people', message: (err as Error).message })
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
    savePath = chatFilePath({ timeDir, day, startTime, summary, parent })
    const chatsDir = path.dirname(savePath)
    if (!(await exists(chatsDir))) {
      await mkdir(chatsDir, { recursive: true })
    }
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
    rel: mergeDocumentRel(
      mergeRel(priorRel ?? autoRel, artifactRelEntries(input.externalFiles ?? new Map(), priorRel)),
      documentRel,
      baseDir,
      (resume && documentTimeRef(resume.filePath, baseDir)?.slice(0, 10)) || day.ymd,
    ),
    tags: priorTags ?? autoTags?.split('; '),
    // Files read into the session join whatever the resumed file already
    // listed — a document is recorded once however many sessions read it.
    attachments: mergeAttachments(resume?.attachments, input.attachments),
    // Union with the file's own keys so a host that never wires approvals
    // writes a resumed session back without erasing what the file recorded.
    approvals: [...new Set([...(resume?.approvals ?? []), ...(input.approvals ?? [])])],
    parent,
  })

  // Memory and profile ops apply before the transcript serializes so this
  // save's context log records them — as a NEW final entry, never a
  // mutation of a carried-forward one: the resume write-back self-check
  // compares restored entries byte-for-byte. The memory and profile files
  // themselves are written even if a resume write-back is later refused —
  // the conversation happened, and the refusal gate protects the original
  // transcript, not the stores.
  let logEntries = contextLog
  let memoryOutcomes: MemoryOpOutcome[] | undefined
  if (input.memoryDir && memoryOps && memoryOps.length > 0) {
    memoryOutcomes = await applyMemoryOps({
      memoryDir: input.memoryDir,
      ops: memoryOps,
      today: endTime.plainDate.ymd,
      source: path.relative(path.dirname(timeDir), savePath),
    })
  }
  let personOutcomes: PersonOpOutcome[] | undefined
  if (personDistill && (personDistill.facts.length > 0 || personDistill.unlisted.length > 0)) {
    personOutcomes = await applyPersonFacts({
      facts: personDistill.facts,
      unlisted: personDistill.unlisted,
      subjects: personDistill.subjects,
      today: endTime.plainDate.ymd,
      io: input.personIO ?? serviceDocumentIO(),
    })
  }
  if ((memoryOutcomes && memoryOutcomes.length > 0) || (personOutcomes && personOutcomes.length > 0)) {
    logEntries = [
      ...contextLog,
      {
        turn: contextLog.at(-1)?.turn ?? 0,
        queries: [],
        ...(memoryOutcomes && memoryOutcomes.length > 0 ? { memory: memoryOutcomes } : {}),
        ...(personOutcomes && personOutcomes.length > 0 ? { people: personOutcomes } : {}),
      },
    ]
  }

  // The per-turn context log trails as hidden comments — resume reads it
  // back via splitContextLog, and the format is locked byte for byte by
  // contextLog_test.ts. A body ending inside an open code fence (a reply
  // truncated mid-block, a pasted stray ```) would shield those comments
  // from stripping and render them as visible code, so the fence is sealed
  // first. The closer joins the body: splitContextLog hands it back as
  // conversation text, so resumes carry it and never re-seal.
  const fence = unclosedFence(doc.markdown)
  const seal = fence ? `${fence.marker.repeat(fence.length)}\n` : ''
  const markdown = doc.toMarkdown() + seal + serializeContextLog(logEntries)

  const report: SaveChatReport = { path: savePath, exchanges, resumed: resume !== null, summary }
  if (autoTags) report.autoTags = autoTags
  const chosenRel = mergeRel(autoRel, documentRel)
  if (chosenRel) report.autoRel = chosenRel
  if (memoryOutcomes && memoryOutcomes.length > 0) report.memoryOps = memoryOutcomes
  if (personOutcomes && personOutcomes.length > 0) report.personOps = personOutcomes

  if (resume) {
    // The gate compares the file's own turns, never the joined thread a branch is.
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
  const check = verifyResumeCandidate(markdown, resume.own)
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
    // A branch's file lives beside its parent, which may be another day's;
    // the link is relative to the day the item is on either way.
    const dayDirPath = path.dirname(path.join(input.savePath.split('/actions/')[0], 'day.md'))
    const relativePath = path.relative(dayDirPath, input.savePath)
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
