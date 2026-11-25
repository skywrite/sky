import { Instant, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { marksPassed } from './clock.ts'
import { QUICK_REPLY_MAX_MARKS, RESPONSE_POINTS } from './marks.ts'
import type { DayOf } from './notebookDay.ts'

/** How a wait ended: a reply Sky saw, the owner ticking the message, or a week with no reply. */
export type EarnedHow = 'replied' | 'checked' | 'expired'

/** One finished wait and what it earned. */
export interface EarnedEntry {
  /** Conversation key, the same as the list item's id. */
  id: string
  /** UTC instant the wait began. */
  waitingSince: string
  /** UTC instant it ended. */
  closedAt: string
  /**
   * The day it counts for, `YYYY-MM-DD`: the notebook day that was open when the wait ended.
   * Kept on the entry so a day's total never changes once the next day is started.
   */
  day: string
  how: EarnedHow
  /** Marks passed by then: 0 is inside the first mark. A week with no reply counts as every mark passed. */
  marks: number
  points: number
  /** False for a quick reply to a message that never reached the Needs response list. */
  listed: boolean
}

export interface EarnedFile {
  version: 1
  entries: EarnedEntry[]
}

/** The score page shows 30 days; the rest is kept so a week's total survives a long weekend away. */
export const EARNED_RETENTION_DAYS = 60

export interface ResponseScoreDay {
  /** Calendar date, `YYYY-MM-DD`. */
  date: string
  points: number
  replies: number
}

/** Everything the score page shows. */
export interface ResponseScore {
  /** `quick` counts today's replies inside the first mark. */
  today: { points: number; replies: number; quick: number }
  week: { points: number; replies: number }
  /** One entry per calendar day, oldest first, today last. */
  days: ResponseScoreDay[]
  /** Waits that ended in the last 7 days, by marks passed. The last group also holds messages nobody answered. */
  waits: number[]
}

const epoch = (iso: string) => Instant.from(iso).epochMilliseconds

function grade(waitingSince: string, closedAt: string, timezone: string): { marks: number; points: number } {
  const marks = marksPassed(epoch(waitingSince), epoch(closedAt), timezone)
  return { marks, points: RESPONSE_POINTS[marks] }
}

/** A message on the list was answered: Sky saw the reply, or the owner ticked it. */
export function creditListed(
  entries: readonly EarnedEntry[],
  input: {
    id: string
    waitingSince: string
    closedAt: string
    how: 'replied' | 'checked'
    timezone: string
    dayOf: DayOf
  },
): EarnedEntry[] {
  const existing = entries.find((entry) => entry.id === input.id && entry.waitingSince === input.waitingSince)
  if (!existing) {
    return [
      ...entries,
      {
        id: input.id,
        waitingSince: input.waitingSince,
        closedAt: input.closedAt,
        day: input.dayOf(epoch(input.closedAt)),
        how: input.how,
        ...grade(input.waitingSince, input.closedAt, input.timezone),
        listed: true,
      },
    ]
  }
  // The reply itself is the truer time when the owner ticked the message after sending it.
  const truer =
    existing.how === 'checked' && input.how === 'replied' && epoch(input.closedAt) < epoch(existing.closedAt)
  if (!truer) return [...entries]
  return entries.map((entry) =>
    entry === existing
      ? {
          ...entry,
          closedAt: input.closedAt,
          day: input.dayOf(epoch(input.closedAt)),
          how: 'replied' as const,
          ...grade(input.waitingSince, input.closedAt, input.timezone),
        }
      : entry,
  )
}

/**
 * A reply to a message that never reached the list counts when it came inside 4 hours, and earns by the same marks.
 * One a day per conversation, so a long back-and-forth earns once.
 */
export function creditQuickReply(
  entries: readonly EarnedEntry[],
  input: { id: string; lastInboundAt: string; repliedAt: string; timezone: string; dayOf: DayOf },
): EarnedEntry[] {
  const since = epoch(input.lastInboundAt)
  const at = epoch(input.repliedAt)
  // Saved conversations keep minutes, so a reply can share its message's timestamp.
  if (at < since) return [...entries]
  const day = input.dayOf(at)
  for (const entry of entries) {
    if (entry.id !== input.id) continue
    // The reply to a listed message has earned through that entry already, by a tick or by the reply itself.
    if (entry.listed && epoch(entry.waitingSince) <= since && since <= epoch(entry.closedAt)) return [...entries]
    if (!entry.listed && entry.day === day) return [...entries]
  }
  const marks = marksPassed(since, at, input.timezone)
  if (marks > QUICK_REPLY_MAX_MARKS) return [...entries]
  return [
    ...entries,
    {
      id: input.id,
      waitingSince: input.lastInboundAt,
      closedAt: input.repliedAt,
      day,
      how: 'replied',
      marks,
      points: RESPONSE_POINTS[marks],
      listed: false,
    },
  ]
}

/** A message left the list after a week with no reply. */
export function recordExpired(
  entries: readonly EarnedEntry[],
  input: { id: string; waitingSince: string; expiredAt: string; dayOf: DayOf },
): EarnedEntry[] {
  if (entries.some((entry) => entry.id === input.id && entry.waitingSince === input.waitingSince)) return [...entries]
  return [
    ...entries,
    {
      id: input.id,
      waitingSince: input.waitingSince,
      closedAt: input.expiredAt,
      day: input.dayOf(epoch(input.expiredAt)),
      how: 'expired',
      marks: RESPONSE_POINTS.length - 1,
      points: 0,
      listed: true,
    },
  ]
}

/** Undo of a tick takes its points back. */
export function removeChecked(entries: readonly EarnedEntry[], id: string): EarnedEntry[] {
  const index = entries.findLastIndex((entry) => entry.id === id && entry.how === 'checked')
  return entries.filter((_, i) => i !== index)
}

export function pruneEarned(entries: readonly EarnedEntry[], nowMs: number): EarnedEntry[] {
  const keepFrom = nowMs - EARNED_RETENTION_DAYS * 24 * 3_600_000
  return entries.filter((entry) => epoch(entry.closedAt) >= keepFrom)
}

/** Points earned on `today`, and over the 7 days ending with it. */
export function recentPoints(entries: readonly EarnedEntry[], today: string): { today: number; week: number } {
  const weekFrom = new PlainDate(today).addDays(-6).ymd
  const points = { today: 0, week: 0 }
  for (const entry of entries) {
    if (entry.day < weekFrom || entry.day > today) continue
    points.week += entry.points
    if (entry.day === today) points.today += entry.points
  }
  return points
}

/** The score page's numbers for the days ending with `today`, the notebook's open day. */
export function summarizeEarned(
  entries: readonly EarnedEntry[],
  options: { today: string; days?: number },
): ResponseScore {
  const span = options.days ?? 30
  const today = new PlainDate(options.today)
  const days: ResponseScoreDay[] = []
  for (let back = span - 1; back >= 0; back--) days.push({ date: today.addDays(-back).ymd, points: 0, replies: 0 })
  const byDate = new Map(days.map((day) => [day.date, day]))
  const weekFrom = today.addDays(-6).ymd

  const waits = RESPONSE_POINTS.map(() => 0)
  let quick = 0
  for (const entry of entries) {
    const date = entry.day
    if (date >= weekFrom && date <= today.ymd) waits[entry.how === 'expired' ? waits.length - 1 : entry.marks]++
    if (entry.how === 'expired') continue
    const day = byDate.get(date)
    if (!day) continue
    day.points += entry.points
    day.replies++
    if (date === today.ymd && entry.marks === 0) quick++
  }

  const last = days.at(-1)!
  const week = days.slice(-7)
  return {
    today: { points: last.points, replies: last.replies, quick },
    week: {
      points: week.reduce((sum, day) => sum + day.points, 0),
      replies: week.reduce((sum, day) => sum + day.replies, 0),
    },
    days,
    waits,
  }
}
