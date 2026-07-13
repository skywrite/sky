/**
 * Date-related filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { parseDuration } from './duration.ts'

/**
 * Extract date from a time-based path.
 * Uses parseDateFromDayPath from nbfs which handles:
 * - Standard paths: time/YYYY/MM/DD-DD/DD/...
 * - Pre-2020 paths: time/_pre-2020/YYYY/MM/DD-DD/DD/...
 * - Month spillover: time/YYYY/MM/DD-DD/xDD/... (x prefix = next month)
 */
export function getDateFromPath(path: string): PlainDate | undefined {
  try {
    return parseDateFromDayPath(path)
  } catch {
    return undefined
  }
}

/**
 * Get the date from a document.
 * Checks common date fields: date, created, identified.
 * Optionally falls back to extracting date from path.
 */
export function getDocumentDate(doc: Document, path?: string): PlainDate | undefined {
  const yaml = doc.yaml

  // Try 'date' field first (meetings, messages)
  const dateVal = yaml['date']
  if (dateVal instanceof Date) {
    return PlainDate.from(dateVal.toISOString().slice(0, 10))
  }
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
    return PlainDate.from(dateVal.slice(0, 10))
  }

  // Try path-based date extraction (event date encoded in directory structure)
  if (path) {
    const pathDate = getDateFromPath(path)
    if (pathDate) return pathDate
  }

  // Try 'created' field (generic documents)
  if (doc.created) {
    return doc.created
  }

  // Try 'identified' field (decisions)
  const identified = yaml['identified']
  if (typeof identified === 'string' && /^\d{4}-\d{2}-\d{2}/.test(identified)) {
    return PlainDate.from(identified.slice(0, 10))
  }

  return undefined
}

/** True when the date exists and falls inside the trailing window ending at now. */
function isWithinWindow(date: PlainDate | undefined, duration: string, now: PlainDate): boolean {
  if (!date) return false

  const days = parseDuration(duration)
  const cutoff = now.addDays(-days)

  return PlainDate.compare(date, cutoff) >= 0 && PlainDate.compare(date, now) <= 0
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
  return isWithinWindow(getDocumentDate(doc, path), duration, now)
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
  return isWithinWindow(doc.updated ?? getDocumentDate(doc), duration, now)
}

/**
 * Strict window against the `created` frontmatter date only — no fallbacks,
 * documents without one never match. The explicit-semantics counterpart to
 * matchesRecentActivity's do-what-I-mean blend.
 */
export function matchesCreatedRecently(doc: Document, duration: string, now: PlainDate = PlainDate.today()): boolean {
  return isWithinWindow(doc.created, duration, now)
}

/**
 * Strict window against the `updated` frontmatter date only — no fallbacks,
 * documents without one never match.
 */
export function matchesUpdatedRecently(doc: Document, duration: string, now: PlainDate = PlainDate.today()): boolean {
  return isWithinWindow(doc.updated, duration, now)
}

/**
 * Check if document has a specific date.
 */
export function matchesDate(doc: Document, date: PlainDate | string, path?: string): boolean {
  const docDate = getDocumentDate(doc, path)
  if (!docDate) return false

  const targetDate = typeof date === 'string' ? PlainDate.from(date) : date
  return docDate.equals(targetDate)
}

/**
 * Check if document date is within a range (inclusive).
 */
export function matchesDateRange(
  doc: Document,
  start: PlainDate | string,
  end: PlainDate | string,
  path?: string,
): boolean {
  const docDate = getDocumentDate(doc, path)
  if (!docDate) return false

  const startDate = typeof start === 'string' ? PlainDate.from(start) : start
  const endDate = typeof end === 'string' ? PlainDate.from(end) : end

  return PlainDate.compare(docDate, startDate) >= 0 && PlainDate.compare(docDate, endDate) <= 0
}
