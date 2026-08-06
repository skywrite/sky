import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesExact, matchesTagContains } from '../filters/mod.ts'
import {
  type DatedFilter,
  type EntitySpec,
  type InvolvesFilter,
  type MappedDay,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getDateForDocument,
  getOptionalStringField,
  getStringField,
  matchesDatedFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  getWhenField,
  perRow,
} from './shared.ts'

export interface MeetingFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  year?: number
  month?: number
  whoContains?: string
  whoNotContains?: string
  medium?: string
  /** Meeting-only: the other entities express exclusion through the selector, not the filter. */
  tagsNotContains?: string
}

export function matchesMeetingFilter(
  doc: Document,
  filter: MeetingFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.year !== undefined && !matchesExact(doc, 'year', filter.year)) return false
  if (filter.month !== undefined && !matchesExact(doc, 'month', filter.month)) return false
  if (filter.whoContains && !matchesContains(doc, 'who', filter.whoContains)) return false
  if (filter.whoNotContains && matchesContains(doc, 'who', filter.whoNotContains)) return false
  if (filter.medium && !matchesExact(doc, 'medium', filter.medium)) return false
  if (filter.tagsNotContains && matchesTagContains(doc, filter.tagsNotContains)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  return true
}

export function docToMeeting(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    who: getStringField(doc, 'who'),
    when: getWhenField(doc),
    medium: getStringField(doc, 'medium'),
    context: getOptionalStringField(doc, 'context'),
    summary: getOptionalStringField(doc, 'summary'),
    where: getOptionalStringField(doc, 'where'),
    date: getDateForDocument(doc, path) ?? '',
    day,
    ...docBase(doc, path),
  }
}

export default {
  type: 'meeting',
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesMeetingFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToMeeting(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<MeetingFilter, ReturnType<typeof docToMeeting>>
