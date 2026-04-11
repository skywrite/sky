/**
 * GraphQL resolvers for DomainCollection queries.
 *
 * These resolvers implement the schema.graphql types and can be used by:
 * - CLI tasks (markdown:sel) via direct execution
 * - Service (server) via graphql-yoga
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import DomainCollection from '../mod.ts'
import { detectTypeFromPath } from '#shared/models/Markdown/Collection/entityTypes.ts'
import parseDateFromDayPath from '#shared/nbfs/parseDateFromDayPath.ts'
import {
  matchesBodyContains,
  matchesContains,
  matchesDate,
  matchesDateRange,
  matchesDecided,
  matchesExact,
  matchesInvolves,
  matchesPending,
  matchesRecent,
  matchesRelContains,
  matchesTagContains,
  matchesTagContainsAll,
  matchesTagContainsAny,
  matchesTagPrefix,
  type NameResolver,
} from './filters/mod.ts'

// =============================================================================
// Filter Types (match schema.graphql inputs)
// =============================================================================

export interface MeetingFilter {
  date?: string
  date_gte?: string
  date_lte?: string
  recent?: string
  year?: number
  month?: number
  who_contains?: string
  who_not_contains?: string
  medium?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  tags_not_contains?: string
  body_contains?: string
  involves?: string
  rel_contains?: string
}

export interface MessageFilter {
  date?: string
  date_gte?: string
  date_lte?: string
  recent?: string
  from?: string
  from_not?: string
  to_contains?: string
  to_not_contains?: string
  medium?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  body_contains?: string
  involves?: string
  rel_contains?: string
}

export interface PersonFilter {
  name?: string
  name_contains?: string
  org?: string
  org_contains?: string
  title_contains?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
}

export interface OrgFilter {
  name?: string
  name_contains?: string
  sector?: string
  kind?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
}

export interface ProjectFilter {
  name?: string
  name_contains?: string
  status?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  involves?: string
}

export interface DecisionFilter {
  name_contains?: string
  pending?: boolean
  decided?: boolean
  identified_gte?: string
  identified_lte?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  involves?: string
}

export interface GoalFilter {
  name_contains?: string
  status?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  involves?: string
}

export interface IdeaFilter {
  name_contains?: string
  status?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  involves?: string
}

export interface PlaceFilter {
  name_contains?: string
  type?: string
  country?: string
  city_contains?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
}

export interface DayFilter {
  date?: string
  date_gte?: string
  date_lte?: string
  recent?: string
  year?: number
  month?: number
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
}

export interface JournalFilter {
  date?: string
  date_gte?: string
  date_lte?: string
  recent?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  body_contains?: string
  involves?: string
  rel_contains?: string
}

export interface VideoFilter {
  date?: string
  date_gte?: string
  date_lte?: string
  recent?: string
  from_contains?: string
  medium?: string
  summary_contains?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  body_contains?: string
  involves?: string
  rel_contains?: string
}

export interface DocumentFilter {
  date?: string
  date_gte?: string
  date_lte?: string
  type?: string
  involves?: string
  tags_contains?: string
  tags_contains_any?: string[]
  tags_contains_all?: string[]
  tags_starts_with?: string
  body_contains?: string
  recent?: string
  rel_contains?: string
}

// =============================================================================
// Day lookup helper
// =============================================================================

/** Mapped Day type for GraphQL */
interface MappedDay {
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
function createDayLookup(domain: DomainCollection): (dateStr: string) => MappedDay | null {
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
function getDateForDocument(doc: Document, path: string): string | null {
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

// =============================================================================
// Document to GraphQL mappers
// =============================================================================

function getField(doc: Document, field: string): unknown {
  return doc.yaml[field]
}

function getStringField(doc: Document, field: string, defaultValue = ''): string {
  const val = doc.yaml[field]
  return typeof val === 'string' ? val : defaultValue
}

function getOptionalStringField(doc: Document, field: string): string | null {
  const val = doc.yaml[field]
  return typeof val === 'string' ? val : null
}

function docToMeeting(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    who: getStringField(doc, 'who'),
    when: getStringField(doc, 'when'),
    medium: getStringField(doc, 'medium'),
    context: getOptionalStringField(doc, 'context'),
    summary: getOptionalStringField(doc, 'summary'),
    where: getOptionalStringField(doc, 'where'),
    date: getDateForDocument(doc, path) ?? '',
    day,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToMessage(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    from: getOptionalStringField(doc, 'from'),
    to: getOptionalStringField(doc, 'to'),
    when: getStringField(doc, 'when'),
    medium: getStringField(doc, 'medium'),
    summary: getOptionalStringField(doc, 'summary'),
    date: getDateForDocument(doc, path) ?? '',
    day,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToVideo(doc: Document, path: string, day: MappedDay | null = null) {
  const video = doc.yaml['video']
  const url =
    video && typeof video === 'object' && !Array.isArray(video) ? (video as Record<string, unknown>)['url'] : undefined

  return {
    from: getOptionalStringField(doc, 'from'),
    to: getOptionalStringField(doc, 'to'),
    when: getStringField(doc, 'when'),
    medium: getStringField(doc, 'medium', 'Video'),
    summary: getOptionalStringField(doc, 'summary'),
    url: typeof url === 'string' ? url : null,
    date: getDateForDocument(doc, path) ?? '',
    day,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToPerson(doc: Document, path: string) {
  const names = getField(doc, 'names')
  const met = getField(doc, 'met')

  // Parse orgs structure: { current: string[], past: string[] }
  const orgsRaw = getField(doc, 'orgs')
  const parseOrgArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    }
    if (typeof value === 'string' && value.trim() !== '') {
      return [value]
    }
    return []
  }
  const orgs =
    orgsRaw && typeof orgsRaw === 'object' && !Array.isArray(orgsRaw)
      ? {
          current: parseOrgArray((orgsRaw as Record<string, unknown>)['current']),
          past: parseOrgArray((orgsRaw as Record<string, unknown>)['past']),
        }
      : { current: [], past: [] }

  return {
    name: getStringField(doc, 'name'),
    names: Array.isArray(names) ? names : [],
    org: getOptionalStringField(doc, 'org'),
    orgs,
    title: getOptionalStringField(doc, 'title'),
    location: getOptionalStringField(doc, 'location'),
    met: met != null ? String(met) : null,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToOrg(doc: Document, path: string) {
  // Derive kind from tags (Organization/Company, etc.)
  let kind = 'unknown'
  for (const tag of doc.tags) {
    if (tag.startsWith('Organization/')) {
      kind = tag.slice('Organization/'.length).toLowerCase()
      break
    }
  }

  return {
    name: getStringField(doc, 'name'),
    slug: getOptionalStringField(doc, 'slug'),
    site: getOptionalStringField(doc, 'site'),
    sector: getOptionalStringField(doc, 'sector'),
    subcategory: getOptionalStringField(doc, 'subcategory'),
    description: getOptionalStringField(doc, 'description'),
    kind,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToProject(doc: Document, path: string) {
  return {
    name: getStringField(doc, 'name'),
    status: getStringField(doc, 'status', 'open'),
    closedReason: getOptionalStringField(doc, 'closed-reason'),
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToDecision(doc: Document, path: string) {
  const resolved = getField(doc, 'resolved')
  const identified = getField(doc, 'identified')
  const target = getField(doc, 'target')
  return {
    name: getStringField(doc, 'name'),
    summary: getOptionalStringField(doc, 'summary'),
    identified: identified != null ? String(identified) : null,
    target: target != null ? String(target) : null,
    resolved: resolved != null ? String(resolved) : null,
    isPending: !resolved,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToGoal(doc: Document, path: string) {
  return {
    name: getStringField(doc, 'name'),
    status: getOptionalStringField(doc, 'status'),
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToIdea(doc: Document, path: string) {
  // Derive status from path
  let status = 'draft'
  if (path.includes('/exploring/')) status = 'exploring'
  else if (path.includes('/actioned/')) status = 'actioned'
  else if (path.includes('/archived/')) status = 'archived'

  return {
    name: getStringField(doc, 'name'),
    status,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToPlace(doc: Document, path: string) {
  // country and city are nested inside the location YAML object
  const location = getField(doc, 'location')
  const loc =
    location && typeof location === 'object' && !Array.isArray(location) ? (location as Record<string, unknown>) : null

  return {
    name: getStringField(doc, 'name'),
    type: getStringField(doc, 'type'),
    address: getOptionalStringField(doc, 'address'),
    site: getOptionalStringField(doc, 'site'),
    googleMapsUrl: getOptionalStringField(doc, 'googleMapsUrl'),
    country: loc && typeof loc['country'] === 'string' ? loc['country'] : null,
    city: loc && typeof loc['city'] === 'string' ? loc['city'] : null,
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToDay(doc: Document, path: string) {
  // Get date from YAML or extract from path
  const dateStr = getDateForDocument(doc, path) ?? ''
  const [yearStr, monthStr] = dateStr.split('-')
  return {
    date: dateStr,
    year: parseInt(yearStr, 10) || 0,
    month: parseInt(monthStr, 10) || 0,
    started: getOptionalStringField(doc, 'started'),
    ended: getOptionalStringField(doc, 'ended'),
    location: getOptionalStringField(doc, 'location'),
    tz: getOptionalStringField(doc, 'tz'),
    tags: Array.from(doc.tags),
    markdown: doc.markdown,
    path,
  }
}

function docToJournal(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    date: getDateForDocument(doc, path) ?? '',
    day,
    time: getOptionalStringField(doc, 'time'),
    tags: Array.from(doc.tags),
    rel: Array.from(doc.rel),
    markdown: doc.markdown,
    path,
  }
}

function docToDocument(doc: Document, path: string) {
  return {
    type: detectTypeFromPath(path),
    markdown: doc.markdown,
    path,
  }
}

// =============================================================================
// Filter matching helpers
// =============================================================================

function matchesMeetingFilter(
  doc: Document,
  filter: MeetingFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  if (filter.date_gte && filter.date_lte && !matchesDateRange(doc, filter.date_gte, filter.date_lte, path)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  if (filter.year !== undefined && !matchesExact(doc, 'year', filter.year)) return false
  if (filter.month !== undefined && !matchesExact(doc, 'month', filter.month)) return false
  if (filter.who_contains && !matchesContains(doc, 'who', filter.who_contains)) return false
  if (filter.who_not_contains && matchesContains(doc, 'who', filter.who_not_contains)) return false
  if (filter.medium && !matchesExact(doc, 'medium', filter.medium)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.tags_not_contains && matchesTagContains(doc, filter.tags_not_contains)) return false
  if (filter.body_contains && !matchesBodyContains(doc, filter.body_contains)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  if (filter.rel_contains && !matchesRelContains(doc, filter.rel_contains)) return false
  return true
}

function matchesMessageFilter(
  doc: Document,
  filter: MessageFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  if (filter.date_gte && filter.date_lte && !matchesDateRange(doc, filter.date_gte, filter.date_lte, path)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  if (filter.from && !matchesExact(doc, 'from', filter.from)) return false
  if (filter.from_not && matchesExact(doc, 'from', filter.from_not)) return false
  if (filter.to_contains && !matchesContains(doc, 'to', filter.to_contains)) return false
  if (filter.to_not_contains && matchesContains(doc, 'to', filter.to_not_contains)) return false
  if (filter.medium && !matchesExact(doc, 'medium', filter.medium)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.body_contains && !matchesBodyContains(doc, filter.body_contains)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  if (filter.rel_contains && !matchesRelContains(doc, filter.rel_contains)) return false
  return true
}

function matchesVideoFilter(doc: Document, filter: VideoFilter, path?: string, resolveNames?: NameResolver): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  if (filter.date_gte && filter.date_lte && !matchesDateRange(doc, filter.date_gte, filter.date_lte, path)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  if (filter.from_contains && !matchesContains(doc, 'from', filter.from_contains)) return false
  if (filter.medium && !matchesExact(doc, 'medium', filter.medium)) return false
  if (filter.summary_contains && !matchesContains(doc, 'summary', filter.summary_contains)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.body_contains && !matchesBodyContains(doc, filter.body_contains)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  if (filter.rel_contains && !matchesRelContains(doc, filter.rel_contains)) return false
  return true
}

function matchesPersonFilter(doc: Document, filter: PersonFilter): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.org && !matchesExact(doc, 'org', filter.org)) return false
  if (filter.org_contains && !matchesContains(doc, 'org', filter.org_contains)) return false
  if (filter.title_contains && !matchesContains(doc, 'title', filter.title_contains)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  return true
}

function matchesOrgFilter(doc: Document, filter: OrgFilter): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.sector && !matchesExact(doc, 'sector', filter.sector)) return false
  // kind is derived from tags, check tag
  if (filter.kind) {
    const kindTag = `Organization/${filter.kind.charAt(0).toUpperCase()}${filter.kind.slice(1)}`
    if (!matchesTagContains(doc, kindTag)) return false
  }
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  return true
}

function matchesProjectFilter(doc: Document, filter: ProjectFilter, resolveNames?: NameResolver): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.status && !matchesExact(doc, 'status', filter.status)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  return true
}

function matchesDecisionFilter(doc: Document, filter: DecisionFilter, resolveNames?: NameResolver): boolean {
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.pending === true && !matchesPending(doc)) return false
  if (filter.decided === true && !matchesDecided(doc)) return false
  if (filter.identified_gte && filter.identified_lte) {
    if (!matchesDateRange(doc, filter.identified_gte, filter.identified_lte)) return false
  }
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  return true
}

function matchesGoalFilter(doc: Document, filter: GoalFilter, resolveNames?: NameResolver): boolean {
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.status && !matchesExact(doc, 'status', filter.status)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  return true
}

function matchesIdeaFilter(doc: Document, filter: IdeaFilter, path: string, resolveNames?: NameResolver): boolean {
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.status) {
    // Status is derived from path, not YAML
    let status = 'draft'
    if (path.includes('/exploring/')) status = 'exploring'
    else if (path.includes('/actioned/')) status = 'actioned'
    else if (path.includes('/archived/')) status = 'archived'
    if (status !== filter.status) return false
  }
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  return true
}

function matchesPlaceFilter(doc: Document, filter: PlaceFilter): boolean {
  if (filter.name_contains && !matchesContains(doc, 'name', filter.name_contains)) return false
  if (filter.type && !matchesExact(doc, 'type', filter.type)) return false
  if (filter.country) {
    const location = doc.yaml['location']
    const country =
      location && typeof location === 'object' && !Array.isArray(location)
        ? (location as Record<string, unknown>)['country']
        : undefined
    if (typeof country !== 'string' || country !== filter.country) return false
  }
  if (filter.city_contains) {
    const location = doc.yaml['location']
    const city =
      location && typeof location === 'object' && !Array.isArray(location)
        ? (location as Record<string, unknown>)['city']
        : undefined
    if (typeof city !== 'string' || !city.toLowerCase().includes(filter.city_contains.toLowerCase())) return false
  }
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  return true
}

function matchesDayFilter(doc: Document, filter: DayFilter, path?: string): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  if (filter.date_gte && filter.date_lte && !matchesDateRange(doc, filter.date_gte, filter.date_lte, path)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  if (filter.year !== undefined && !matchesExact(doc, 'year', filter.year)) return false
  if (filter.month !== undefined && !matchesExact(doc, 'month', filter.month)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  return true
}

function matchesJournalFilter(
  doc: Document,
  filter: JournalFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  if (filter.date_gte && filter.date_lte && !matchesDateRange(doc, filter.date_gte, filter.date_lte, path)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.body_contains && !matchesBodyContains(doc, filter.body_contains)) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  if (filter.rel_contains && !matchesRelContains(doc, filter.rel_contains)) return false
  return true
}

function matchesDocumentFilter(
  doc: Document,
  path: string,
  filter: DocumentFilter,
  resolveNames?: NameResolver,
): boolean {
  if (filter.date && !matchesDate(doc, filter.date, path)) return false
  if (filter.date_gte && filter.date_lte && !matchesDateRange(doc, filter.date_gte, filter.date_lte, path)) return false
  if (filter.type && detectTypeFromPath(path) !== filter.type) return false
  if (filter.involves && !matchesInvolves(doc, filter.involves, resolveNames)) return false
  if (filter.tags_contains && !matchesTagContains(doc, filter.tags_contains)) return false
  if (filter.tags_contains_any && !matchesTagContainsAny(doc, filter.tags_contains_any)) return false
  if (filter.tags_contains_all && !matchesTagContainsAll(doc, filter.tags_contains_all)) return false
  if (filter.tags_starts_with && !matchesTagPrefix(doc, filter.tags_starts_with)) return false
  if (filter.body_contains && !matchesBodyContains(doc, filter.body_contains)) return false
  if (filter.recent && !matchesRecent(doc, filter.recent, undefined, path)) return false
  if (filter.rel_contains && !matchesRelContains(doc, filter.rel_contains)) return false
  return true
}

// =============================================================================
// Resolver factory
// =============================================================================

/**
 * Create GraphQL resolvers for DomainCollection queries.
 *
 * Note: These use the buildSchema + rootValue signature where functions
 * receive (args, context, info) directly, NOT (parent, args, context, info).
 */
export function createDomainResolvers(store: MarkdownStore) {
  const domain = DomainCollection.fromStore(store)

  // Create day lookup for resolving meeting.day, message.day, journal.day
  const lookupDay = createDayLookup(domain)

  // Resolve a name to all known aliases via PeopleStore.
  // e.g., "JW" → ["James Robert Wheeler", "JW", "Jim Wheeler"]
  const resolveNames: NameResolver = (name: string): string[] => {
    const person = store.people.find(name)
    if (!person) return [name]
    const names = new Set(person.value.names)
    if (person.value.alt) names.add(person.value.alt)
    names.add(name) // always include the original query
    return Array.from(names)
  }

  /** Sort entries by date descending (most recent first) using path-derived date. */
  function sortByDateDesc(entries: Array<{ doc: Document; path: string }>): Array<{ doc: Document; path: string }> {
    return entries.sort((a, b) => {
      const dateA = getDateForDocument(a.doc, a.path) ?? ''
      const dateB = getDateForDocument(b.doc, b.path) ?? ''
      return dateB.localeCompare(dateA)
    })
  }

  // buildSchema + rootValue pattern: functions receive (args, context, info) directly
  return {
    meetings: (args: { where?: MeetingFilter; limit?: number }) => {
      const entries = domain.entriesByType('meeting')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesMeetingFilter(doc, args.where!, path, resolveNames))
      }
      results = sortByDateDesc(results)
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => {
        const dateStr = getDateForDocument(doc, path)
        const day = dateStr ? lookupDay(dateStr) : null
        return docToMeeting(doc, path, day)
      })
    },

    messages: (args: { where?: MessageFilter; limit?: number }) => {
      const entries = domain.entriesByType('message')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesMessageFilter(doc, args.where!, path, resolveNames))
      }
      results = sortByDateDesc(results)
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => {
        const dateStr = getDateForDocument(doc, path)
        const day = dateStr ? lookupDay(dateStr) : null
        return docToMessage(doc, path, day)
      })
    },

    videos: (args: { where?: VideoFilter; limit?: number }) => {
      const entries = domain.entriesByType('video')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesVideoFilter(doc, args.where!, path, resolveNames))
      }
      results = sortByDateDesc(results)
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => {
        const dateStr = getDateForDocument(doc, path)
        const day = dateStr ? lookupDay(dateStr) : null
        return docToVideo(doc, path, day)
      })
    },

    people: (args: { where?: PersonFilter; limit?: number }) => {
      const entries = domain.entriesByType('person')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc }) => matchesPersonFilter(doc, args.where!))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToPerson(doc, path))
    },

    orgs: (args: { where?: OrgFilter; limit?: number }) => {
      const entries = domain.entriesByType('org')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc }) => matchesOrgFilter(doc, args.where!))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToOrg(doc, path))
    },

    projects: (args: { where?: ProjectFilter; limit?: number }) => {
      const entries = domain.entriesByType('project')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc }) => matchesProjectFilter(doc, args.where!, resolveNames))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToProject(doc, path))
    },

    decisions: (args: { where?: DecisionFilter; limit?: number }) => {
      const entries = domain.entriesByType('decision')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc }) => matchesDecisionFilter(doc, args.where!, resolveNames))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToDecision(doc, path))
    },

    goals: (args: { where?: GoalFilter; limit?: number }) => {
      const entries = domain.entriesByType('goal')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc }) => matchesGoalFilter(doc, args.where!, resolveNames))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToGoal(doc, path))
    },

    ideas: (args: { where?: IdeaFilter; limit?: number }) => {
      const entries = domain.entriesByType('idea')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesIdeaFilter(doc, args.where!, path, resolveNames))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToIdea(doc, path))
    },

    places: (args: { where?: PlaceFilter; limit?: number }) => {
      const entries = domain.entriesByType('place')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc }) => matchesPlaceFilter(doc, args.where!))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToPlace(doc, path))
    },

    days: (args: { where?: DayFilter; limit?: number }) => {
      const entries = domain.entriesByType('day')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesDayFilter(doc, args.where!, path))
      }
      results = sortByDateDesc(results)
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToDay(doc, path))
    },

    journals: (args: { where?: JournalFilter; limit?: number }) => {
      const entries = domain.entriesByType('journal')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesJournalFilter(doc, args.where!, path, resolveNames))
      }
      results = sortByDateDesc(results)
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => {
        const dateStr = getDateForDocument(doc, path)
        const day = dateStr ? lookupDay(dateStr) : null
        return docToJournal(doc, path, day)
      })
    },

    documents: (args: { where?: DocumentFilter; limit?: number }) => {
      const entries = domain.entriesByType('*')
      let results = entries
      if (args.where) {
        results = entries.filter(({ doc, path }) => matchesDocumentFilter(doc, path, args.where!, resolveNames))
      }
      if (args.limit) {
        results = results.slice(0, args.limit)
      }
      return results.map(({ doc, path }) => docToDocument(doc, path))
    },
  }
}
