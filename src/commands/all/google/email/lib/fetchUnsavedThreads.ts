import { Buffer } from 'node:buffer'
import * as path from 'node:path'
import type { CommandService } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import type { GoogleClient } from '#lib/google/mod.ts'
import { getAttachment, getMessage, threadIdToDecimal } from '#lib/google/mod.ts'
import type { GmailMessage } from '#lib/google/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { autoRelMessage } from '#lib/notebook/enrich/autoRel.ts'
import { autoTagMessage } from '#lib/notebook/enrich/autoTag.ts'
import { summarizeTranscript } from '#lib/notebook/enrich/summarize.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import EmailDocument from '#shared/models/Email/mod.ts'
import type { FollowMessage } from '#shared/models/Follow/mod.ts'
import { computePreviousRef, convertToNotebookTimezone, fetchNow, resolveTimeRef } from '#shared/nbfs/mod.ts'
import type { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { copyEmailFilesToAttachments } from '../../../email/lib/copyToAttachments.ts'
import type { DownloadedAttachment } from '../../../email/lib/copyToAttachments.ts'
import { emailToMarkdown } from '../../../email/lib/emailToMarkdown.ts'
import { buildEmailTranscript, EMAIL_ENRICH } from './enrich.ts'
import { followFileName, uniqueFollowFileName } from './followLifecycle.ts'
import { getInboxThreads, LISTING_DEPTH } from './getInboxThreads.ts'
import type { InboxThreadsResult } from './getInboxThreads.ts'

// Gmail-API twin of email/lib/fetchUnsavedThreads.ts. Phase 2 (downloading
// bodies and attachments) is the only transport-bound part; the notebook side
// (grouping, previous refs, tag/rel inheritance, email:new) is duplicated
// verbatim so the two pipelines stay diffable until the IMAP one retires.

export type FetchedThread = {
  /** Decimal rendering (the X-GM-THRID form follow files store). */
  threadId: string
  from: string
  subject: string
  /** Topic label written to the captures, and to the follow that tracks them. Absent on a continuation. */
  summary?: string
  /** Follow file name (extension-free) stamped into this thread's captures — set only when following. */
  followFile?: string
  /** Day files written to — created, or an earlier run's same-day file continued. Same-day messages share one, so this is not a message count. */
  messages: { date: string; path: string }[]
  /** Messages actually captured this run — what the closing report counts. */
  captured: number
  /** Newest downloaded message's real time (notebook tz, "YYYY-MM-DD HH:mm") — the follow's lastActivity anchor. */
  lastMessageAt?: string
  /** A message's AI conversion threw — leave the thread in the inbox so the next sync retries it. */
  failed?: boolean
}

export type FetchUnsavedResult = { fetched: number; threads: FetchedThread[]; labelId: string }

export type FetchUnsavedOptions = {
  label: string
  /** Max UNSAVED threads to capture this run — the backlog drains newest-first across runs. */
  limit: number
  /** Collapse all messages to this date */
  when?: PlainDateTime
  /** Fetch a specific thread by its decimal id */
  threadId?: string
  /** Thread listing already scanned on this client — skips the label rescan */
  inbox?: InboxThreadsResult
  /** The caller will follow captured threads: stamp captures with their follow's file name */
  follow?: boolean
  /** Skip the tag proposal on first capture (the summary is not a tag and still runs) */
  noAutoTag?: boolean
  /** Skip the rel proposal on first capture */
  noAutoRel?: boolean
}

type Output = { log: (msg: string) => void }

type DownloadedMessage = GmailMessage & {
  downloadedAttachments: DownloadedAttachment[]
}

/**
 * Core of google:email:inbox:fetch: find unsaved threads, download bodies +
 * attachments, and save them to day files. Stateless HTTPS per call — there
 * is no connection for the caller to own, unlike the IMAP original.
 */
export async function fetchUnsavedThreads(
  client: GoogleClient,
  opts: FetchUnsavedOptions,
  deps: { tasks: CommandService; output: Output },
): Promise<FetchUnsavedResult> {
  const { label, limit, when: whenOverride, threadId: filterThreadId } = opts
  const { tasks, output } = deps

  // ── Phase 1: Get threads (same as inbox:view) ──────────────────
  // The listing goes deep and `limit` bounds the UNSAVED set below. Bounding
  // the listing itself starved: captured threads keep the label, so the
  // newest-first listing tops out with saved threads and an unsaved thread
  // deeper than the limit was unreachable on every run.
  const { threads, labelId } = opts.inbox ?? (await getInboxThreads(client, label, { limit: LISTING_DEPTH }))

  // Filter to target threads
  let unsaved = threads.filter((t) => !t.saved)
  if (filterThreadId) {
    unsaved = threads.filter((t) => t.threadId === filterThreadId)
  } else if (unsaved.length > limit) {
    output.log(`  Capturing ${limit} of ${unsaved.length} unsaved thread(s) — rerun to continue the backlog.`)
    unsaved = unsaved.slice(0, limit)
  }

  if (unsaved.length === 0) {
    output.log('  All threads are saved. Nothing to fetch.\n')
    return { fetched: 0, threads: [], labelId }
  }

  const totalNew = unsaved.reduce((n, t) => n + t.messages.filter((m) => !m.saved).length, 0)
  output.log(`  ${unsaved.length} unsaved thread(s), ${totalNew} message(s) to download...\n`)

  // ── Phase 2: Download bodies for unsaved messages only ─────────
  const downloaded: DownloadedMessage[] = []

  for (const thread of unsaved) {
    for (const msg of thread.messages) {
      if (msg.saved) continue

      output.log(`  Downloading message ${downloaded.length + 1}/${totalNew}...`)
      let full: GmailMessage
      try {
        full = await getMessage(client, msg.id, { format: 'full' })
      } catch (err) {
        // A message can vanish between listing and download; the thread stays
        // unsaved so the next run retries it.
        output.log(`  Warning: download failed (${(err as Error).message}) — skipping message`)
        continue
      }

      const downloadedAttachments: DownloadedAttachment[] = []
      for (const att of full.attachments) {
        try {
          const data = await getAttachment(client, full.id, att.attachmentId)
          if (data.length > 0) {
            downloadedAttachments.push({ filename: att.filename, data: Buffer.from(data) })
            output.log(`  Downloaded: ${att.filename} (${Math.round(data.length / 1024)}KB)`)
          }
        } catch (err) {
          output.log(`  Attachment download failed (${att.filename}): ${(err as Error).message}`)
        }
      }

      downloaded.push({ ...full, downloadedAttachments })
    }
  }

  // Sort chronologically
  downloaded.sort((a, b) => {
    const dateA = a.date instanceof Date ? a.date.getTime() : 0
    const dateB = b.date instanceof Date ? b.date.getTime() : 0
    return dateA - dateB
  })

  // ── Phase 3: Save to day files ─────────────────────────────────
  output.log(`\n  Saving ${downloaded.length} message(s)...\n`)

  // Group by thread (decimal id — the rendering follow files store)
  const byThread = new Map<string, DownloadedMessage[]>()
  for (const msg of downloaded) {
    const tid = threadIdToDecimal(msg.threadId)
    const group = byThread.get(tid) ?? []
    group.push(msg)
    byThread.set(tid, group)
  }

  // The thread's last capture on record (from its follow): what a new day's
  // file points back to, and what a same-day message appends to.
  const previousByThread = new Map<string, FollowMessage>()
  const followFileByThread = new Map<string, string>()
  for (const thread of threads) {
    const lastSaved = thread.savedMessages.at(-1)
    if (lastSaved) previousByThread.set(thread.threadId, lastSaved)
    if (thread.followFile) followFileByThread.set(thread.threadId, thread.followFile)
  }

  const createdEntries = new Map<string, { date: string; path: string }>()
  const resultThreads: FetchedThread[] = []
  // Follow names minted this run — two new threads must never share one.
  const mintedFollowNames = new Set<string>()
  let savedCount = 0

  for (const [threadId, threadMessages] of byThread) {
    const threadEntries: { date: string; path: string }[] = []
    const previous = previousByThread.get(threadId)
    const subject = threadMessages[0].subject || '(no subject)'

    // Inherit summary/tags/rel from previous message file (propagate across
    // syncs): a thread reads as one conversation however many days it spans.
    let inheritedSummary: string | undefined
    let inheritedTags: string | undefined
    let inheritedRel: unknown
    // Conversion context: a reply quotes the thread so far, and the converter
    // strips what is already captured. Messages captured by earlier runs live
    // in the thread's last capture file — seed its sections, or a reply
    // arriving on a later tick keeps the entire quoted history in its
    // capture. An unreadable file seeds nothing and costs nothing else.
    const priorMarkdown: string[] = []
    if (previous) {
      try {
        // Follows store time refs (or, older ones, paths in any layout);
        // resolveTimeRef turns either into the file's real place today.
        const prevDoc = EmailDocument.fromMarkdown(
          await readTextFile(path.join(DIR_BASE, resolveTimeRef(previous.path))),
        )
        inheritedSummary = nonEmpty(prevDoc.yaml['summary'])
        inheritedTags = prevDoc.yaml['tags'] as string | undefined
        inheritedRel = prevDoc.yaml['rel']
        priorMarkdown.push(...captureSections(prevDoc.markdown))
      } catch {
        /* previous file may not exist */
      }
    }

    // Convert first, write second: the thread's summary, tags and rel are
    // decided over its whole transcript, and that has to exist before the
    // first file is written. A conversion that throws keeps the messages
    // converted so far and leaves the thread in the inbox to retry the rest.
    const converted: ConvertedMessage[] = []
    let failed = false
    for (const msg of threadMessages) {
      try {
        converted.push(await convertMessage(msg, priorMarkdown, whenOverride, output))
      } catch (err) {
        output.log(`  Warning: conversion failed (${(err as Error).message}) — thread left in inbox for retry`)
        failed = true
        break
      }
    }

    // Enrichment runs on a thread's first capture only — later messages
    // inherit, so one thread never carries two sets of tags.
    const enriched = previous
      ? {}
      : await enrichThread({ subject, converted, noAutoTag: !!opts.noAutoTag, noAutoRel: !!opts.noAutoRel, output })

    const summary = inheritedSummary ?? enriched.summary
    const tags = inheritedTags ?? enriched.tags
    const rel = inheritedRel ?? enriched.rel
    const from = normalizeFromName(threadMessages[0].from?.name || threadMessages[0].from?.address || 'unknown')

    // The follow's name flows forward into every capture — the existing
    // follow's own name, or the one the new follow will take (planThreadFollow
    // reuses it, so stamp and YAML can never drift). A plain fetch creates no
    // follow, so there is nothing to reference and nothing is stamped.
    const followFile = opts.follow
      ? (followFileByThread.get(threadId) ??
        (await uniqueFollowFileName(
          followFileName((await fetchNow()).plainDateTime, from, summary ?? subject),
          mintedFollowNames,
        )))
      : undefined

    for (const message of converted) {
      let result: { date: string; path: string } | null
      try {
        result = await writeMessage(message, {
          threadId,
          createdEntries,
          previous,
          summary,
          followFile,
          tags,
          rel,
          tasks,
          output,
        })
      } catch (err) {
        // Same fail-and-retry rule as conversion: one thread's bad write must
        // not cost every other thread of the run, and the inbox still holds it.
        output.log(`  Warning: save failed (${(err as Error).message}) — thread left in inbox for retry`)
        failed = true
        break
      }
      if (result) {
        threadEntries.push(result)
        createdEntries.set(`${threadId}_${result.date}`, result)
      }
      savedCount++
    }

    // The newest message's real time: follows anchor lastActivity here, so a
    // thread discovered late must not look freshly active (--when collapses
    // file dates, never this).
    const newestDate = threadMessages.reduce<Date | undefined>(
      (newest, m) => (m.date instanceof Date && (!newest || m.date > newest) ? m.date : newest),
      undefined,
    )
    const lastMessageAt = newestDate ? await convertToNotebookTimezone(newestDate) : undefined

    resultThreads.push({
      threadId,
      from,
      subject,
      ...(enriched.summary ? { summary: enriched.summary } : {}),
      ...(followFile ? { followFile } : {}),
      messages: threadEntries,
      captured: converted.length,
      ...(lastMessageAt ? { lastMessageAt: `${lastMessageAt.date} ${lastMessageAt.time}` } : {}),
      ...(failed ? { failed: true } : {}),
    })
  }

  output.log(`\n  Fetched ${savedCount} message(s) across ${resultThreads.length} thread(s).\n`)
  return { fetched: savedCount, threads: resultThreads, labelId }
}

/** One message turned into notebook markdown, not yet written anywhere. */
type ConvertedMessage = {
  msg: DownloadedMessage
  from: string
  to: string
  cc: string
  /** Converted body, empty when the source had none — the `(empty)` placeholder is a write-time concern. */
  markdown: string
  /** The message's own timestamp, in the timezone of the notebook day it arrived on — always the `## ` header. */
  msgWhen: PlainDateTime
  /** The day the capture files under: --when when given, else the message's own. */
  when: PlainDateTime
}

/**
 * Turn one downloaded message into markdown. Sequential within a thread:
 * `priorMarkdown` accumulates the thread so far, which the conversion reads to
 * drop quoted replies.
 */
async function convertMessage(
  msg: DownloadedMessage,
  priorMarkdown: string[],
  whenOverride: PlainDateTime | undefined,
  output: Output,
): Promise<ConvertedMessage> {
  const from = normalizeFromName(msg.from?.name || msg.from?.address || '(unknown)')
  const to =
    msg.to
      ?.map((a) => normalizeFromName(a.name || a.address || ''))
      .filter(Boolean)
      .join(', ') || ''
  const cc =
    msg.cc
      ?.map((a) => normalizeFromName(a.name || a.address || ''))
      .filter(Boolean)
      .join(', ') || ''

  // Convert body to markdown via AI (with thread context for dedup).
  // emailToMarkdown reads only the bodies; uid is a required-but-unused
  // field of the IMAP message shape it was written against.
  const converted = await emailToMarkdown(
    { uid: 0, bodyText: msg.bodyText ?? '', bodyHtml: msg.bodyHtml },
    { priorMessages: priorMarkdown.length > 0 ? priorMarkdown : undefined },
  )

  if (converted.truncated) {
    output.log(
      `  Warning: source is ~${Math.round(converted.sourceChars / 1000)}k chars — too large even converted in windows; the tail stays in Gmail`,
    )
  }

  if (converted.markdown) {
    priorMarkdown.push(converted.markdown)
  }

  const msgWhen = msg.date ? await convertToNotebookTimezone(msg.date) : (await fetchNow()).plainDateTime

  // When --when is passed, all messages go into one file at that date
  // Otherwise, use the message's own date
  return { msg, from, to, cc, markdown: converted.markdown || '', msgWhen, when: whenOverride ?? msgWhen }
}

type WriteContext = {
  threadId: string
  createdEntries: Map<string, { date: string; path: string }>
  /** The thread's last capture on record — absent on a first capture. */
  previous: FollowMessage | undefined
  /** Thread-level topic label — inherited from the thread's earlier captures, or freshly summarized. */
  summary: string | undefined
  /** Follow file name to stamp into the capture's frontmatter — absent on unfollowed fetches. */
  followFile: string | undefined
  tags: string | undefined
  /** String (an email:new param) or array (patched onto the written file). */
  rel: unknown
  tasks: CommandService
  output: Output
}

async function writeMessage(
  message: ConvertedMessage,
  ctx: WriteContext,
): Promise<{ date: string; path: string } | null> {
  const { threadId, createdEntries, previous, summary, followFile, tags, rel, tasks, output } = ctx
  const { msg, from, to, cc, msgWhen, when } = message
  const dateStr = when.plainDate.toString()

  // Save attachments
  const attachments =
    msg.downloadedAttachments.length > 0
      ? await copyEmailFilesToAttachments(msg.downloadedAttachments, when.plainDate, output)
      : []

  // The day's file for this thread, if there is one: created earlier this
  // run, or — the heartbeat case — by an earlier run today. Every tick is
  // its own run, so without the second look a reply hours after the first
  // capture opened a new file instead of continuing the day's conversation.
  const entryKey = `${threadId}_${dateStr}`
  const localEntry = createdEntries.get(entryKey)
  const earlierEntry = localEntry ? undefined : sameDayCapture(previous, dateStr, output)
  const target = localEntry ?? earlierEntry
  if (target && (await appendToCapture(target, message, attachments, output))) {
    // An earlier run's file is reported once: it becomes this run's day entry
    // (later messages append through createdEntries) and a console run opens
    // it; the follow already lists it, so its message list stays deduped.
    return earlierEntry ?? null
  }

  // New day (or a day file that could not be continued): create file + day entry via email:new
  const markdown = `## ${msgWhen.date} ${msgWhen.time} - **${from}**\n\n${message.markdown || '(empty)'}\n`
  const previousRef = previousRefOrNone(previous?.path, when.plainDate, output)

  const result = await tasks.run('email:new', {
    from,
    to: to || undefined,
    ...(cc ? { cc } : {}),
    when,
    subject: msg.subject || '(no subject)',
    // The subject is the fallback label, and stays in `subject:` either way.
    summary: summary ?? msg.subject ?? '',
    ...(followFile ? { follow: followFile } : {}),
    ...(previousRef ? { previous: previousRef } : {}),
    ...(tags ? { tags } : {}),
    ...(typeof rel === 'string' ? { rel } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    markdown,
    noEditor: true,
  })

  if (!result.ok || !result.data) {
    output.log('  Warning: failed to create email entry')
    return null
  }

  const ddfw = new DayDirFileWriter(when.plainDate)
  const entryPath = `time/${ddfw.dayDir}/${result.data.filePath}`

  // Patch YAML fields that can't be fully passed as command params
  const needsAttachmentPatch = attachments.length > 0
  const needsArrayRelPatch = Array.isArray(rel)
  if ((needsAttachmentPatch || needsArrayRelPatch) && result.data.filePath) {
    const fullPath = path.join(ddfw.fullDir, result.data.filePath)
    try {
      const contents = await readTextFile(fullPath)
      let doc = EmailDocument.fromMarkdown(contents)
      if (needsAttachmentPatch && doc.attachments.length === 0) {
        doc = EmailDocument.fromMarkdown(doc.setAttachments(attachments).toMarkdown())
      }
      if (needsArrayRelPatch) {
        doc = new EmailDocument({ ...doc.yaml, rel }, doc.markdown)
      }
      await writeTextFile(fullPath, doc.toMarkdown())
    } catch {
      /* best-effort */
    }
  }

  output.log(`  Created ${entryPath}`)

  return { date: dateStr, path: entryPath }
}

type SavedAttachments = Awaited<ReturnType<typeof copyEmailFilesToAttachments>>

/** Continue the day's file with this message; false when it cannot be read or written (the caller starts a new file). */
async function appendToCapture(
  entry: { date: string; path: string },
  message: ConvertedMessage,
  attachments: SavedAttachments,
  output: Output,
): Promise<boolean> {
  const fullPath = path.join(DIR_BASE, entry.path)
  try {
    const oldDoc = EmailDocument.fromMarkdown(await readTextFile(fullPath))
    const mergedAttachments = [...oldDoc.attachments, ...attachments]
    const appendPart = `\n\n## ${message.msgWhen.date} ${message.msgWhen.time} - **${message.from}**\n\n${message.markdown || '(empty)'}\n`
    const updatedDoc = new EmailDocument(
      {
        ...oldDoc.yaml,
        ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
      },
      oldDoc.markdown,
    )
    await writeTextFile(fullPath, updatedDoc.toMarkdown() + appendPart)
    output.log(`  Appended to ${entry.path}`)
    return true
  } catch (err) {
    output.log(`  Warning: failed to append (${(err as Error).message}) — starting a new file`)
    return false
  }
}

/**
 * The `## <when> - **<from>**` sections of a capture file's body, one string
 * per message — the shape emailToMarkdown takes as already-saved thread
 * context. `(empty)` placeholders and blank sections hold nothing worth
 * deduplicating against and are dropped.
 */
export function captureSections(markdown: string): string[] {
  return markdown
    .split(/^## \d{4}-\d{2}-\d{2} \d{2}:\d{2}.*$/m)
    .map((section) => section.trim())
    .filter((section) => section !== '' && section !== '(empty)')
}

/**
 * The thread's last capture when it is on this message's day — the file the
 * message continues. Follows store time refs (older ones, paths in any
 * layout); an unreadable location means a fresh file, never a lost message.
 */
export function sameDayCapture(
  previous: FollowMessage | undefined,
  dateStr: string,
  output: Output,
): { date: string; path: string } | undefined {
  if (!previous || String(previous.date) !== dateStr) return undefined
  try {
    return { date: dateStr, path: resolveTimeRef(previous.path) }
  } catch {
    output.log(`  Warning: unreadable previous path — starting a new file (${previous.path})`)
    return undefined
  }
}

/**
 * A back-reference to the thread's previous capture — or none when the stored
 * location cannot be read at all.
 *
 * Follows store time refs; older ones store paths, in every layout the
 * notebook has ever written. resolveTimeRef reads all of those, so only true
 * damage lands in the catch — and a back-reference that cannot be computed is
 * a missing `previous:` line, never a reason to drop the capture itself.
 */
export function previousRefOrNone(
  previousPath: string | undefined,
  curDate: PlainDate,
  output: Output,
): string | undefined {
  if (!previousPath) return undefined
  try {
    return computePreviousRef(resolveTimeRef(previousPath), curDate)
  } catch {
    output.log(`  Warning: unreadable previous path — writing without a previous ref (${previousPath})`)
    return undefined
  }
}

type ThreadEnrichment = { summary?: string; tags?: string; rel?: string[] }

/**
 * Summarize a newly captured thread and propose its tags and rel, over the
 * whole transcript rather than any one message — a reply reading "sounds good"
 * is not what the thread is about. Each part degrades on its own: an
 * unusable summary leaves the subject as the label, and tag or rel abstention
 * leaves the field absent.
 */
async function enrichThread(opts: {
  subject: string
  converted: ConvertedMessage[]
  noAutoTag: boolean
  noAutoRel: boolean
  output: Output
}): Promise<ThreadEnrichment> {
  const { subject, converted, output } = opts
  if (converted.length === 0) return {}
  const transcript = buildEmailTranscript(
    subject,
    converted.map((c) => ({ from: c.from, markdown: c.markdown })),
  )
  if (!transcript) return {}

  const summary = await summarizeTranscript(transcript, { kind: EMAIL_ENRICH.kind })
  if (summary) output.log(`  Summary: ${summary}`)

  const first = converted[0]
  const enrichInput = {
    ...(first.to ? { to: first.to } : {}),
    from: first.from,
    summary: summary ?? subject,
    body: transcript,
  }
  const [tags, rel] = await Promise.all([
    opts.noAutoTag ? undefined : autoTagMessage(enrichInput, EMAIL_ENRICH),
    opts.noAutoRel ? undefined : autoRelMessage(enrichInput, EMAIL_ENRICH),
  ])
  if (tags) output.log(`  Auto-tags: ${tags}`)
  if (rel) output.log(`  Auto-rel: ${rel.join('; ')}`)

  return { ...(summary ? { summary } : {}), ...(tags ? { tags } : {}), ...(rel ? { rel } : {}) }
}

/** A YAML field worth inheriting: present, a string, and not blank. */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

/** Convert "Lastname, Firstname" → "Firstname Lastname" */
function normalizeFromName(name: string): string {
  const match = name.match(/^([^,]+),\s*(.+)$/)
  return match ? `${match[2]} ${match[1]}` : name
}
