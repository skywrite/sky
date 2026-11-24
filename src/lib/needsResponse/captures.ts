import { readdir } from 'node:fs/promises'
import * as path from 'node:path'
import { parseDmRecord, type DmRecord } from '#commands/all/slack/land/lib/dms.ts'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { hash, missing, readOptional } from '#lib/outbox/files.ts'
import { beeperCapture } from '#lib/outbox/sources.ts'
import Follow from '#shared/models/Follow/mod.ts'
import MessageDocument from '#shared/models/Message/document/mod.ts'
import { parseSlackConversation } from '#shared/models/Message/slack/parse.ts'
import { dayActionDir } from '#shared/nbfs/mod.ts'
import { resolveTimeRef, toTimeRef } from '#shared/nbfs/timeRef.ts'
import { Instant, PlainDate, PlainDateTime, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import { NEEDS_RESPONSE_EXPIRY_DAYS } from './score.ts'
import { isAutomatedSender, isOwnerAuthor } from './sender.ts'
import type { NeedsResponseCandidate, NeedsResponseKind, NeedsResponseTarget } from './types.ts'

export interface CaptureScanOptions {
  markdownBaseDir: string
  timeDir: string
  /** Optional `state/slack/dms` directory to accurately classify Slack DMs vs group DMs. */
  slackDmsDir?: string
  /** Optional `state/follow/slack/active` directory to include active multi-day Slack threads. */
  slackFollowActiveDir?: string
  today: PlainDate
  now: Instant
  timezone: string
  ownerNames: readonly string[]
  ownerAddresses?: readonly string[]
  lookbackDays?: number
}

interface ParsedTurn {
  normalizedTime: string
  author: string
  body: string
  timezone: string
}

interface LoadedCapture {
  relPath: string
  doc: MessageDocument
  medium: 'Slack' | 'Beeper' | 'Email'
  sourceLabel: string
  beeper: { chat: string; account: string; group: boolean } | null
  slackLink?: { origin: string; channelId: string; rootTs: string; fullLink: string }
  followName?: string
  previousRelPath?: string
  turns: ParsedTurn[]
  timezone: string
}

const HEADING_TURN = /^## (\d{4}-\d{2}-\d{2} \d{1,2}:\d{2})(?:[^\n]*?)\*\*(.+?)\*\*/gm
const MAX_TRANSCRIPT_TURNS = 8
const MAX_TRANSCRIPT_CHARS = 8_000
const MAX_SUMMARY_CHARS = 120
const MAX_PREVIOUS_HOPS = 5

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when a Slack message explicitly `@mentions` one of the owner's names (not a substring or email). */
export function mentionsOwner(text: string, ownerNames: readonly string[]): boolean {
  if (!text.includes('@')) return false
  for (const raw of ownerNames) {
    const name = raw.trim()
    if (!name) continue
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])@${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}_-])`, 'iu')
    if (pattern.test(text)) return true
  }
  return false
}

function parseNonSlackTurns(
  markdown: string,
  fallbackTime: string | undefined,
  fallbackAuthor: string,
  timezone: string,
): ParsedTurn[] {
  const matches = [...markdown.matchAll(HEADING_TURN)]
  if (matches.length === 0) {
    const trimmed = markdown.trim()
    if (!trimmed || !fallbackTime) return []
    const normalized = PlainDateTime.fromString(fallbackTime).normalize().toString()
    return [{ normalizedTime: normalized, author: fallbackAuthor, body: trimmed, timezone }]
  }
  const turns: ParsedTurn[] = []
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const nextStart = matches[i + 1]?.index ?? markdown.length
    const bodyStart = (match.index ?? 0) + match[0].length
    const body = markdown.slice(bodyStart, nextStart).trim()
    try {
      const normalized = PlainDateTime.fromString(match[1]).normalize().toString()
      turns.push({ normalizedTime: normalized, author: match[2].trim(), body, timezone })
    } catch {
      // Skip malformed timestamp headings
    }
  }
  return turns
}

function parseDocTurns(doc: MessageDocument, defaultTimezone: string): ParsedTurn[] {
  const timezone = typeof doc.yaml.tz === 'string' && doc.yaml.tz.trim() ? doc.yaml.tz.trim() : defaultTimezone
  if (doc.medium === 'Slack') {
    const parsed = parseSlackConversation(doc.markdown)
    const turns: ParsedTurn[] = []
    for (const msg of parsed.messages) {
      try {
        const normalized = PlainDateTime.fromString(msg.timestamp).normalize().toString()
        turns.push({ normalizedTime: normalized, author: msg.author.trim(), body: msg.body.trim(), timezone })
      } catch {
        // Ignore unparseable message headings
      }
    }
    return turns
  }
  const fallbackTime = doc.yaml.when ? doc.when.datetime.normalize().toString() : undefined
  const fallbackAuthor = typeof doc.yaml.from === 'string' ? doc.yaml.from.trim() : ''
  return parseNonSlackTurns(doc.markdown, fallbackTime, fallbackAuthor, timezone)
}

function toInstant(normalizedLocal: string, timezone: string): Instant | null {
  try {
    const pdt = PlainDateTime.fromString(normalizedLocal).normalize()
    const zdt = new ZonedDateTime({ date: pdt.date, time: pdt.time, timezone })
    return Instant.fromEpochMilliseconds(zdt.epochMilliseconds)
  } catch {
    return null
  }
}

function resolvePreviousRelPath(currentRelPath: string, previous: string): string | undefined {
  const cleaned = previous.trim()
  if (!cleaned) return undefined
  const normalized = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`
  // Handle Sky's timeRef shorthand (`DD/...`, `MM-DD/...`, `YYYY-MM-DD/...`) first.
  if (/^(?:\d{2}|\d{2}-\d{2}|\d{4}-\d{2}-\d{2})\//.test(normalized)) {
    try {
      const currentRef = toTimeRef(currentRelPath)
      const [date] = currentRef.split('/')
      let full = normalized
      if (/^\d{2}\//.test(full)) full = `${date.slice(0, 8)}${full}`
      else if (/^\d{2}-\d{2}\//.test(full)) full = `${date.slice(0, 5)}${full}`
      return resolveTimeRef(full).split(path.sep).join('/')
    } catch {
      return undefined
    }
  }
  const baseDir = path.dirname(currentRelPath)
  const resolved = path.posix.normalize(path.posix.join(baseDir, normalized))
  if (resolved.startsWith('..')) return undefined
  return resolved
}

function summarizeBody(body: string, fallback = ''): string {
  const text = body
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^>+\s*/gm, '')
    .replace(/`{1,3}([^`]+)`{1,3}/g, '$1')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const chosen = text || fallback.trim()
  if (chosen.length <= MAX_SUMMARY_CHARS) return chosen
  return `${chosen.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`
}

function extractSenderParts(raw: string): { name: string; email?: string; phone?: string } {
  const trimmed = raw.trim()
  const angled = trimmed.match(/^(.*?)<([^<>]+)>$/)
  if (angled) {
    const name = angled[1].replace(/^"|"$/g, '').trim()
    const addr = angled[2].trim()
    return {
      name: name || addr,
      ...(addr.includes('@') ? { email: addr } : {}),
    }
  }
  if (trimmed.includes('@')) return { name: trimmed, email: trimmed }
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length >= 7 && /^[+\d\s().-]+$/.test(trimmed)) {
    return { name: trimmed, phone: trimmed }
  }
  return { name: trimmed }
}

async function loadSlackDmRecords(dir: string | undefined): Promise<Map<string, DmRecord>> {
  const records = new Map<string, DmRecord>()
  if (!dir) return records
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (missing(error)) return records
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const id = entry.name.slice(0, -5)
    const content = await readOptional(path.join(dir, entry.name))
    const parsed = parseDmRecord(content, id)
    if (parsed) records.set(parsed.id, parsed)
  }
  return records
}

async function collectActiveFollowPaths(dir: string | undefined, cutoffYmd: string): Promise<string[]> {
  if (!dir) return []
  const paths: string[] = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (missing(error)) return paths
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.yaml')) continue
    const content = await readOptional(path.join(dir, entry.name))
    if (!content) continue
    try {
      const follow = Follow.fromYaml(content)
      if (follow.lastActivity && follow.lastActivity.date < cutoffYmd) continue
      for (const msg of follow.messages) {
        if (msg.path) paths.push(msg.path)
      }
    } catch {
      // Ignore unreadable follow files
    }
  }
  return paths
}

function formatSlackDisplayLabel(
  doc: MessageDocument,
  dmRecord: DmRecord | undefined,
  kind: NeedsResponseKind,
): string | undefined {
  if (kind === 'dm') return undefined
  if (kind === 'group') return dmRecord?.label || (typeof doc.yaml.to === 'string' ? doc.yaml.to : undefined)
  if (typeof doc.yaml.channel === 'string' && doc.yaml.channel.trim()) {
    const ch = doc.yaml.channel.trim()
    return ch.startsWith('#') ? ch : `#${ch}`
  }
  if (typeof doc.yaml.what === 'string' && doc.yaml.what.trim()) {
    const match = doc.yaml.what.match(/#[\w-]+/)
    if (match) return match[0]
  }
  return undefined
}

function buildTranscript(turns: readonly ParsedTurn[]): string {
  const recent = turns.slice(-MAX_TRANSCRIPT_TURNS)
  const lines = recent.map((turn) => `[${turn.normalizedTime}] ${turn.author}: ${turn.body}`)
  const joined = lines.join('\n\n')
  if (joined.length <= MAX_TRANSCRIPT_CHARS) return joined
  return joined.slice(joined.length - MAX_TRANSCRIPT_CHARS)
}

/**
 * Scan recent captured Slack and Beeper conversations in `actions/messages/`
 * across the rolling window, joining multi-day threads so replies on a later day
 * automatically clear earlier unanswered messages.
 */
export async function scanCapturedConversations(options: CaptureScanOptions): Promise<NeedsResponseCandidate[]> {
  const lookbackDays = options.lookbackDays ?? NEEDS_RESPONSE_EXPIRY_DAYS
  const cutoffYmd = options.today.addDays(-lookbackDays).ymd
  const cutoffMs = options.now.epochMilliseconds - lookbackDays * 24 * 3_600_000
  const ownerAddresses = options.ownerAddresses ?? []

  const dmRecords = await loadSlackDmRecords(options.slackDmsDir)
  const relPaths = new Set<string>()

  // 1. Walk recent day message directories (lookbackDays + 1 covers timezone boundaries).
  for (let back = 0; back <= lookbackDays + 1; back++) {
    const day = options.today.addDays(-back)
    const actionDir = path.join(options.timeDir, dayActionDir('message', day))
    let entries
    try {
      entries = await readdir(actionDir, { withFileTypes: true })
    } catch (error) {
      if (missing(error)) continue
      throw error
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const absPath = path.join(actionDir, entry.name)
      relPaths.add(path.relative(options.markdownBaseDir, absPath).split(path.sep).join('/'))
    }
  }

  // 2. Include recent DM docs & active Slack follow docs so multi-day continuations stay linked.
  for (const record of dmRecords.values()) {
    if (record.lastActivity && record.lastActivity.slice(0, 10) < cutoffYmd) continue
    for (const doc of record.docs) {
      if (doc.date >= cutoffYmd) relPaths.add(doc.path.replace(/^\/+/, ''))
    }
  }
  for (const followPath of await collectActiveFollowPaths(options.slackFollowActiveDir, cutoffYmd)) {
    relPaths.add(followPath.replace(/^\/+/, ''))
  }

  // 3. Load and parse each capture, skipping Email (handled directly by Gmail Inbox scan) and other media.
  // Follow `previous:` links up to MAX_PREVIOUS_HOPS so threads started before the 7-day window retain owner participation.
  const captures = new Map<string, LoadedCapture>()
  const loadCapture = async (relPath: string): Promise<LoadedCapture | null> => {
    const absPath = path.join(options.markdownBaseDir, relPath)
    const content = await readOptional(absPath)
    if (!content) return null
    let doc: MessageDocument
    try {
      doc = MessageDocument.fromMarkdown(content)
      if (doc.yamlError) return null
    } catch {
      return null
    }

    const beeper = beeperCapture(doc)
    const isSlack = doc.medium === 'Slack'
    if (!beeper && !isSlack) return null

    const rawLink = typeof doc.yaml.link === 'string' ? doc.yaml.link.trim() : undefined
    let slackLink: LoadedCapture['slackLink']
    if (isSlack && rawLink) {
      const parsed = parseMessageLink(rawLink)
      if (parsed) {
        try {
          const url = new URL(rawLink)
          if (url.protocol === 'https:' && url.hostname.endsWith('.slack.com')) {
            slackLink = { origin: url.origin, channelId: parsed.channelId, rootTs: parsed.rootTs, fullLink: rawLink }
          }
        } catch {
          // Ignore invalid URL
        }
      }
    }

    const timezone = typeof doc.yaml.tz === 'string' && doc.yaml.tz.trim() ? doc.yaml.tz.trim() : options.timezone
    const turns = parseDocTurns(doc, timezone)
    if (turns.length === 0) return null

    const previousRelPath = doc.previous ? resolvePreviousRelPath(relPath, doc.previous) : undefined
    return {
      relPath,
      doc,
      medium: beeper ? 'Beeper' : 'Slack',
      sourceLabel: beeper ? doc.medium || 'Beeper' : 'Slack',
      beeper,
      slackLink,
      followName: typeof doc.yaml.follow === 'string' ? doc.yaml.follow.trim() : undefined,
      previousRelPath,
      turns,
      timezone,
    }
  }

  const pendingPaths: Array<{ relPath: string; depth: number }> = [...relPaths].map((relPath) => ({
    relPath,
    depth: 0,
  }))
  const visitedPaths = new Set<string>(relPaths)
  while (pendingPaths.length > 0) {
    const { relPath, depth } = pendingPaths.shift()!
    const cap = await loadCapture(relPath)
    if (!cap) continue
    captures.set(relPath, cap)
    if (cap.previousRelPath && depth < MAX_PREVIOUS_HOPS && !visitedPaths.has(cap.previousRelPath)) {
      visitedPaths.add(cap.previousRelPath)
      pendingPaths.push({ relPath: cap.previousRelPath, depth: depth + 1 })
    }
  }

  // 4. Union-Find across related capture files so cross-day replies join into one conversation.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let cur = x
    while (parent.get(cur) !== cur) cur = parent.get(cur)!
    let p = x
    while (p !== cur) {
      const next = parent.get(p)!
      parent.set(p, cur)
      p = next
    }
    return cur
  }
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(rb, ra)
  }

  for (const key of captures.keys()) parent.set(key, key)

  const byIdentity = new Map<string, string>()
  const linkIdentity = (identity: string, relPath: string) => {
    const existing = byIdentity.get(identity)
    if (existing) union(existing, relPath)
    else byIdentity.set(identity, relPath)
  }

  for (const cap of captures.values()) {
    if (cap.beeper) {
      linkIdentity(`Beeper:${cap.beeper.account}:${cap.beeper.chat}`, cap.relPath)
    } else if (cap.slackLink) {
      const isDmChannel = cap.slackLink.channelId.startsWith('D') || dmRecords.has(cap.slackLink.channelId)
      if (isDmChannel) {
        linkIdentity(`Slack:dm:${cap.slackLink.origin}:${cap.slackLink.channelId}`, cap.relPath)
      } else {
        linkIdentity(
          `Slack:thread:${cap.slackLink.origin}:${cap.slackLink.channelId}:${cap.slackLink.rootTs}`,
          cap.relPath,
        )
      }
    }
    if (cap.followName) {
      linkIdentity(`${cap.medium}:follow:${cap.followName}`, cap.relPath)
    }
    if (cap.previousRelPath && captures.has(cap.previousRelPath)) {
      union(cap.relPath, cap.previousRelPath)
    }
  }

  // Also link files named together inside the same Slack DM record.
  for (const record of dmRecords.values()) {
    const members = record.docs.map((d) => d.path.replace(/^\/+/, '')).filter((p) => captures.has(p))
    for (let i = 1; i < members.length; i++) union(members[0], members[i])
  }

  // 5. Group captures by root and evaluate each conversation.
  const groups = new Map<string, LoadedCapture[]>()
  for (const cap of captures.values()) {
    const root = find(cap.relPath)
    const list = groups.get(root) ?? []
    list.push(cap)
    groups.set(root, list)
  }

  const candidates: NeedsResponseCandidate[] = []

  for (const group of groups.values()) {
    group.sort((a, b) => a.relPath.localeCompare(b.relPath))
    const latestDoc = group.at(-1)!

    // Deduplicate identical turns across overlapping day captures and sort chronologically.
    const seenTurn = new Set<string>()
    const allTurns: ParsedTurn[] = []
    for (const cap of group) {
      for (const turn of cap.turns) {
        const key = `${turn.normalizedTime}|${turn.author}|${turn.body.slice(0, 120)}`
        if (seenTurn.has(key)) continue
        seenTurn.add(key)
        allTurns.push(turn)
      }
    }
    allTurns.sort((a, b) => a.normalizedTime.localeCompare(b.normalizedTime))
    if (allTurns.length === 0) continue

    const lastTurn = allTurns.at(-1)!

    // Auto-clear: if the owner sent the latest message, no response is owed.
    if (isOwnerAuthor(lastTurn.author, options.ownerNames, ownerAddresses)) continue

    const receivedInstant = toInstant(lastTurn.normalizedTime, lastTurn.timezone)
    if (!receivedInstant) continue
    if (receivedInstant.epochMilliseconds < cutoffMs) continue
    if (receivedInstant.epochMilliseconds > options.now.epochMilliseconds + 3_600_000) continue

    const sender = extractSenderParts(lastTurn.author)
    if (isAutomatedSender({ name: sender.name, email: sender.email })) continue

    const lastOwnerIdx = allTurns.findLastIndex((turn) =>
      isOwnerAuthor(turn.author, options.ownerNames, ownerAddresses),
    )
    const ownerParticipated = lastOwnerIdx >= 0
    const unansweredTurns = allTurns.slice(lastOwnerIdx + 1)
    const ownerMentioned = unansweredTurns.some((turn) => mentionsOwner(turn.body, options.ownerNames))
    const hasPriorHistory = group.some((cap) => Boolean(cap.previousRelPath))
    const resolvedBeeperName = Boolean(latestDoc.beeper && sender.name && !sender.phone && !sender.email)

    // Determine canonical conversation ID, kind, and native app destination.
    let id: string
    let kind: NeedsResponseKind
    let target: NeedsResponseTarget | null = null
    let contextLabel: string | undefined

    if (latestDoc.beeper) {
      id = `Beeper:${latestDoc.beeper.account}:${latestDoc.beeper.chat}`
      kind = latestDoc.beeper.group ? 'group' : 'dm'
      target = {
        medium: 'Beeper',
        account: latestDoc.beeper.account,
        chat: latestDoc.beeper.chat,
        network: latestDoc.sourceLabel,
      }
      if (kind === 'group' && typeof latestDoc.doc.yaml.to === 'string') {
        contextLabel = latestDoc.doc.yaml.to
      }
    } else {
      const linkInfo = [...group].reverse().find((c) => c.slackLink)?.slackLink
      const dmRecord = linkInfo ? dmRecords.get(linkInfo.channelId) : undefined
      const isDmChannel = Boolean(linkInfo?.channelId.startsWith('D'))

      if (dmRecord) {
        kind = dmRecord.kind
        id = `Slack:dm:${linkInfo!.origin}:${linkInfo!.channelId}`
      } else if (isDmChannel && linkInfo) {
        kind = 'dm'
        id = `Slack:dm:${linkInfo.origin}:${linkInfo.channelId}`
      } else {
        // Non-DM Slack channel threads (e.g. manually followed FYI threads) only involve
        // the owner when they participated in the thread or were explicitly @mentioned.
        if (!ownerParticipated && !ownerMentioned) continue
        kind = ownerMentioned ? 'mention' : 'thread'
        id = linkInfo
          ? `Slack:thread:${linkInfo.origin}:${linkInfo.channelId}:${linkInfo.rootTs}`
          : `Slack:saved:${group[0].relPath}`
      }

      if (linkInfo) {
        target = { medium: 'Slack', link: linkInfo.fullLink }
      }
      contextLabel = formatSlackDisplayLabel(latestDoc.doc, dmRecord, kind)
    }

    const version = hash(
      JSON.stringify({
        time: lastTurn.normalizedTime,
        author: lastTurn.author,
        body: lastTurn.body.slice(0, 400),
      }),
    ).slice(0, 16)

    candidates.push({
      id,
      version,
      source: latestDoc.sourceLabel,
      medium: latestDoc.medium,
      kind,
      senderName: sender.name,
      ...(sender.email ? { senderEmail: sender.email } : {}),
      ...(sender.phone ? { senderPhone: sender.phone } : {}),
      ...(contextLabel ? { contextLabel } : {}),
      summary: summarizeBody(lastTurn.body, typeof latestDoc.doc.yaml.what === 'string' ? latestDoc.doc.yaml.what : ''),
      receivedAt: receivedInstant.toString(),
      receivedLocal: lastTurn.normalizedTime,
      ownerParticipated,
      ...(hasPriorHistory ? { hasPriorHistory: true } : {}),
      ...(resolvedBeeperName ? { resolvedBeeperName: true } : {}),
      transcript: buildTranscript(allTurns),
      target,
      savedPath: latestDoc.relPath,
    })
  }

  return candidates
}
