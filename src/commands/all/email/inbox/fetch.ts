import * as path from 'node:path'
import { DIR_BASE } from '#config'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import { computePreviousRef, convertToNotebookTimezone, fetchNow } from '#shared/nbfs/mod.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import EmailDocument from '#shared/models/Email/mod.ts'
import { emailToMarkdown } from '../lib/emailToMarkdown.ts'
import { createImapClient, downloadMessageBodies } from '../lib/imap-client.ts'
import type { FetchedEmailMessage } from '../lib/imap-client.ts'
import { getInboxThreads } from '../lib/getInboxThreads.ts'
import type { InboxMessage } from '../lib/getInboxThreads.ts'
import { copyEmailFilesToAttachments } from '../lib/copyToAttachments.ts'
import { PlainDateTime as PDT } from '#universal/dates/nbdt/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  account: Flag.string('Account name from secrets (e.g. user@example.com)'),
  label: Flag.string('Gmail label to fetch from', { default: () => 'Sky/Follow' }),
  limit: Flag.number('Max new messages to fetch', { default: () => 250 }),
  when: Flag.plainDateTime('Collapse all messages to this date', { parse: PDT.fromString }),
  threadId: Flag.string('Fetch a specific thread by ID', { hidden: true }),
  collapseNewThreads: Flag.boolean('Collapse first-time (unfollowed) threads into one file dated today', {
    default: false,
    hidden: true,
  }),
}

type Params = InferParams<typeof params>

export type FetchedThread = {
  threadId: string
  from: string
  subject: string
  messages: { date: string; path: string }[]
}

type FetchResult = { fetched: number; threads: FetchedThread[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'email:inbox:fetch': { params: Params; result: FetchResult }
  }
}

export default class EmailInboxFetchTask extends Command {
  static override description: CommandDescription = {
    name: 'email:inbox:fetch',
    description: 'Download unsaved email messages and save to day files.',
    descriptionLong: [
      'Uses email:inbox:view logic to find all threads, identifies unsaved ones,',
      'downloads body content + attachments, and saves to day files.',
      'Same-day messages for a thread are appended to a single file.',
    ],
    usage: [
      'sky email:inbox:fetch --account user@example.com',
      'sky email:inbox:fetch --account user@example.com --limit 5',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<FetchResult>> {
    const { output, secrets } = context
    const { account, label, limit, when: whenOverride, threadId: filterThreadId, collapseNewThreads } = args

    if (!account) {
      return CommandResult.fail('--account is required')
    }

    const entry = await secrets.get('email', account)
    if (!entry || entry.type !== 'login') {
      return CommandResult.fail(
        `Login credentials not found for email/${account}. Set them with:\n  sky secrets:set email ${account}`,
      )
    }

    output.log(`\n  Connecting to Gmail IMAP as ${entry.user}...`)
    const client = createImapClient({ user: entry.user, pass: entry.pass })
    client.on('error', () => {})

    try {
      await client.connect()

      // ── Phase 1: Get threads (same as inbox:view) ──────────────────
      const { threads } = await getInboxThreads(client, label, { limit })

      // Filter to target threads
      let unsaved = threads.filter((t) => !t.saved)
      if (filterThreadId) {
        unsaved = threads.filter((t) => t.threadId === filterThreadId)
      }

      if (unsaved.length === 0) {
        output.log('  All threads are saved. Nothing to fetch.\n')
        return CommandResult.success({ fetched: 0, threads: [] })
      }

      // Collect messages to download, grouped by source mailbox
      const labelUids: number[] = []
      const inboxUids: number[] = []
      const msgsByUid = new Map<string, InboxMessage>() // "source:uid" → message

      for (const thread of unsaved) {
        for (const msg of thread.messages) {
          if (msg.saved) continue
          const key = `${msg.source}:${msg.uid}`
          msgsByUid.set(key, msg)
          if (msg.source === 'label') labelUids.push(msg.uid)
          else inboxUids.push(msg.uid)
        }
      }

      // Apply limit to total messages
      const totalNew = labelUids.length + inboxUids.length
      output.log(`  ${unsaved.length} unsaved thread(s), ${totalNew} message(s) to download...\n`)

      // ── Phase 2: Download bodies for unsaved messages only ─────────
      const downloaded: FetchedEmailMessage[] = []

      if (labelUids.length > 0) {
        const msgs = await downloadMessageBodies(client, label, labelUids, {
          onProgress: (msg) => output.log(msg),
        })
        downloaded.push(...msgs)
      }

      if (inboxUids.length > 0) {
        const msgs = await downloadMessageBodies(client, 'INBOX', inboxUids, {
          onProgress: (msg) => output.log(msg),
        })
        downloaded.push(...msgs)
      }

      // Sort chronologically
      downloaded.sort((a, b) => {
        const dateA = a.date instanceof Date ? a.date.getTime() : 0
        const dateB = b.date instanceof Date ? b.date.getTime() : 0
        return dateA - dateB
      })

      // ── Phase 3: Save to day files ─────────────────────────────────
      output.log(`\n  Saving ${downloaded.length} message(s)...\n`)

      // Group by thread
      const byThread = new Map<string, FetchedEmailMessage[]>()
      for (const msg of downloaded) {
        const tid = msg.threadId || String(msg.uid)
        const group = byThread.get(tid) ?? []
        group.push(msg)
        byThread.set(tid, group)
      }

      // Build previous-path map from follow's saved messages (per thread).
      // A thread with no saved messages has no follow yet → it's a first-time capture.
      const previousByThread = new Map<string, string>()
      const newThreadIds = new Set<string>()
      for (const thread of threads) {
        const lastSaved = thread.savedMessages.at(-1)
        if (lastSaved) previousByThread.set(thread.threadId, lastSaved.path)
        else newThreadIds.add(thread.threadId)
      }

      // First-time threads collapse into one file dated today (when the caller enables it,
      // e.g. follow:sync). Already-followed threads stream each new message onto its own date.
      const today = (await fetchNow()).plainDateTime

      const createdEntries = new Map<string, { date: string; path: string }>()
      const resultThreads: FetchedThread[] = []
      let savedCount = 0

      for (const [threadId, threadMessages] of byThread) {
        const threadEntries: { date: string; path: string }[] = []
        const priorMarkdown: string[] = []
        const previousPath = previousByThread.get(threadId)
        // --when (manual) wins; else collapse a first-time thread to today; else use real dates.
        const effectiveWhen = whenOverride ?? (collapseNewThreads && newThreadIds.has(threadId) ? today : undefined)

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

        for (const msg of threadMessages) {
          const result = await this.saveMessage(
            msg,
            threadId,
            createdEntries,
            priorMarkdown,
            previousPath,
            inheritedTags,
            inheritedRel,
            effectiveWhen,
            tasks,
            output,
          )
          if (result) {
            threadEntries.push(result)
            createdEntries.set(`${threadId}_${result.date}`, result)
          }
          savedCount++
        }

        resultThreads.push({
          threadId,
          from: normalizeFromName(threadMessages[0].from?.name || threadMessages[0].from?.address || 'unknown'),
          subject: threadMessages[0].subject || '(no subject)',
          messages: threadEntries,
        })
      }

      output.log(`\n  Fetched ${savedCount} message(s) across ${resultThreads.length} thread(s).\n`)
      return CommandResult.success({ fetched: savedCount, threads: resultThreads })
    } catch (err) {
      return CommandResult.error(err as Error, 'IMAP fetch failed')
    } finally {
      await client.logout().catch(() => {})
    }
  }

  private async saveMessage(
    msg: FetchedEmailMessage,
    threadId: string,
    createdEntries: Map<string, { date: string; path: string }>,
    priorMarkdown: string[],
    previousPath: string | undefined,
    inheritedTags: string | undefined,
    inheritedRel: unknown,
    whenOverride: PlainDateTime | undefined,
    tasks: CommandArgs<Params>['tasks'],
    output: { log: (msg: string) => void },
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

    // Convert body to markdown via AI (with thread context for dedup)
    const converted = await emailToMarkdown(msg, {
      priorMessages: priorMarkdown.length > 0 ? priorMarkdown : undefined,
    })

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
        const appendPart = `\n\n## ${msgWhen.date} ${msgWhen.time} - **${from}**\n\n${
          converted.markdown || '(empty)'
        }\n`
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
}

/** Convert "Lastname, Firstname" → "Firstname Lastname" */
function normalizeFromName(name: string): string {
  const match = name.match(/^([^,]+),\s*(.+)$/)
  return match ? `${match[2]} ${match[1]}` : name
}
