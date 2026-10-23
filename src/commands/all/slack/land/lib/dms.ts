import * as path from 'node:path'
import type { SlackCaptureMessage } from '#commands/all/slack/lib/captureMessages.ts'
import { type SlackFollowSyncHost, syncSlackFollow } from '#commands/all/slack/lib/syncFollow.ts'
import { compareTs } from '#commands/all/slack/pull/lib/ts.ts'
import { atomicWrite, readOptional } from '#lib/outbox/files.ts'
import Follow from '#shared/models/Follow/mod.ts'
import { parse, stringify } from '#shared/yaml/mod.ts'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'

export type DmDoc = { date: string; path: string }

/**
 * One direct or group conversation the landing keeps up: Sky's cursor into
 * it and the day documents it wrote. Kept apart from the follow ledger,
 * which polls thread roots; a conversation has no root to poll, the
 * activity feed says when it moved.
 */
export type DmRecord = {
  id: string
  kind: 'dm' | 'group'
  /** The other people, for the document and the page */
  label: string
  /** ts of the newest message landed */
  cursor?: string
  docs: DmDoc[]
  /** Local date-time of the newest message landed */
  lastActivity?: string
}

export function dmRecordPath(dir: string, id: string): string {
  return path.join(dir, `${id}.yaml`)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

export function parseDmRecord(contents: string | undefined, id: string): DmRecord | undefined {
  if (!contents?.trim()) return undefined
  const data = parse(contents) as Record<string, unknown> | null
  if (!data) return undefined
  const docs: DmDoc[] = []
  for (const entry of Array.isArray(data.docs) ? data.docs : []) {
    const record = entry as Record<string, unknown> | null
    const date = text(record?.date)
    const docPath = text(record?.path)
    if (date && docPath) docs.push({ date, path: docPath })
  }
  return {
    id: text(data.id) ?? id,
    kind: data.kind === 'group' ? 'group' : 'dm',
    label: text(data.label) ?? id,
    ...(text(data.cursor) ? { cursor: text(data.cursor) } : {}),
    docs,
    ...(text(data.lastActivity) ? { lastActivity: text(data.lastActivity) } : {}),
  }
}

export function serializeDmRecord(record: DmRecord): string {
  return stringify({
    id: record.id,
    kind: record.kind,
    label: record.label,
    ...(record.cursor ? { cursor: record.cursor } : {}),
    ...(record.lastActivity ? { lastActivity: record.lastActivity } : {}),
    ...(record.docs.length > 0 ? { docs: record.docs } : {}),
  })
}

export async function readDmRecord(dir: string, id: string): Promise<DmRecord | undefined> {
  return parseDmRecord(await readOptional(dmRecordPath(dir, id)), id)
}

export async function writeDmRecord(dir: string, record: DmRecord): Promise<void> {
  await atomicWrite(dmRecordPath(dir, record.id), serializeDmRecord(record))
}

/** Who a conversation's document is addressed to: the others, or the owner when one of the others wrote. */
export function recipientOf(
  record: { kind: 'dm' | 'group'; label: string },
  members: readonly string[],
  from: string,
  selfName?: string,
): string {
  if (record.kind === 'dm') {
    const partner = members[0] ?? record.label
    return from === partner ? (selfName ?? partner) : partner
  }
  const others = members.filter((name) => name !== from)
  return others.length > 0 ? others.join(', ') : record.label
}

/**
 * Land a conversation's new messages the way a follow lands replies: one
 * document per notebook day, appended to on later passes, earlier days
 * never rewritten. The record's documents stand in for a follow's, and the
 * cursor moves to the newest message handled.
 */
export async function syncDmRecord(
  record: DmRecord,
  messages: readonly SlackCaptureMessage[],
  host: Omit<SlackFollowSyncHost, 'saveFollow'>,
): Promise<{ record: DmRecord; newMessages: number }> {
  const follow = Follow.create({
    source: 'Slack',
    ref: { channel: record.id },
    summary: record.label,
    messages: record.docs,
    lastActivity: record.lastActivity ? PlainDateTime.fromString(record.lastActivity) : undefined,
    landed: true,
  })
  const synced = await syncSlackFollow(follow, messages, { ...host, saveFollow: async () => {} })
  const cursor = messages.reduce<string | undefined>(
    (max, message) => (max === undefined || compareTs(message.ts, max) > 0 ? message.ts : max),
    record.cursor,
  )
  const lastActivity = synced.lastActivity
    ? `${synced.lastActivity.date} ${synced.lastActivity.time}`
    : record.lastActivity
  return {
    record: {
      ...record,
      docs: synced.follow.messages,
      ...(cursor ? { cursor } : {}),
      ...(lastActivity ? { lastActivity } : {}),
    },
    newMessages: synced.newReplies,
  }
}
