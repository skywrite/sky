import { Buffer } from 'node:buffer'
import * as path from 'node:path'
import type { CommandService } from '#commands/mod.ts'
import { DIR_BASE } from '#config'
import type { GoogleClient } from '#lib/google/mod.ts'
import { getAttachment, getMessage, threadIdToDecimal } from '#lib/google/mod.ts'
import type { GmailMessage } from '#lib/google/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import EmailDocument from '#shared/models/Email/mod.ts'
import { computePreviousRef, convertToNotebookTimezone, fetchNow } from '#shared/nbfs/mod.ts'
import type { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { copyEmailFilesToAttachments } from '../../../email/lib/copyToAttachments.ts'
import type { DownloadedAttachment } from '../../../email/lib/copyToAttachments.ts'
import { emailToMarkdown } from '../../../email/lib/emailToMarkdown.ts'
import { getInboxThreads } from './getInboxThreads.ts'
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
  messages: { date: string; path: string }[]
  /** Newest downloaded message's real time (notebook tz, "YYYY-MM-DD HH:mm") — the follow's lastActivity anchor. */
  lastMessageAt?: string
  /** A message's AI conversion threw — leave the thread in the inbox so the next sync retries it. */
  failed?: boolean
}

export type FetchUnsavedResult = { fetched: number; threads: FetchedThread[]; labelId: string }

export type FetchUnsavedOptions = {
  label: string
  /** Max threads to list (the IMAP original counted messages). */
  limit: number
  /** Collapse all messages to this date */
  when?: PlainDateTime
  /** Fetch a specific thread by its decimal id */
  threadId?: string
  /** Thread listing already scanned on this client — skips the label rescan */
  inbox?: InboxThreadsResult
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
  const { threads, labelId } = opts.inbox ?? (await getInboxThreads(client, label, { limit }))

  // Filter to target threads
  let unsaved = threads.filter((t) => !t.saved)
  if (filterThreadId) {
    unsaved = threads.filter((t) => t.threadId === filterThreadId)
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

  // Build previous-path map from follow's saved messages (per thread).
  const previousByThread = new Map<string, string>()
  for (const thread of threads) {
    const lastSaved = thread.savedMessages.at(-1)
    if (lastSaved) previousByThread.set(thread.threadId, lastSaved.path)
  }

  const createdEntries = new Map<string, { date: string; path: string }>()
  const resultThreads: FetchedThread[] = []
  let savedCount = 0

  for (const [threadId, threadMessages] of byThread) {
    const threadEntries: { date: string; path: string }[] = []
    const priorMarkdown: string[] = []
    const previousPath = previousByThread.get(threadId)

    // Inherit tags/rel from previous message file (propagate across syncs)
    let inheritedTags: string | undefined
    let inheritedRel: unknown
    if (previousPath) {
      try {
        const prevDoc = EmailDocument.fromMarkdown(await readTextFile(path.join(DIR_BASE, previousPath)))
        inheritedTags = prevDoc.yaml['tags'] as string | undefined
        inheritedRel = prevDoc.yaml['rel']
      } catch {
        /* previous file may not exist */
      }
    }

    let failed = false
    for (const msg of threadMessages) {
      let result: { date: string; path: string } | null
      try {
        result = await saveMessage(
          msg,
          threadId,
          createdEntries,
          priorMarkdown,
          previousPath,
          inheritedTags,
          inheritedRel,
          whenOverride,
          tasks,
          output,
        )
      } catch (err) {
        // Fail-and-retry: skip the rest of the thread and keep it in the inbox
        // so the next sync re-attempts the unconverted messages.
        output.log(`  Warning: conversion failed (${(err as Error).message}) — thread left in inbox for retry`)
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
      from: normalizeFromName(threadMessages[0].from?.name || threadMessages[0].from?.address || 'unknown'),
      subject: threadMessages[0].subject || '(no subject)',
      messages: threadEntries,
      ...(lastMessageAt ? { lastMessageAt: `${lastMessageAt.date} ${lastMessageAt.time}` } : {}),
      ...(failed ? { failed: true } : {}),
    })
  }

  output.log(`\n  Fetched ${savedCount} message(s) across ${resultThreads.length} thread(s).\n`)
  return { fetched: savedCount, threads: resultThreads, labelId }
}

async function saveMessage(
  msg: DownloadedMessage,
  threadId: string,
  createdEntries: Map<string, { date: string; path: string }>,
  priorMarkdown: string[],
  previousPath: string | undefined,
  inheritedTags: string | undefined,
  inheritedRel: unknown,
  whenOverride: PlainDateTime | undefined,
  tasks: CommandService,
  output: Output,
): Promise<{ date: string; path: string } | null> {
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
    output.log('  Warning: capture truncated — source email exceeded the conversion budget')
  }

  if (converted.markdown) {
    priorMarkdown.push(converted.markdown)
  }

  // Determine the message's original timestamp (for the ## header),
  // in the timezone of the notebook day it arrived on
  const msgWhen = msg.date ? await convertToNotebookTimezone(msg.date) : (await fetchNow()).plainDateTime

  // When --when is passed, all messages go into one file at that date
  // Otherwise, use the message's own date
  const when = whenOverride ?? msgWhen
  const dateStr = when.plainDate.toString()

  // Save attachments
  const attachments =
    msg.downloadedAttachments.length > 0
      ? await copyEmailFilesToAttachments(msg.downloadedAttachments, when.plainDate, output)
      : []

  // Check for same-day entry (from this run)
  const entryKey = `${threadId}_${dateStr}`
  const localEntry = createdEntries.get(entryKey)

  if (localEntry) {
    // Same-day: append to existing file
    const fullPath = path.join(DIR_BASE, localEntry.path)
    try {
      const oldDoc = EmailDocument.fromMarkdown(await readTextFile(fullPath))
      const existingAttachments = oldDoc.attachments
      const mergedAttachments = [...existingAttachments, ...attachments]
      const appendPart = `\n\n## ${msgWhen.date} ${msgWhen.time} - **${from}**\n\n${converted.markdown || '(empty)'}\n`
      const updatedDoc = new EmailDocument(
        {
          ...oldDoc.yaml,
          ...(mergedAttachments.length > 0 ? { attachments: mergedAttachments } : {}),
        },
        oldDoc.markdown,
      )
      await writeTextFile(fullPath, updatedDoc.toMarkdown() + appendPart)
      output.log(`  Appended to ${localEntry.path}`)
    } catch (err) {
      output.log(`  Warning: failed to append: ${(err as Error).message}`)
    }
    return null // same-day append, no new entry
  }

  // New day: create file + day entry via email:new
  const markdown = `## ${msgWhen.date} ${msgWhen.time} - **${from}**\n\n${converted.markdown || '(empty)'}\n`
  const previous = previousPath ? computePreviousRef(previousPath, when.plainDate) : undefined

  const result = await tasks.run('email:new', {
    from,
    to: to || undefined,
    ...(cc ? { cc } : {}),
    when,
    subject: msg.subject || '(no subject)',
    summary: msg.subject || '',
    ...(previous ? { previous } : {}),
    ...(inheritedTags ? { tags: inheritedTags } : {}),
    ...(typeof inheritedRel === 'string' ? { rel: inheritedRel } : {}),
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
  const needsArrayRelPatch = Array.isArray(inheritedRel)
  if ((needsAttachmentPatch || needsArrayRelPatch) && result.data.filePath) {
    const fullPath = path.join(ddfw.fullDir, result.data.filePath)
    try {
      const contents = await readTextFile(fullPath)
      let doc = EmailDocument.fromMarkdown(contents)
      if (needsAttachmentPatch && doc.attachments.length === 0) {
        doc = EmailDocument.fromMarkdown(doc.setAttachments(attachments).toMarkdown())
      }
      if (needsArrayRelPatch) {
        doc = new EmailDocument({ ...doc.yaml, rel: inheritedRel }, doc.markdown)
      }
      await writeTextFile(fullPath, doc.toMarkdown())
    } catch {
      /* best-effort */
    }
  }

  output.log(`  Created ${entryPath}`)

  return { date: dateStr, path: entryPath }
}

/** Convert "Lastname, Firstname" → "Firstname Lastname" */
function normalizeFromName(name: string): string {
  const match = name.match(/^([^,]+),\s*(.+)$/)
  return match ? `${match[2]} ${match[1]}` : name
}
