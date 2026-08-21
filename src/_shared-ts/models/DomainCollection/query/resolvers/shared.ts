/**
 * Shared building blocks for the per-entity resolver modules.
 *
 * Each file in this directory owns one entity end to end — its filter type, its
 * matcher, its document mapper and its resolver spec. What all of them have in
 * common lives here: the filter mixins the schema repeats on nearly every input
 * type, the YAML field readers, the Day index, and the generic list resolver
 * that every root field is built from.
 */

import type { CollectionEntityType } from '#shared/models/Markdown/Collection/entityTypes.ts'
import type { Document } from '#shared/models/Markdown/mod.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import { When } from '#universal/dates/nbdt/mod.ts'
import type DomainCollection from '../../mod.ts'
import {
  matchesBodyContains,
  matchesCreatedRecently,
  matchesDate,
  matchesDateGte,
  matchesDateLte,
  matchesInvolves,
  matchesInvolvesAll,
  matchesInvolvesAny,
  matchesRecent,
  matchesRecentActivity,
  matchesRelContains,
  matchesTagContains,
  matchesTagContainsAll,
  matchesTagContainsAny,
  matchesTagPrefix,
  matchesUpdatedRecently,
  type NameResolver,
} from '../filters/mod.ts'

export type { NameResolver }

// =============================================================================
// Filter mixins
//
// These are the field groups that repeat across the schema's input types. Each
// pairs with a matcher below, so a new entity spells out only what is genuinely
// its own.
// =============================================================================

/** Tag predicates. Every entity filter carries these four. */
export interface TagFilter {
  tagsContains?: string
  tagsContainsAny?: string[]
  tagsContainsAll?: string[]
  tagsStartsWith?: string
}

/** Free-text and relationship predicates. */
export interface TextFilter {
  bodyContains?: string
  relContains?: string
}

/** Person-mention predicates, matched through name aliases. */
export interface InvolvesFilter {
  involves?: string
  involvesAny?: string[]
  involvesAll?: string[]
}

/**
 * Date predicates for day-partitioned entities, where `recent` asks "is it
 * dated inside the window" and the date comes from YAML or the day path.
 */
export interface DatedFilter {
  date?: string
  dateGte?: string
  dateLte?: string
  recent?: string
}

/**
 * Activity predicates for evergreen entities — people, orgs, projects and the
 * like. Here `recent` asks "was it touched inside the window", a different
 * question from DatedFilter's, which is why no filter carries both.
 */
export interface ActivityFilter {
  recent?: string
  createdRecently?: string
  updatedRecently?: string
}

export function matchesTagFilter(doc: Document, filter: TagFilter): boolean {
  if (filter.tagsContains && !matchesTagContains(doc, filter.tagsContains)) return false
  if (filter.tagsContainsAny && !matchesTagContainsAny(doc, filter.tagsContainsAny)) return false
  if (filter.tagsContainsAll && !matchesTagContainsAll(doc, filter.tagsContainsAll)) return false
  if (filter.tagsStartsWith && !matchesTagPrefix(doc, filter.tagsStartsWith)) return false
  return true
}

export function matchesTextFilter(doc: Document, filter: TextFilter): boolean {
  if (filter.bodyContains && !matchesBodyContains(doc, filter.bodyContains)) return false
  if (filter.relContains && !matchesRelContains(doc, filter.relContains)) return false
  return true
}

export function matchesInvolvesFilter(doc: Document, filter: InvolvesFilter, resolveNames?: NameResolver): boolean {
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  if (filter.involvesAny && !matchesInvolvesAny(doc, filter.involvesAny, resolveNames)) return false
  if (filter.involvesAll && !matchesInvolvesAll(doc, filter.involvesAll, resolveNames)) return false
  return true
}

export function matchesDatedFilter(doc: Document, filter: DatedFilter, path?: string): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  // Each bound applies on its own — a lone dateGte/dateLte used to validate
  // against the schema yet filter nothing, and query models write lone bounds.
  if (filter.dateGte && !matchesDateGte(doc, filter.dateGte, path)) return false
  if (filter.dateLte && !matchesDateLte(doc, filter.dateLte, path)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  return true
}

export function matchesActivityFilter(doc: Document, filter: ActivityFilter): boolean {
  if (filter.recent && !matchesRecentActivity(doc, filter.recent)) return false
  if (filter.createdRecently && !matchesCreatedRecently(doc, filter.createdRecently)) return false
  if (filter.updatedRecently && !matchesUpdatedRecently(doc, filter.updatedRecently)) return false
  return true
}

// =============================================================================
// YAML field readers
// =============================================================================

export function getField(doc: Document, field: string): unknown {
  return doc.yaml[field]
}

export function getStringField(doc: Document, field: string, defaultValue = ''): string {
  const val = doc.yaml[field]
  return typeof val === 'string' ? val : defaultValue
}

export type MappedWhen = {
  datetime: string
  duration: string | null
  durationMinutes: number | null
  end: string | null
}

/**
 * Map the `when:` object onto its GraphQL shape.
 *
 * Returns null rather than throwing when the field is missing or unreadable —
 * a handful of documents record no time at all, and one of them must not be
 * able to take down a query spanning the whole notebook.
 */
export function getWhenField(doc: Document): MappedWhen | null {
  const raw = doc.yaml['when']
  if (raw === undefined || raw === null) return null
  try {
    const when = When.fromYaml(raw)
    return {
      datetime: when.datetime.toString(),
      duration: when.duration,
      durationMinutes: when.durationMinutes,
      end: when.end?.toString() ?? null,
    }
  } catch {
    return null
  }
}

export function getOptionalStringField(doc: Document, field: string): string | null {
  const val = doc.yaml[field]
  return typeof val === 'string' ? val : null
}

/** The `tags`/`rel`/`markdown`/`path` tail that closes almost every entity row. */
export function docBase(doc: Document, path: string) {
  return {
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

// =============================================================================
// Dates and the Day index
// =============================================================================

/** Mapped Day type for GraphQL */
export interface MappedDay {
  date: string
  year: number
  month: number
  started: string | null
  ended: string | null
  location: string | null
  tz: string | null
  tags: string[]
  markdown: string
  path: string
}

/**
 * Creates a lookup function to find Day documents by date string.
 * Pre-indexes all days for O(1) lookup.
 */
export function createDayLookup(domain: DomainCollection): (dateStr: string) => MappedDay | null {
  // Build index of days by date string
  const daysByDate = new Map<string, MappedDay>()

  for (const { doc, path } of domain.entriesByType('day')) {
    // Try YAML date field first, fall back to path extraction
    let dateStr: string | null = null
    const dateVal = doc.yaml['date']
    if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
      dateStr = dateVal.slice(0, 10)
    } else {
      try {
        dateStr = parseDateFromDayPath(path).toString()
      } catch {
        // Skip days we can't parse
        continue
      }
    }

    if (dateStr) {
      const [yearStr, monthStr] = dateStr.split('-')
      daysByDate.set(dateStr, {
        date: dateStr,
        year: parseInt(yearStr, 10) || 0,
        month: parseInt(monthStr, 10) || 0,
        started: typeof doc.yaml['started'] === 'string' ? doc.yaml['started'] : null,
        ended: typeof doc.yaml['ended'] === 'string' ? doc.yaml['ended'] : null,
        location: typeof doc.yaml['location'] === 'string' ? doc.yaml['location'] : null,
        tz: typeof doc.yaml['tz'] === 'string' ? doc.yaml['tz'] : null,
        tags: Array.from(doc.tags),
        markdown: doc.markdown,
        path,
      })
    }
  }

  return (dateStr: string) => daysByDate.get(dateStr) ?? null
}

/**
 * Get the date string for a time-based document.
 * Tries the 'date' YAML field first, falls back to path extraction.
 */
export function getDateForDocument(doc: Document, path: string): string | null {
  const dateVal = doc.yaml['date']
  if (typeof dateVal === 'string' && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
    return dateVal.slice(0, 10)
  }
  try {
    const pathDate = parseDateFromDayPath(path)
    return pathDate.toString()
  } catch {
    return null
  }
}

/** Sort entries by date descending (most recent first) using path-derived date. */
export function sortByDateDesc(
  entries: Array<{ doc: Document; path: string }>,
): Array<{ doc: Document; path: string }> {
  return entries.sort((a, b) => {
    const dateA = getDateForDocument(a.doc, a.path) ?? ''
    const dateB = getDateForDocument(b.doc, b.path) ?? ''
    return dateB.localeCompare(dateA)
  })
}

// =============================================================================
// Entity specs
// =============================================================================

/** State shared by every entity module, built once per resolver set. */
export interface ResolverContext {
  readonly domain: DomainCollection
  readonly resolveNames: NameResolver
  /** The Day row for a dated document, for the nested `day` field. */
  dayFor(doc: Document, path: string): MappedDay | null
}

/** A filtered, sorted, limited slice of the collection, ready to map. */
export type Entries = Array<{ doc: Document; path: string }>

/**
 * One entity's contribution to the root resolvers.
 *
 * `mapper` runs once per resolver set and returns the function that maps a
 * whole result batch, so an entity needing an index or a lazy walk builds it in
 * that closure instead of pushing its own state into ResolverContext. Most
 * entities map row by row and wrap a plain mapper in `perRow`; batching exists
 * for the two that share a value across a batch — streaks read today's date,
 * days read the current streak set — which must be read per query, not per set.
 */
export interface EntitySpec<F, R> {
  type: CollectionEntityType | '*'
  /** Sort newest-first before limiting, so `limit` keeps the most recent. Set on day-partitioned entities and `documents`. */
  sortByDate?: boolean
  /**
   * Membership test, applied whether or not a `where` was given — unlike
   * `matches`, which only runs to satisfy a filter. Entities selected by
   * location leave this unset, since `type` already narrows them. Set it when
   * membership is a property of the document rather than of its path, so a
   * bare root-field query stays restricted to the class.
   */
  selects?: (doc: Document, path: string) => boolean
  matches(doc: Document, filter: F, path: string, ctx: ResolverContext): boolean
  mapper(ctx: ResolverContext): (entries: Entries) => R[]
}

/** Lift a row-at-a-time mapper into the batch shape EntitySpec.mapper expects. */
export function perRow<R>(map: (doc: Document, path: string) => R): (entries: Entries) => R[] {
  return (entries) => entries.map(({ doc, path }) => map(doc, path))
}

/**
 * Cap applied when a query specifies no `limit` — a runaway guard so a bare
 * root-field query cannot return the whole notebook. Generous enough that
 * deliberate broad sweeps still work; sorted types keep the newest N.
 *
 * Date-bounded queries are exempt: a named range is its own limit, and the
 * asker means the whole window. Capping one silently truncates it to the
 * newest N — a two-year window of journals came back as one month. The
 * contract this exemption leans on: every consumer that embeds query
 * results in a model prompt must budget them (ContextAssembler). An
 * unbudgeted embed once built a multi-million-token prompt the API
 * rejected outright.
 */
export const DEFAULT_QUERY_LIMIT = 500

/** A filter with date bounds only caps at an explicit `limit`, never by default. */
function hasDateBounds(where: unknown): boolean {
  if (typeof where !== 'object' || where === null) return false
  const w = where as DatedFilter
  // Mirrors matchesDatedFilter: `date` alone bounds; `recent` and `dateGte`
  // both bound despite their one-sided spelling — each is a window closing at
  // now, so the asker means the whole window. A lone dateLte is the genuinely
  // open end (everything back to the corpus start) and stays capped. Both
  // filter families spell their window `recent`, so the cast covers both.
  return Boolean(w.date || w.recent || w.dateGte)
}

/**
 * One root field whose result hit its cap. Recorded so truncation is never
 * silent: a capped result is indistinguishable from a complete one, and a
 * two-year window of journals once shipped as its newest month without a
 * word. The resolver is the only place the pre-slice count exists, so the
 * report carries exact numbers, not a heuristic.
 */
export interface QueryTruncation {
  /** Root field (or alias) as queried, e.g. `journals` */
  field: string
  /** How many documents matched before the cap */
  matched: number
  /** How many were returned */
  returned: number
  /** The cap that cut them */
  limit: number
  /** True when the cap was DEFAULT_QUERY_LIMIT rather than a written `limit` */
  defaulted: boolean
}

/** GraphQL contextValue shape the resolvers report truncations into. */
interface TruncationSink {
  truncations?: QueryTruncation[]
}

/**
 * Build the root resolver for one entity: filter, sort, limit, map — the body
 * each of the fifteen root fields used to spell out by hand.
 *
 * Uses the buildSchema + rootValue signature, where a field function receives
 * (args, context, info) directly, NOT (parent, args, context, info).
 */
export function listResolver<F, R>(spec: EntitySpec<F, R>, ctx: ResolverContext) {
  const map = spec.mapper(ctx)

  return (args: { where?: F; limit?: number }, gqlCtx?: unknown, info?: unknown): R[] => {
    let results = ctx.domain.entriesByType(spec.type)
    const selects = spec.selects
    if (selects) results = results.filter(({ doc, path }) => selects(doc, path))
    if (args.where) {
      const where = args.where
      results = results.filter(({ doc, path }) => spec.matches(doc, where, path, ctx))
    }
    if (spec.sortByDate) results = sortByDateDesc(results)
    const cap = args.limit ?? (hasDateBounds(args.where) ? Infinity : DEFAULT_QUERY_LIMIT)
    if (results.length > cap) {
      const sink = gqlCtx as TruncationSink | undefined
      if (sink?.truncations) {
        const i = info as { path?: { key?: string | number }; fieldName?: string } | undefined
        sink.truncations.push({
          field: String(i?.path?.key ?? i?.fieldName ?? spec.type),
          matched: results.length,
          returned: cap,
          limit: cap,
          defaulted: args.limit == null,
        })
      }
      results = results.slice(0, cap)
    }
    return map(results)
  }
}
