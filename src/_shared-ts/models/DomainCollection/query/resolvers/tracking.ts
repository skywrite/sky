import type { Document } from '#shared/models/Markdown/mod.ts'
import TrackingDocument from '#shared/models/Tracking/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type EntitySpec,
  type TagFilter,
  type TextFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface TrackingFilter extends TagFilter, TextFilter {
  name?: string
  nameContains?: string
  titleContains?: string
  status?: string
  category?: string
  ask?: string
}

/** Status is path-derived for tracking definitions, like streaks and ideas. */
export function trackingStatusFromPath(path: string): string {
  return path.includes('/archived/') ? 'archived' : 'active'
}

/**
 * Constructed rather than cast, like streaks: outside fromStore (mock stores,
 * fromDocuments-built collections) a path-detected tracking is a plain
 * Document, and the typed accessors (columns, ask) need real behavior.
 */
export function toTrackingDocument(doc: Document): TrackingDocument {
  return doc instanceof TrackingDocument ? doc : new TrackingDocument(doc.yaml, doc.markdown, doc.yamlError)
}

export function matchesTrackingFilter(doc: Document, filter: TrackingFilter, path: string): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.titleContains && !matchesContains(doc, 'title', filter.titleContains)) return false
  if (filter.status && trackingStatusFromPath(path) !== filter.status) return false
  if (filter.category && !matchesExact(doc, 'category', filter.category)) return false
  if (filter.ask && !matchesExact(doc, 'ask', filter.ask)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  return true
}

export function docToTracking(tracking: TrackingDocument, path: string) {
  return {
    name: tracking.name,
    title: tracking.title,
    status: trackingStatusFromPath(path),
    question: tracking.question ?? null,
    ask: tracking.ask,
    schedule: tracking.schedule,
    storage: tracking.storage,
    category: tracking.category || null,
    columns: tracking.columns.map((c) => ({
      name: c.name,
      type: c.type,
      unit: c.unit ?? null,
      aggregate: c.aggregate ?? null,
    })),
    start: tracking.start?.ymd ?? null,
    end: tracking.end?.ymd ?? null,
    tags: Array.from(tracking.tags),
    rel: Array.from(tracking.rel),
    markdown: tracking.markdown,
    path,
  }
}

export default {
  type: 'tracking',
  matches: (doc, filter, path) => matchesTrackingFilter(doc, filter, path),
  mapper: () => perRow((doc, path) => docToTracking(toTrackingDocument(doc), path)),
} satisfies EntitySpec<TrackingFilter, ReturnType<typeof docToTracking>>
