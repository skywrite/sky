import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { writeFileDedup } from '#commands/all/email/lib/copyToAttachments.ts'
import { DayDirFileWriter, messageFileName } from '#lib/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import outputFile from '#shared/fs/outputFile.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { computePreviousRef, dayAttachmentsDir, dayTimezone, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { toTimeRef } from '#shared/nbfs/timeRef.ts'
import { calendarLocal, Instant, PlainDate, type PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { BeeperAccount, BeeperAttachment, BeeperChat, BeeperClient, BeeperMessage } from './client.ts'
import { beeperText } from './text.ts'

/**
 * The capture: Beeper's chats become the notebook's saved messages, one file
 * per chat per day, in the shape the Gmail capture already writes. Each run
 * asks Beeper which chats moved since the last run, pulls the messages after
 * each chat's cursor, and appends them to the day's file. Your own messages
 * are saved too, so Outbox can see when you answered.
 */

export type BeeperSource = Pick<BeeperClient, 'accounts' | 'searchChats' | 'messages' | 'downloadAsset'>

export type BeeperSyncOptions = {
  client: BeeperSource
  /** The notebook's `time` directory. */
  timeDir: string
  attachmentsDir: string
  stateFile: string
  /** When this run started, as an ISO instant. */
  now: string
  /** The notebook's current zone; a day with its own `tz:` re-renders in that zone. */
  timezone: string
  dayTimezone?: (day: string) => Promise<string>
  /** How far back the first run reaches. */
  backfillDays?: number
  chatLimit?: number
  messageLimit?: number
  attachmentLimit?: number
  category?: string
  dryRun?: boolean
  log?: (line: string) => void
}

export type BeeperSyncResult = {
  chats: number
  messages: number
  /** Time refs of the files written or extended. */
  files: string[]
  skipped: { chat: string; reason: string }[]
  accountsSkipped: string[]
  notes: string[]
  /** False when the chat limit cut the run short; the next run continues. */
  complete: boolean
}

const ChatStateSchema = z.object({
  title: z.string().default(''),
  network: z.string().default(''),
  cursor: z.string().optional(),
  seen: z.array(z.string()).default([]),
  /** Day → the file that day, as `time/...` path. */
  files: z.record(z.string(), z.string()).default({}),
})
export const BeeperSyncStateSchema = z.object({
  version: z.literal(1),
  lastSync: z.string().optional(),
  chats: z.record(z.string(), ChatStateSchema).default({}),
})
export type BeeperSyncState = z.infer<typeof BeeperSyncStateSchema>
type ChatState = z.infer<typeof ChatStateSchema>

const SEEN_LIMIT = 400
/** Chats are re-listed this far behind the last run: a message can arrive after its own timestamp. */
const OVERLAP_MS = 6 * 3_600_000
const SUMMARY_CHARS = 80
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

export async function loadBeeperSyncState(file: string): Promise<BeeperSyncState> {
  if (!(await exists(file))) return { version: 1, chats: {} }
  const parsed = BeeperSyncStateSchema.safeParse(JSON.parse(await readTextFile(file)))
  return parsed.success ? parsed.data : { version: 1, chats: {} }
}

async function saveState(file: string, state: BeeperSyncState): Promise<void> {
  await outputFile(file, `${JSON.stringify(state, null, 2)}\n`)
}

/** Slack already reaches the notebook through agent-slack; a second copy would duplicate every thread. */
export function isSlackAccount(account: BeeperAccount): boolean {
  return (
    (account.bridge?.type ?? '').toLowerCase().includes('slack') ||
    (account.network ?? '').trim().toLowerCase() === 'slack'
  )
}

function firstName(name: string): string {
  return name
    .split(', ')
    .map((part) => part.trim().split(' ')[0])
    .filter(Boolean)
    .join(', ')
}

function instantMs(value: string): number | null {
  try {
    return Instant.from(value).epochMilliseconds
  } catch {
    return null
  }
}

function keep(message: BeeperMessage): boolean {
  if (message.isDeleted || message.isHidden) return false
  if (message.type === 'REACTION') return false
  return Boolean(message.text?.trim()) || Boolean(message.attachments?.length)
}

function selfName(account: BeeperAccount | undefined): string {
  return account?.user?.fullName?.trim() || account?.user?.username?.trim() || 'Me'
}

function counterpart(chat: BeeperChat, account: BeeperAccount | undefined): string {
  const other = chat.participants?.items.find((person) => !person.isSelf && person.id !== account?.user?.id)
  return other?.fullName?.trim() || other?.username?.trim() || chat.title || 'Unknown'
}

function senderOf(message: BeeperMessage, chat: BeeperChat, account: BeeperAccount | undefined): string {
  if (message.isSender) return selfName(account)
  const named = message.senderName?.trim()
  if (named) return named
  const person = chat.participants?.items.find((candidate) => candidate.id === message.senderID)
  return person?.fullName?.trim() || person?.username?.trim() || 'Unknown'
}

function attachmentKind(attachment: BeeperAttachment): string {
  if (attachment.isVoiceNote) return 'Voice note'
  if (attachment.isSticker) return 'Sticker'
  if (attachment.isGif) return 'GIF'
  if (attachment.type === 'img') return 'Photo'
  if (attachment.type === 'video') return 'Video'
  if (attachment.type === 'audio') return 'Audio'
  return 'File'
}

function summarize(text: string, fallback: string): string {
  const line =
    text
      .split('\n')
      .map((part) => part.replace(/^[>#\-*\s]+/, '').trim())
      .find(Boolean) ?? ''
  const plain = line.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '')
  if (!plain) return fallback
  if (plain.length <= SUMMARY_CHARS) return plain
  const cut = plain.lastIndexOf(' ', SUMMARY_CHARS)
  return `${plain.slice(0, cut > SUMMARY_CHARS / 2 ? cut : SUMMARY_CHARS).trimEnd()}…`
}

type Section = {
  when: PlainDateTime
  sender: string
  text: string
  lines: string[]
  attachments: Attachment[]
  fallback: string
}

function heading(section: Section): string {
  return `## ${section.when.date} ${section.when.time} - **${section.sender}**`
}

function signature(section: Section): string {
  return `${heading(section)}\n\n${(section.text || section.lines[0] || '').split('\n')[0]}`
}

function render(section: Section): string {
  return `${heading(section)}\n\n${[section.text, ...section.lines].filter(Boolean).join('\n\n')}\n`
}

async function activeChats(
  client: BeeperSource,
  since: string,
  limit: number,
): Promise<{ items: BeeperChat[]; complete: boolean }> {
  const items: BeeperChat[] = []
  let cursor: string | undefined
  for (;;) {
    const page = await client.searchChats({
      inbox: 'primary',
      includeMuted: false,
      type: 'any',
      lastActivityAfter: since,
      limit: Math.min(200, Math.max(1, limit)),
      ...(cursor ? { cursor, direction: 'before' } : {}),
    })
    items.push(...page.items)
    if (!page.hasMore || !page.oldestCursor || !page.items.length) return { items, complete: true }
    if (items.length >= limit) return { items: items.slice(0, limit), complete: false }
    cursor = page.oldestCursor
  }
}

/** Messages after the chat's cursor; on first contact, the newest back to the boundary. */
async function newMessages(
  client: BeeperSource,
  chat: BeeperChat,
  chatState: ChatState,
  boundaryMs: number,
  limit: number,
): Promise<{ messages: BeeperMessage[]; cursor?: string }> {
  const collected: BeeperMessage[] = []
  if (chatState.cursor) {
    let cursor = chatState.cursor
    let newest = chatState.cursor
    for (;;) {
      const page = await client.messages(chat.id, { cursor, direction: 'after' })
      collected.push(...page.items)
      if (page.items.length && page.newestCursor) newest = page.newestCursor
      if (!page.hasMore || !page.newestCursor || !page.items.length || collected.length >= limit) break
      cursor = page.newestCursor
    }
    return { messages: collected, cursor: newest }
  }
  const first = await client.messages(chat.id)
  collected.push(...first.items)
  let cursor = first.oldestCursor
  let more = first.hasMore
  const oldest = () => Math.min(...collected.map((message) => instantMs(message.timestamp) ?? Number.MAX_SAFE_INTEGER))
  while (more && cursor && collected.length < limit && (collected.length === 0 || oldest() >= boundaryMs)) {
    const page = await client.messages(chat.id, { cursor, direction: 'before' })
    if (!page.items.length) break
    collected.push(...page.items)
    cursor = page.oldestCursor
    more = page.hasMore
  }
  return { messages: collected, ...(first.newestCursor ? { cursor: first.newestCursor } : {}) }
}

export async function syncBeeper(options: BeeperSyncOptions): Promise<BeeperSyncResult> {
  const log = options.log ?? (() => {})
  const backfillDays = options.backfillDays ?? 30
  const chatLimit = options.chatLimit ?? 100
  const messageLimit = options.messageLimit ?? 500
  const attachmentLimit = options.attachmentLimit ?? 20
  const category = options.category ?? 'Professional'
  const result: BeeperSyncResult = {
    chats: 0,
    messages: 0,
    files: [],
    skipped: [],
    accountsSkipped: [],
    notes: [],
    complete: true,
  }
  const nowMs = instantMs(options.now)
  if (nowMs === null) throw new Error('The sync needs the current instant as ISO text.')
  const boundaryMs = nowMs - backfillDays * 86_400_000
  const state = await loadBeeperSyncState(options.stateFile)
  const sinceMs = state.lastSync
    ? Math.max(boundaryMs, (instantMs(state.lastSync) ?? boundaryMs) - OVERLAP_MS)
    : boundaryMs
  const notebookDir = path.dirname(options.timeDir)
  const zones = new Map<string, string>()
  const zoneOf = options.dayTimezone ?? ((day: string) => dayTimezone(day, options.timeDir))
  const localTime = async (timestamp: string): Promise<PlainDateTime> => {
    const first = calendarLocal(timestamp, options.timezone)
    let zone = zones.get(first.date)
    if (!zone) {
      zone = await zoneOf(first.date)
      zones.set(first.date, zone)
    }
    return zone === options.timezone ? first : calendarLocal(timestamp, zone)
  }

  const accounts = new Map<string, BeeperAccount>()
  for (const account of await options.client.accounts()) {
    if (isSlackAccount(account)) {
      result.accountsSkipped.push(account.network?.trim() || account.accountID)
      continue
    }
    accounts.set(account.accountID, account)
  }

  const chats = await activeChats(options.client, Instant.fromEpochMilliseconds(sinceMs).toString(), chatLimit)
  result.complete = chats.complete
  for (const chat of chats.items) {
    const label = chat.title || chat.id
    if (!accounts.has(chat.accountID)) {
      result.skipped.push({ chat: label, reason: 'its account is not captured' })
      continue
    }
    if (chat.isReadOnly) {
      result.skipped.push({ chat: label, reason: 'read-only' })
      continue
    }
    if (chat.isArchived || chat.isLowPriority) continue
    const account = accounts.get(chat.accountID)
    const chatState: ChatState = state.chats[chat.id] ?? { title: '', network: '', seen: [], files: {} }
    const network = chat.network.trim() || account?.network?.trim() || 'Beeper'
    const fetched = await newMessages(options.client, chat, chatState, boundaryMs, messageLimit)
    const seen = new Set(chatState.seen)
    const fresh = fetched.messages
      .filter(keep)
      .filter((message) => !seen.has(message.id))
      .map((message) => ({ message, at: instantMs(message.timestamp) }))
      .filter((entry): entry is { message: BeeperMessage; at: number } => entry.at !== null && entry.at >= boundaryMs)
      .sort((a, b) => a.at - b.at || a.message.sortKey.localeCompare(b.message.sortKey))
    result.chats += 1
    if (!fresh.length) {
      if (!options.dryRun) {
        state.chats[chat.id] = {
          ...chatState,
          title: chat.title,
          network,
          ...(fetched.cursor ? { cursor: fetched.cursor } : {}),
        }
        await saveState(options.stateFile, state)
      }
      continue
    }

    // One section per message, grouped by the notebook day it lands on.
    const days = new Map<string, Section[]>()
    let savedAttachments = 0
    for (const { message } of fresh) {
      const when = await localTime(message.timestamp)
      const section: Section = {
        when,
        sender: senderOf(message, chat, account),
        text: beeperText(message.text),
        lines: [],
        attachments: [],
        fallback: 'Message',
      }
      for (const attachment of message.attachments ?? []) {
        const kind = attachmentKind(attachment)
        section.fallback = kind
        const transcript = attachment.transcription?.transcription?.trim()
        if (attachment.isVoiceNote && transcript) section.lines.push(`🎤 ${transcript}`)
        const name = attachment.fileName?.trim() || `${kind.toLowerCase().replace(/\s+/g, '-')}`
        let saved: string | undefined
        const skip =
          attachment.isSticker ||
          attachment.isGif ||
          options.dryRun ||
          savedAttachments >= attachmentLimit ||
          (attachment.fileSize ?? 0) > MAX_ATTACHMENT_BYTES
        if (!skip) {
          try {
            saved = await saveAttachment(options, attachment, name, when.plainDate, network)
            if (saved) savedAttachments += 1
          } catch (error) {
            result.notes.push(
              `${label}: ${name} could not be saved (${error instanceof Error ? error.message : 'unknown error'}).`,
            )
          }
        }
        if (saved) section.attachments.push({ file: saved })
        if (!(attachment.isVoiceNote && transcript)) section.lines.push(`📎 ${saved ?? name}`)
      }
      const list = days.get(when.date) ?? []
      list.push(section)
      days.set(when.date, list)
    }

    for (const [date, sections] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      const day = PlainDate.fromString(date)
      const existing = chatState.files[date]
      const single = chat.type === 'single'
      const who = single ? firstName(counterpart(chat, account)) : chat.title || 'Group'
      if (existing && (await exists(path.join(notebookDir, existing)))) {
        const file = path.join(notebookDir, existing)
        const doc = MessageDocument.fromMarkdown(await readTextFile(file))
        const additions = sections.filter((section) => !doc.markdown.includes(signature(section)))
        if (!additions.length) continue
        const markdown = `${doc.markdown.replace(/\s+$/, '')}\n\n${additions.map(render).join('\n')}`
        let next = new MessageDocument(doc.yaml, markdown)
        const files = additions.flatMap((section) => section.attachments)
        if (files.length) next = next.setAttachments([...next.attachments, ...files])
        if (!options.dryRun) await writeTextFile(file, next.toMarkdown())
        result.messages += additions.length
        result.files.push(toTimeRef(existing))
        log(`  ${network} · ${label}: ${additions.length} new message(s) on ${date}`)
        continue
      }
      const first = sections[0]
      const from = single ? counterpart(chat, account) : first.sender
      const to = single ? selfName(account) : chat.title || 'Group'
      const summary = summarize(first.text, first.fallback)
      const previousPath = Object.entries(chatState.files)
        .filter(([other]) => other < date)
        .sort(([a], [b]) => b.localeCompare(a))[0]?.[1]
      const doc = new MessageDocument(
        {
          from,
          to,
          when: `${first.when.date} ${first.when.time}`,
          medium: network,
          summary,
          ...(previousPath ? { previous: computePreviousRef(previousPath, day) } : {}),
          chat: chat.id,
          account: chat.accountID,
          ...(single ? {} : { group: true }),
        },
        sections.map(render).join('\n'),
      )
      const files = sections.flatMap((section) => section.attachments)
      const withFiles = files.length ? doc.setAttachments(files) : doc
      const fileName = messageFileName(
        first.when,
        slugify(network) || 'beeper',
        [
          slugify(who, { preserveCase: true, suggestedLength: 40 }),
          slugify(summary, { preserveCase: true, suggestedLength: 30 }),
        ]
          .filter(Boolean)
          .join('_') || 'message',
      )
      const writer = new DayDirFileWriter(day, options.timeDir)
      if (options.dryRun) {
        result.messages += sections.length
        result.files.push(toTimeRef(`time/${writer.dayDir}/${fileName}`))
        log(`  ${network} · ${label}: ${sections.length} message(s) on ${date} (dry run)`)
        continue
      }
      const rel = await writer.write(fileName, withFiles.toMarkdown())
      const filePath = `time/${writer.dayDir}/${rel}`
      chatState.files[date] = filePath
      result.messages += sections.length
      result.files.push(toTimeRef(filePath))
      log(`  ${network} · ${label}: ${sections.length} message(s) on ${date} → ${rel}`)
      try {
        let dayDoc = await readDay(day, options.timeDir)
        dayDoc = dayDoc.setCompleteItem(`${first.when.time} > ${who} ${network}`, `[${summary}](${rel})`, {
          time: first.when.time,
          category,
        })
        await writeDay(dayDoc, options.timeDir)
      } catch {
        result.notes.push(`${date} has no day file; the ${network} capture is saved without a day entry.`)
      }
    }

    if (!options.dryRun) {
      const ids = [...chatState.seen, ...fresh.map(({ message }) => message.id)]
      state.chats[chat.id] = {
        title: chat.title,
        network,
        ...(fetched.cursor ? { cursor: fetched.cursor } : {}),
        seen: ids.slice(-SEEN_LIMIT),
        files: chatState.files,
      }
      await saveState(options.stateFile, state)
    }
  }
  if (!options.dryRun) {
    if (result.complete) state.lastSync = options.now
    await saveState(options.stateFile, state)
  }
  return result
}

/** Copy one attachment into the day's attachments folder; the saved name, or nothing when Beeper has no file. */
async function saveAttachment(
  options: BeeperSyncOptions,
  attachment: BeeperAttachment,
  name: string,
  day: PlainDate,
  network: string,
): Promise<string | undefined> {
  let source = attachment.srcURL
  if (!source || !source.startsWith('file:')) {
    const reference = attachment.id ?? source
    if (!reference) return undefined
    const downloaded = await options.client.downloadAsset(reference)
    if (downloaded.error) throw new Error(downloaded.error)
    source = downloaded.srcURL
  }
  if (!source) return undefined
  const data = await readFile(source.startsWith('file:') ? new URL(source) : source)
  if (data.byteLength > MAX_ATTACHMENT_BYTES) return undefined
  const ext = path.extname(name)
  const stem = name.slice(0, ext ? -ext.length : undefined)
  const attachDir = path.join(options.attachmentsDir, dayAttachmentsDir(day))
  await mkdir(attachDir, { recursive: true })
  const desired = `${day}_${slugify(network, { preserveCase: true }) || 'Beeper'}_${slugify(stem, { preserveCase: true, suggestedLength: 60 }) || 'file'}${ext}`
  return writeFileDedup(data, attachDir, desired)
}
