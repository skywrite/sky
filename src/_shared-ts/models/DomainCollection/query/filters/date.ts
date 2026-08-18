/**
 * Date-related filter predicates.
 *
 * Documents are dated by an interval, not a point: a day file (or any doc
 * with a frontmatter date) covers a single day, while week-, month-, and
 * year-level time-tree files (a week plan, a week summary) cover every day
 * of their span. All matchers test against that interval, so a week plan is
 * "dated" any day of its week — asking for a Wednesday finds the plan that
 * governs it. Single-day documents behave exactly as point dates did.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parseDuration } from './duration.ts'

/** Inclusive day span a document covers. Single-day docs have start = end. */
export interface DateRange {
  start: PlainDate
  end: PlainDate
}

const singleDay = (date: PlainDate): DateRange => ({ start: date, end: date })

/**
 * Extract date from a time-based path.
 * Uses parseDateFromDayPath from nbfs, so this is day files only — week- and
 * month-level files resolve through getDocumentDateRange instead.
 */
export function getDateFromPath(path: string): PlainDate | undefined {
  try {
    return parseDateFromDayPath(path)
  } catch {
    return undefined
  }
}

/**
 * Get the date span of a document.
 * An explicit `date:` field wins (a single day), then the time-tree path —
 * a day dir dates a single day, a week/month/year level file dates its whole
 * span — then the `created`/`identified` fields (single days).
 */
export function getDocumentDateRange(doc: Document, path?: string): DateRange | undefined {
  const yaml = doc.yaml

  // Try 'date' field first (meetings, messages)
  const dateVal = yaml['date']
  if (dateVal instanceof Date) {
    return singleDay(PlainDate.from(dateVal.toISOString().slice(0, 10)))
  }
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
    return singleDay(PlainDate.from(dateVal.slice(0, 10)))
  }

  // Try path-based extraction (the time tree encodes each doc's span)
  if (path) {
    const info = parseTimePath(path)
    if (info) return { start: info.start, end: info.end }
  }

  // Try 'created' field (generic documents)
  if (doc.created) {
    return singleDay(doc.created)
  }

  // Try 'identified' field (decisions)
  const identified = yaml['identified']
  if (typeof identified === 'string' && /^\d{4}-\d{2}-\d{2}/.test(identified)) {
    return singleDay(PlainDate.from(identified.slice(0, 10)))
  }

  return undefined
}

/**
 * Get the date of a document — the start of its span. Prefer
 * getDocumentDateRange where the whole span matters.
 */
export function getDocumentDate(doc: Document, path?: string): PlainDate | undefined {
  return getDocumentDateRange(doc, path)?.start
}

/** True when the spans [aStart, aEnd] and [bStart, bEnd] share any day. */
function overlaps(range: DateRange, start: PlainDate, end: PlainDate): boolean {
  return PlainDate.compare(range.start, end) <= 0 && PlainDate.compare(range.end, start) >= 0
}

/** True when the span exists and shares a day with the trailing window ending at now. */
function isWithinWindow(range: DateRange | undefined, duration: string, now: PlainDate): boolean {
  if (!range) return false

  const days = parseDuration(duration)
  const cutoff = now.addDays(-days)

  return overlaps(range, cutoff, now)
}

/**
 * Check if document is within the specified recent period.
 *
 * @example matchesRecent(doc, "7d") // within last 7 days
 * @example matchesRecent(doc, "2w") // within last 2 weeks
 */
export function matchesRecent(
  doc: Document,
  duration: string,
  now: PlainDate = PlainDate.today(),
  path?: string,
): boolean {
  return isWithinWindow(getDocumentDateRange(doc, path), duration, now)
}

/**
 * Check if an entity document was recently ACTIVE: its last-modified date
 * (`updated`, stamped by tooling on writes) when present, falling back to
 * the origin-date chain (`created`, `identified`). Entity matchers use this
 * instead of matchesRecent because a years-old idea updated last week is
 * exactly what "recent ideas" means — while event documents stay on
 * matchesRecent, where an edited old meeting must not become a recent one.
 */
export function matchesRecentActivity(doc: Document, duration: string, now: PlainDate = PlainDate.today()): boolean {
  const range = doc.updated ? singleDay(doc.updated) : getDocumentDateRange(doc)
  return isWithinWindow(range, duration, now)
}

/**
 * Strict window against the `created` frontmatter date only — no fallbacks,
 * documents without one never match. The explicit-semantics counterpart to
 * matchesRecentActivity's do-what-I-mean blend.
 */
export function matchesCreatedRecently(doc: Document, duration: string, now: PlainDate = PlainDate.today()): boolean {
  return isWithinWindow(doc.created && singleDay(doc.created), duration, now)
}

/**
 * Strict window against the `updated` frontmatter date only — no fallbacks,
 * documents without one never match.
 */
export function matchesUpdatedRecently(doc: Document, duration: string, now: PlainDate = PlainDate.today()): boolean {
  return isWithinWindow(doc.updated && singleDay(doc.updated), duration, now)
}

/**
 * Check if document has a specific date — for span documents, whether the
 * date falls inside the span.
 */
export function matchesDate(doc: Document, date: PlainDate | string, path?: string): boolean {
  const range = getDocumentDateRange(doc, path)
  if (!range) return false

  const targetDate = typeof date === 'string' ? PlainDate.from(date) : date
  return overlaps(range, targetDate, targetDate)
}

/**
 * Check if any part of the document's span is on or after the given date.
 * One-ended on purpose: `dateGte: X` is a closed window [X, now], the
 * absolute-date spelling of `recent`.
 */
export function matchesDateGte(doc: Document, start: PlainDate | string, path?: string): boolean {
  const range = getDocumentDateRange(doc, path)
  if (!range) return false

  const startDate = typeof start === 'string' ? PlainDate.from(start) : start
  return PlainDate.compare(range.end, startDate) >= 0
}

/**
 * Check if any part of the document's span is on or before the given date.
 * One-ended on purpose: everything from the corpus start up to X.
 */
export function matchesDateLte(doc: Document, end: PlainDate | string, path?: string): boolean {
  const range = getDocumentDateRange(doc, path)
  if (!range) return false

  const endDate = typeof end === 'string' ? PlainDate.from(end) : end
  return PlainDate.compare(range.start, endDate) <= 0
}

/**
 * Check if document's span intersects a date range (inclusive).
 */
export function matchesDateRange(
  doc: Document,
  start: PlainDate | string,
  end: PlainDate | string,
  path?: string,
): boolean {
  const range = getDocumentDateRange(doc, path)
  if (!range) return false

  const startDate = typeof start === 'string' ? PlainDate.from(start) : start
  const endDate = typeof end === 'string' ? PlainDate.from(end) : end

  return overlaps(range, startDate, endDate)
}
