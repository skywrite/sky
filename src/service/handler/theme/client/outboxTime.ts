import type { OutboxRecord } from '#lib/outbox/types.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * When an item asked for the person, and how long that has waited.
 * Everything here is string and calendar arithmetic on the notebook's
 * 'YYYY-MM-DD HH:MM' stamps. The clock is never read.
 */

const STAMP = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD HH:MM' with a padded hour. A 'T' separator reads the same. Empty when there is no date. */
export function normalizeStamp(stamp: string | null | undefined): string {
  const match = STAMP.exec(stamp ?? '')
  if (!match) return ''
  return `${match[1]} ${match[2]!.padStart(2, '0')}:${match[3]}`
}

/** Days since 1970-01-01 by calendar arithmetic. NaN when the stamp has no valid date. */
export function dayNumber(stamp: string): number {
  let date: PlainDate
  try {
    date = new PlainDate(stamp.slice(0, 10))
  } catch {
    return NaN
  }
  const year = date.month <= 2 ? date.year - 1 : date.year
  const era = Math.floor(year / 400)
  const yearOfEra = year - era * 400
  const dayOfYear = Math.floor((153 * (date.month + (date.month > 2 ? -3 : 9)) + 2) / 5) + date.day - 1
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear
  return era * 146097 + dayOfEra - 719468
}

/** 'Fri' for a date. Empty when the stamp has no valid date. */
export function weekdayLabel(stamp: string): string {
  const days = dayNumber(stamp)
  if (!Number.isFinite(days)) return ''
  // 1970-01-01 was a Thursday.
  return WEEKDAYS[(((days + 4) % 7) + 7) % 7]!
}

/** 'Fri 12 Sep' for a date. The stamp itself when it has no valid date. */
export function dateLabel(stamp: string): string {
  const weekday = weekdayLabel(stamp)
  if (!weekday) return stamp
  const date = new PlainDate(stamp.slice(0, 10))
  return `${weekday} ${date.day} ${MONTHS[date.month - 1]}`
}

/** 'Fri 12 Sep, 17:05' for a stamp. The date alone when it carries no time. */
export function askedLabel(stamp: string): string {
  const normalized = normalizeStamp(stamp)
  if (!normalized) return dateLabel(stamp)
  return `${dateLabel(normalized)}, ${normalized.slice(11)}`
}

/** How long an ask has waited as of `today`: 'today', 'yesterday', 'N days', 'N weeks'. */
export function waitingLabel(askedAt: string, today: string): string {
  const days = dayNumber(today) - dayNumber(askedAt)
  if (!Number.isFinite(days) || days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days`
  return `${Math.floor(days / 7)} weeks`
}

const OPEN = new Set(['open', 'uncertain'])

/**
 * When the conversation last asked for the person.
 * The newest open request of this review, by its origin.
 * Else the last saved message's latest time.
 * Else the moment the item was created.
 */
export function askedAt(record: OutboxRecord): string {
  const selected = record.requestIds ?? []
  const origins = (record.requests ?? [])
    .filter((request) => request.present && OPEN.has(request.status))
    .filter((request) => selected.length === 0 || selected.includes(request.id))
    .map((request) => normalizeStamp(request.origin.at))
    .filter(Boolean)
    .sort()
  if (origins.length) return origins.at(-1)!
  const times = [...(record.conversation.sources.at(-1)?.times ?? [])].map(normalizeStamp).filter(Boolean).sort()
  return times.at(-1) ?? normalizeStamp(record.created) ?? record.created
}

/** When the reply was last written: the newest of creation, the last review, and the last direction. */
export function writtenAt(record: OutboxRecord): string {
  return [record.created, record.reviews.at(-1)?.at, record.replyDirections?.at(-1)?.at]
    .map(normalizeStamp)
    .filter(Boolean)
    .sort()
    .at(-1)!
}

/** The moment a finished item ended: the sent report, else the captured reply, else its last change. */
export function doneAt(record: OutboxRecord): string {
  return (
    normalizeStamp(record.delivery?.at) ||
    normalizeStamp(record.responseHistory?.at(-1)?.at) ||
    normalizeStamp(record.updated) ||
    record.updated
  )
}
