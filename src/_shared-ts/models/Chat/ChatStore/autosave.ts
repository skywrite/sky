/**
 * Crash insurance for a live chat session: after every completed turn the
 * host snapshots the whole session here, and every clean exit deletes the
 * snapshot again. A file that outlives its process is therefore a session
 * that died mid-conversation — a crash, a kill, a power cut — holding
 * everything up to the last completed turn.
 *
 * A snapshot is written in the exact shape of a saved transcript — the
 * same ChatDocument body with the same trailing context log — so
 * loadResumeSession reads one like any archived chat and a lost session
 * can be continued instead of retyped. What a snapshot never does is
 * enrich: no titling, no tag/rel choosers, no memory ops. Those are
 * save-time decisions (save.ts); this is a dumb serialization of state
 * the session already holds, cheap enough to run on every turn.
 *
 * Host-neutral like the rest of the store: hosts pass their state
 * directory in (the CLI passes DIR_STATE_AI_CHATS), and writes go through
 * a temp-file rename so a crash mid-write can't leave a truncated
 * snapshot where a whole one used to be.
 */

import { mkdir, rename, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { mergeRel } from '#lib/notebook/enrich/autoRel.ts'
import { exists, readDir, writeTextFile } from '#shared/fs/mod.ts'
import { type Attachment, mergeAttachments } from '#shared/models/Markdown/Document/attachment.ts'
import type { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { artifactRelEntries } from '../artifactRel.ts'
import { type ContextTurnLog, serializeContextLog } from '../document/ContextLog/mod.ts'
import ChatDocument, { firstWordsSummary } from '../document/mod.ts'
import type { ConversationMessage } from '../type.d.ts'
import type { ResumeSession } from './mod.ts'

/** Snapshots older than this are nobody's lost session anymore. */
const MAX_AGE_DAYS = 30

/**
 * Leading date + start time + a per-session discriminator, lexically
 * chronological. The terminal passes its pid — one process, one session;
 * a service hosting many threads passes the thread id.
 */
export function chatAutosaveFilename(startTime: PlainDateTime, session: number | string): string {
  return `${startTime.plainDate.ymd}_${startTime.time.replace(':', '-')}_${session}.md`
}

export interface ChatAutosaveInput {
  /** The full conversation so far, oldest first */
  turns: ConversationMessage[]
  /** Per-turn context log, including entries a resume carried forward */
  contextLog: ContextTurnLog[]
  /** The session being continued, or null for a chat that has no file yet */
  resume: ResumeSession | null
  /** Session start: stamps created: for a chat that has no file yet */
  startTime: PlainDateTime
  provider: string
  model: string
  /** url → title for external artifacts the session's tools touched */
  externalFiles?: ReadonlyMap<string, string>
  /** Files the session's tools copied into the day's attachments */
  attachments?: readonly Attachment[]
  /** Durable approval keys the session holds (already seeded from any resume) */
  approvals?: readonly string[]
}

/**
 * Snapshot the session to `filePath`, replacing the previous snapshot.
 * The identity fields mirror what a save would write — a resumed session
 * keeps its file's summary, tags, rel, and created date — but nothing is
 * chosen here: fields the session doesn't already hold stay empty until a
 * real save fills them.
 */
export async function writeChatAutosave(filePath: string, input: ChatAutosaveInput): Promise<void> {
  const priorRel = input.resume && input.resume.rel.length > 0 ? input.resume.rel : undefined
  const priorTags = input.resume && input.resume.tags.length > 0 ? input.resume.tags : undefined

  const doc = ChatDocument.create({
    summary: input.resume?.summary || firstWordsSummary(input.turns),
    messages: input.turns,
    created: input.resume?.created ?? input.startTime.plainDate.ymd,
    // Turn stamps are notebook datetimes (`YYYY-MM-DD HH:MM`), so the
    // latest one's date is the last day this chat moved.
    updated: input.turns.at(-1)?.when?.slice(0, 10) ?? input.startTime.plainDate.ymd,
    provider: input.provider,
    model: input.model,
    rel: mergeRel(priorRel, artifactRelEntries(input.externalFiles ?? new Map(), priorRel)),
    tags: priorTags,
    attachments: mergeAttachments(input.resume?.attachments, input.attachments),
    // Union with the file's own keys so a host that never wires approvals
    // snapshots a resumed session without erasing what the file recorded.
    approvals: [...new Set([...(input.resume?.approvals ?? []), ...(input.approvals ?? [])])],
  })
  const markdown = doc.toMarkdown() + serializeContextLog(input.contextLog)

  // Atomic replace: a crash mid-write must never leave a truncated snapshot.
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = tmpPathFor(filePath)
  await writeTextFile(tmpPath, markdown)
  await rename(tmpPath, filePath)
}

/**
 * Drop the snapshot (and any temp file beside it) on a clean exit.
 * Best-effort by design: a clear that fails leaves a stale file for the
 * sweep to reap, and must never turn a finished session into an error.
 */
export async function clearChatAutosave(filePath: string): Promise<void> {
  try {
    await rm(tmpPathFor(filePath), { force: true })
    await rm(filePath, { force: true })
  } catch {
    // Reaped by sweepChatAutosaves eventually.
  }
}

/**
 * Reap snapshots (and orphaned temp files) whose leading date is more
 * than `maxAgeDays` before `today` — leftovers of crashed sessions nobody
 * came back for. Files without a leading date aren't ours to touch.
 * Returns how many were removed; a missing directory is an empty one.
 */
export async function sweepChatAutosaves(dir: string, today: PlainDate, maxAgeDays = MAX_AGE_DAYS): Promise<number> {
  if (!(await exists(dir))) return 0
  const cutoff = today.addDays(-maxAgeDays).ymd

  let removed = 0
  for await (const entry of readDir(dir)) {
    if (!entry.isFile) continue
    const dated = entry.name.match(/^\.?(\d{4}-\d{2}-\d{2})_/)
    if (!dated || dated[1] >= cutoff) continue
    await rm(path.join(dir, entry.name), { force: true })
    removed++
  }
  return removed
}

/** The deterministic temp name a write renames from (`.name.md.tmp`, same dir). */
function tmpPathFor(filePath: string): string {
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp`)
}
