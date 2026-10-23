import { mkdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { z } from 'zod'
import { writeFileDedup } from '#commands/all/email/lib/copyToAttachments.ts'
import { DayDirFileWriter, ensureDay, messageFileName } from '#lib/nbfs/mod.ts'
import slugify from '#lib/string/slugify.ts'
import { exists, readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import outputFile from '#shared/fs/outputFile.ts'
import type { Attachment } from '#shared/models/Markdown/Document/attachment.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { computePreviousRef, dayAttachmentsDir, dayTimezone, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { toTimeRef } from '#shared/nbfs/timeRef.ts'
import { calendarLocal, Instant, PlainDate, type PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import type { BeeperAccount, BeeperAttachment, BeeperChat, BeeperClient, BeeperMessage, BeeperUser } from './client.ts'
import { beeperText } from './text.ts'

/**
 * The capture: Beeper's chats become the notebook's saved messages, one file
 * per chat per day, in the shape the Gmail capture already writes. Each run
 * asks Beeper which chats moved since the last run, pulls the messages after
 * what each chat has shown, and appends them to the day's file. Your own messages
 * are saved too, so Outbox can see when you answered.
 */

export type BeeperSource = Pick<BeeperClient, 'accounts' | 'searchChats' | 'messages' | 'downloadAsset'>

/**
 * What a source beside Beeper knows about a handle — a number or an address.
 * lib/macMessages answers from this Mac's Contacts and Messages, for the one
 * network whose names Beeper's API leaves out, iMessage.
 */
export type SenderNames = {
  /**
   * What is known about a handle: a name, whether the phone files the sender
   * as known, and where the name came from — `notebook` for one of the
   * person's own records, which outranks the messenger's name.
   */
  resolve(handle: string): { name: string | null; known: boolean | null; source?: 'notebook' | 'contacts' } | null
}

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
  /** Names for the people Beeper shows by number or address alone */
  names?: SenderNames
  /** The notebook owner's name, for an account Beeper carries without one (iMessage) */
  ownerName?: string
  /**
   * The words of a voice note Beeper hands over without a transcription: the
   * sync command passes Sky's transcription provider. Nothing waits on the
   * person; a voice note that cannot be transcribed is listed by file name.
   */
  transcribe?: (audio: Uint8Array, fileName: string) => Promise<string>
  /** How long a saved voice note runs, in seconds, for its heading; null when unknown */
  duration?: (file: string) => Promise<number | null>
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
  /** Networks left to agent-slack. */
  accountsSkipped: string[]
  /** Networks whose switch is off. */
  accountsOff: string[]
  /** Chats from unknown senders held back this run, by how Beeper names the sender. */
  held: { chat: string; network: string }[]
  notes: string[]
  /** False when the chat limit cut the run short; the next run continues. */
  complete: boolean
}

/**
 * What Sky does with one of Beeper's chat accounts. A network the person has
 * not chosen yet waits with `save` off; `groups` off keeps that network to
 * one-to-one chats. `chosen` is set the first time the person decides.
 */
export const AccountRuleSchema = z.object({
  network: z.string().default(''),
  save: z.boolean().default(false),
  groups: z.boolean().default(false),
  /** A one-to-one chat from someone with no name in the contacts is held for a look, not saved. */
  holdUnknown: z.boolean().default(true),
  chosen: z.boolean().default(false),
})
export type AccountRule = z.infer<typeof AccountRuleSchema>

/** A chat held back: who wrote, what they opened with, and how much has come. */
export const HeldChatSchema = z.object({
  network: z.string().default(''),
  /** How Beeper names the sender: a number or a handle, since there is no contact */
  who: z.string().default(''),
  /** The newest message's first line */
  first: z.string().default(''),
  /** The newest message's instant */
  at: z.string(),
  /** Messages in the last month */
  count: z.number().default(0),
})
export type HeldChat = z.infer<typeof HeldChatSchema>

/** The last run, kept for the settings page. */
export const LastRunSchema = z.object({
  at: z.string(),
  chats: z.number().default(0),
  messages: z.number().default(0),
  files: z.number().default(0),
  skipped: z.array(z.object({ chat: z.string(), reason: z.string() })).default([]),
  accountsOff: z.array(z.string()).default([]),
  complete: z.boolean().default(true),
})
export type LastRun = z.infer<typeof LastRunSchema>

const ChatStateSchema = z.object({
  title: z.string().default(''),
  network: z.string().default(''),
  /** The person said Save on a held chat: its sender counts as known from then on */
  known: z.boolean().optional(),
  /** The instant of the newest message the chat has shown; the next run looks from an hour before it */
  newest: z.string().optional(),
  seen: z.array(z.string()).default([]),
  /** Day → the file that day, as `time/...` path. */
  files: z.record(z.string(), z.string()).default({}),
})
export const BeeperSyncStateSchema = z.object({
  version: z.literal(1),
  lastSync: z.string().optional(),
  chats: z.record(z.string(), ChatStateSchema).default({}),
  /** By Beeper's account id. */
  accounts: z.record(z.string(), AccountRuleSchema).default({}),
  /** By chat id: chats from unknown senders, waiting for a look. */
  held: z.record(z.string(), HeldChatSchema).default({}),
  lastRun: LastRunSchema.optional(),
})
export type BeeperSyncState = z.infer<typeof BeeperSyncStateSchema>
type ChatState = z.infer<typeof ChatStateSchema>

const SEEN_LIMIT = 400
/** The last run remembers this many left-out chats. */
const SKIPPED_LIMIT = 60
/** Chats are re-listed this far behind the last run: a message can arrive after its own timestamp. */
const OVERLAP_MS = 6 * 3_600_000
const SUMMARY_CHARS = 80
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const EMPTY_STATE = (): BeeperSyncState => ({ version: 1, chats: {}, accounts: {}, held: {} })

export async function loadBeeperSyncState(file: string): Promise<BeeperSyncState> {
  if (!(await exists(file))) return EMPTY_STATE()
  const parsed = BeeperSyncStateSchema.safeParse(JSON.parse(await readTextFile(file)))
  return parsed.success ? parsed.data : EMPTY_STATE()
}

export async function saveBeeperSyncState(file: string, state: BeeperSyncState): Promise<void> {
  await outputFile(file, `${JSON.stringify(state, null, 2)}\n`)
}
const saveState = saveBeeperSyncState

export function networkOf(account: BeeperAccount): string {
  return account.network?.trim() || account.accountID
}

/**
 * Every account Beeper carries gets a rule. An account seen for the first time
 * waits, off — except when the notebook already holds chats of its network,
 * which means Sky was saving it before rules existed: that one stays on,
 * groups included, so an upgrade changes nothing. Slack accounts get no rule;
 * agent-slack owns them. True when a rule was added.
 */
export function reconcileAccountRules(state: BeeperSyncState, accounts: BeeperAccount[]): boolean {
  let changed = false
  for (const account of accounts) {
    if (isSlackAccount(account)) continue
    const network = networkOf(account)
    const known = state.accounts[account.accountID]
    if (known) {
      if (known.network !== network) {
        known.network = network
        changed = true
      }
      continue
    }
    const saving = Object.values(state.chats).some((chat) => chat.network === network)
    state.accounts[account.accountID] = { network, save: saving, groups: saving, holdUnknown: !saving, chosen: false }
    changed = true
  }
  return changed
}

/** The person said Save on a held chat: from now on its sender is known, and the next check saves it. */
export function markKnown(state: BeeperSyncState, chatID: string): boolean {
  const held = state.held[chatID]
  if (!held) return false
  const chat = state.chats[chatID] ?? { title: held.who, network: held.network, seen: [], files: {} }
  state.chats[chatID] = { ...chat, known: true }
  delete state.held[chatID]
  return true
}

export type ChatVerdict = { save: true } | { save: false; reason: string; quiet?: boolean }

const PHONE_LIKE = /^\+?[\d\s().-]{7,}$/

/** A name Beeper made up for someone with no contact: a number, an address, a handle. */
function nameless(name: string, person: BeeperUser | undefined): boolean {
  const plain = name.trim()
  if (!plain) return true
  if (PHONE_LIKE.test(plain) || plain.includes('@')) return true
  const same = (value: string | undefined) => Boolean(value && value.trim().toLowerCase() === plain.toLowerCase())
  return same(person?.phoneNumber) || same(person?.username) || same(person?.email)
}

/** The other side of a one-to-one chat. */
function otherSide(chat: BeeperChat, account: BeeperAccount | undefined): BeeperUser | undefined {
  return chat.participants?.items.find((person) => !person.isSelf && person.id !== account?.user?.id)
}

/** What this Mac knows about someone Beeper shows by number or address alone. */
function lookedUp(person: BeeperUser | undefined, names: SenderNames | undefined) {
  const handle = person?.phoneNumber?.trim() || person?.email?.trim()
  return handle && names ? names.resolve(handle) : null
}

/** The name the notebook files this person under, when one of their records carries the handle */
function notebookName(person: BeeperUser | undefined, names: SenderNames | undefined): string | undefined {
  const found = lookedUp(person, names)
  return found?.source === 'notebook' && found.name ? found.name : undefined
}

/**
 * The other side of a one-to-one chat when nobody has a name for them — not
 * Beeper's contacts, not this Mac's, and the phone never filed them as known
 * — as Beeper shows them, a number or a handle; or null when the chat is a
 * group or the person is named.
 */
export function unknownSender(
  chat: BeeperChat,
  account: BeeperAccount | undefined,
  names?: SenderNames,
): string | null {
  if (chat.type === 'group') return null
  const other = otherSide(chat, account)
  const name = other?.fullName?.trim() || chat.title.trim()
  if (!nameless(name, other)) return null
  const mac = lookedUp(other, names)
  if (mac?.name || mac?.known) return null
  return name || other?.phoneNumber?.trim() || other?.username?.trim() || other?.email?.trim() || chat.id
}

/** The chat as the log and the page name it: the person's name when one is known, else Beeper's title. */
export function chatLabel(chat: BeeperChat, account: BeeperAccount | undefined, names?: SenderNames): string {
  if (chat.type === 'single') {
    const other = otherSide(chat, account)
    const own = notebookName(other, names)
    if (own) return own
    if (nameless(chat.title, other)) return lookedUp(other, names)?.name || chat.title || chat.id
  }
  return chat.title || chat.id
}

/**
 * Whether a chat is saved, and if not, why — the one place that decides, for
 * the capture and for the settings page's preview alike. `quiet` marks the
 * reasons the capture does not report one by one: Beeper's own filing.
 */
export function judgeChat(
  chat: BeeperChat,
  account: BeeperAccount | undefined,
  rule: AccountRule | undefined,
): ChatVerdict {
  if (account && isSlackAccount(account))
    return { save: false, reason: 'saved through Sky’s Slack connection', quiet: true }
  if (!account) return { save: false, reason: 'its account is not captured' }
  const network = networkOf(account)
  if (!rule?.save) return { save: false, reason: `${network} is off`, quiet: true }
  if (chat.isReadOnly) return { save: false, reason: 'read-only' }
  if (chat.isArchived) return { save: false, reason: 'archived', quiet: true }
  if (chat.isLowPriority) return { save: false, reason: 'low priority', quiet: true }
  if (chat.isMuted) return { save: false, reason: 'muted', quiet: true }
  if (chat.type === 'group' && !rule.groups) return { save: false, reason: `groups are off for ${network}` }
  return { save: true }
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

function selfName(account: BeeperAccount | undefined, ownerName?: string): string {
  return account?.user?.fullName?.trim() || account?.user?.username?.trim() || ownerName?.trim() || 'Me'
}

function counterpart(chat: BeeperChat, account: BeeperAccount | undefined, names?: SenderNames): string {
  const other = otherSide(chat, account)
  return (
    notebookName(other, names) ||
    other?.fullName?.trim() ||
    lookedUp(other, names)?.name ||
    other?.username?.trim() ||
    chat.title ||
    'Unknown'
  )
}

function senderOf(
  message: BeeperMessage,
  chat: BeeperChat,
  account: BeeperAccount | undefined,
  names?: SenderNames,
  ownerName?: string,
): string {
  if (message.isSender) return selfName(account, ownerName)
  const person =
    chat.participants?.items.find((candidate) => candidate.id === message.senderID) ??
    (chat.type === 'single' ? otherSide(chat, account) : undefined)
  const own = notebookName(person, names)
  if (own) return own
  const named = message.senderName?.trim()
  if (named && !nameless(named, person)) return named
  return lookedUp(person, names)?.name || named || person?.fullName?.trim() || person?.username?.trim() || 'Unknown'
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
  /** The words of a voice note, which name a message that has no text of its own */
  transcript?: string
  /** The message is a voice note; its length when known */
  voice?: { seconds: number | null }
}

/** Seconds as m:ss, or h:mm:ss past the hour */
function clock(seconds: number): string {
  const whole = Math.round(seconds)
  const pad = (n: number) => String(n).padStart(2, '0')
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** The message heading; a voice note says so after the name, with its length when known */
function heading(section: Section): string {
  const voice = section.voice
    ? ` (voice note${section.voice.seconds !== null ? `, ${clock(section.voice.seconds)}` : ''})`
    : ''
  return `## ${section.when.date} ${section.when.time} - **${section.sender}**${voice}`
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

/** How far behind the newest message a chat has shown a run looks again, for messages that arrive out of order */
const LOOK_BACK_MS = 3_600_000

/**
 * The chat's messages newer than the floor — the boundary on first contact,
 * else an hour before the newest message the chat has shown — read
 * newest-first: the first page, then older pages while a page is still
 * entirely newer than the floor. Beeper's iMessage bridge answers no older
 * page and reads an `after` cursor as the start of history
 * (docs/2026-10-20-beeper-pages-imessage-only-forward.md), so the walk never
 * asks for `after`; `unreached` says an older page was still needed and refused.
 */
async function newMessages(
  client: BeeperSource,
  chat: BeeperChat,
  chatState: ChatState,
  boundaryMs: number,
  limit: number,
): Promise<{ messages: BeeperMessage[]; unreached: boolean }> {
  const mark = chatState.newest ? instantMs(chatState.newest) : null
  const floorMs = mark === null ? boundaryMs : Math.max(boundaryMs, mark - LOOK_BACK_MS)
  const collected: BeeperMessage[] = []
  let page = await client.messages(chat.id)
  for (;;) {
    let reachedFloor = false
    for (const message of page.items) {
      const at = instantMs(message.timestamp)
      if (at !== null && at < floorMs) reachedFloor = true
      else collected.push(message)
    }
    if (reachedFloor || !page.hasMore || !page.oldestCursor || collected.length >= limit) {
      return { messages: collected, unreached: false }
    }
    const older = await client.messages(chat.id, { cursor: page.oldestCursor, direction: 'before' })
    if (!older.items.length) return { messages: collected, unreached: true }
    page = older
  }
}

/** The newest instant among the messages and the one the chat already kept */
function newestInstant(messages: BeeperMessage[], kept?: string): string | undefined {
  let best = kept
  let bestMs = kept ? instantMs(kept) : null
  for (const message of messages) {
    const at = instantMs(message.timestamp)
    if (at !== null && (bestMs === null || at > bestMs)) {
      best = message.timestamp
      bestMs = at
    }
  }
  return best
}

export async function syncBeeper(options: BeeperSyncOptions): Promise<BeeperSyncResult> {
  const log = options.log ?? (() => {})
  const backfillDays = options.backfillDays ?? 7
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
    accountsOff: [],
    held: [],
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
  const listed = await options.client.accounts()
  const rulesChanged = reconcileAccountRules(state, listed)
  if (rulesChanged && !options.dryRun) await saveState(options.stateFile, state)
  for (const account of listed) {
    if (isSlackAccount(account)) {
      result.accountsSkipped.push(networkOf(account))
      continue
    }
    if (!state.accounts[account.accountID]?.save) result.accountsOff.push(networkOf(account))
    accounts.set(account.accountID, account)
  }

  for (const [id, entry] of Object.entries(state.held)) {
    if ((instantMs(entry.at) ?? 0) < boundaryMs) delete state.held[id]
  }

  const chats = await activeChats(options.client, Instant.fromEpochMilliseconds(sinceMs).toString(), chatLimit)
  result.complete = chats.complete
  for (const chat of chats.items) {
    const account = accounts.get(chat.accountID)
    const label = chatLabel(chat, account, options.names)
    const verdict = judgeChat(chat, account, state.accounts[chat.accountID])
    if (!verdict.save) {
      if (!verdict.quiet) result.skipped.push({ chat: label, reason: verdict.reason })
      continue
    }
    const chatState: ChatState = state.chats[chat.id] ?? { title: '', network: '', seen: [], files: {} }
    const network = chat.network.trim() || account?.network?.trim() || 'Beeper'
    const fetched = await newMessages(options.client, chat, chatState, boundaryMs, messageLimit)
    const newest = newestInstant(fetched.messages, chatState.newest)
    if (fetched.unreached) {
      result.notes.push(`${label}: Beeper gave no older page; messages before the oldest shown were not reached.`)
    }
    const seen = new Set(chatState.seen)
    const fresh = fetched.messages
      .filter(keep)
      .filter((message) => !seen.has(message.id))
      .map((message) => ({ message, at: instantMs(message.timestamp) }))
      .filter((entry): entry is { message: BeeperMessage; at: number } => entry.at !== null && entry.at >= boundaryMs)
      .sort((a, b) => a.at - b.at || a.message.sortKey.localeCompare(b.message.sortKey))
    result.chats += 1

    // Someone with no name in the contacts, never answered: held for a look,
    // nothing written, nothing kept — so a Save later pulls the whole window.
    const rule = state.accounts[chat.accountID]
    const who = rule?.holdUnknown && !chatState.known ? unknownSender(chat, account, options.names) : null
    if (who && !fetched.messages.some((message) => message.isSender)) {
      const newest = fresh.at(-1)?.message ?? fetched.messages.find(keep)
      if (newest) {
        state.held[chat.id] = {
          network,
          who,
          first: summarize(beeperText(newest.text), 'Message'),
          at: newest.timestamp,
          count: fetched.messages.filter(keep).length,
        }
        result.held.push({ chat: who, network })
        if (!options.dryRun) await saveState(options.stateFile, state)
      }
      continue
    }
    if (state.held[chat.id]) {
      delete state.held[chat.id]
      if (!options.dryRun) await saveState(options.stateFile, state)
    }

    if (!fresh.length) {
      if (!options.dryRun) {
        state.chats[chat.id] = {
          ...chatState,
          title: chat.title,
          network,
          ...(newest ? { newest } : {}),
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
        sender: senderOf(message, chat, account, options.names, options.ownerName),
        text: beeperText(message.text),
        lines: [],
        attachments: [],
        fallback: 'Message',
      }
      for (const attachment of message.attachments ?? []) {
        const kind = attachmentKind(attachment)
        section.fallback = kind
        let transcript = attachment.transcription?.transcription?.trim() || undefined
        const name = attachment.fileName?.trim() || `${kind.toLowerCase().replace(/\s+/g, '-')}`
        let saved: string | undefined
        const skip =
          attachment.isSticker ||
          attachment.isGif ||
          options.dryRun ||
          savedAttachments >= attachmentLimit ||
          (attachment.fileSize ?? 0) > MAX_ATTACHMENT_BYTES
        if (!skip) {
          let data: Buffer | undefined
          try {
            data = await loadAttachment(options, attachment)
            if (data) saved = await saveAttachment(options, data, name, when.plainDate, network)
            if (saved) savedAttachments += 1
          } catch (error) {
            result.notes.push(
              `${label}: ${name} could not be saved (${error instanceof Error ? error.message : 'unknown error'}).`,
            )
          }
          // A voice note Beeper hands over without words: Sky's own provider listens
          if (data && attachment.isVoiceNote && !transcript && options.transcribe) {
            try {
              transcript = (await options.transcribe(data, name)).trim() || undefined
            } catch (error) {
              result.notes.push(
                `${label}: ${name} could not be transcribed (${error instanceof Error ? error.message : 'unknown error'}).`,
              )
            }
          }
        }
        if (saved) section.attachments.push({ file: saved })
        if (attachment.isVoiceNote) {
          let seconds: number | null = null
          if (saved && options.duration) {
            try {
              seconds = await options.duration(
                path.join(options.attachmentsDir, dayAttachmentsDir(when.plainDate), saved),
              )
            } catch {
              // No way to measure it: the heading says voice note without a length
            }
          }
          section.voice ??= { seconds }
        }
        if (attachment.isVoiceNote && transcript) {
          section.lines.push(`🎤 ${transcript}`)
          section.transcript ??= transcript
        } else section.lines.push(`📎 ${saved ?? name}`)
      }
      const list = days.get(when.date) ?? []
      list.push(section)
      days.set(when.date, list)
    }

    for (const [date, sections] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      const day = PlainDate.fromString(date)
      const existing = chatState.files[date]
      const single = chat.type === 'single'
      const person = single ? counterpart(chat, account, options.names) : ''
      // A first name names the file; a number stays whole, since its first "word" would be the country code
      const who = single
        ? nameless(person, otherSide(chat, account))
          ? person
          : firstName(person)
        : chat.title || 'Group'
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
      const from = single ? person : first.sender
      const to = single ? selfName(account, options.ownerName) : chat.title || 'Group'
      const summary = summarize(first.text || first.transcript || '', first.fallback)
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
        // The capture may land on a day that has no day file yet
        await ensureDay(day, options.timeDir)
        let dayDoc = await readDay(day, options.timeDir)
        const entry = first.voice && !first.text ? `Voice note: ${summary}` : summary
        dayDoc = dayDoc.setCompleteItem(`${first.when.time} > ${who} ${network}`, `[${entry}](${rel})`, {
          time: first.when.time,
          category,
        })
        await writeDay(dayDoc, options.timeDir)
      } catch (err) {
        result.notes.push(
          `${date}'s day file could not be updated (${(err as Error).message}); the ${network} capture is saved without a day entry.`,
        )
      }
    }

    if (!options.dryRun) {
      const ids = [...chatState.seen, ...fresh.map(({ message }) => message.id)]
      state.chats[chat.id] = {
        title: chat.title,
        network,
        ...(chatState.known ? { known: true } : {}),
        ...(newest ? { newest } : {}),
        seen: ids.slice(-SEEN_LIMIT),
        files: chatState.files,
      }
      await saveState(options.stateFile, state)
    }
  }
  if (!options.dryRun) {
    if (result.complete) state.lastSync = options.now
    state.lastRun = {
      at: options.now,
      chats: result.chats,
      messages: result.messages,
      files: result.files.length,
      skipped: result.skipped.slice(0, SKIPPED_LIMIT),
      accountsOff: result.accountsOff,
      complete: result.complete,
    }
    await saveState(options.stateFile, state)
  }
  return result
}

/** Copy one attachment into the day's attachments folder; the saved name, or nothing when Beeper has no file. */
/** The attachment's bytes: Beeper's own file when it names one, else what Beeper downloads on request. */
async function loadAttachment(options: BeeperSyncOptions, attachment: BeeperAttachment): Promise<Buffer | undefined> {
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
  return data.byteLength > MAX_ATTACHMENT_BYTES ? undefined : data
}

async function saveAttachment(
  options: BeeperSyncOptions,
  data: Buffer,
  name: string,
  day: PlainDate,
  network: string,
): Promise<string | undefined> {
  const ext = path.extname(name)
  const stem = name.slice(0, ext ? -ext.length : undefined)
  const attachDir = path.join(options.attachmentsDir, dayAttachmentsDir(day))
  await mkdir(attachDir, { recursive: true })
  const desired = `${day}_${slugify(network, { preserveCase: true }) || 'Beeper'}_${slugify(stem, { preserveCase: true, suggestedLength: 60 }) || 'file'}${ext}`
  return writeFileDedup(data, attachDir, desired)
}
