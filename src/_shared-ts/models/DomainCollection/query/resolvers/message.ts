import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
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

export interface MessageFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  from?: string
  fromNot?: string
  toContains?: string
  toNotContains?: string
  medium?: string
}

export function matchesMessageFilter(
  doc: Document,
  filter: MessageFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.from && !matchesExact(doc, 'from', filter.from)) return false
  if (filter.fromNot && matchesExact(doc, 'from', filter.fromNot)) return false
  if (filter.toContains && !matchesContains(doc, 'to', filter.toContains)) return false
  if (filter.toNotContains && matchesContains(doc, 'to', filter.toNotContains)) return false
  if (filter.medium && !matchesExact(doc, 'medium', filter.medium)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  return true
}

export function docToMessage(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    from: getOptionalStringField(doc, 'from'),
    to: getOptionalStringField(doc, 'to'),
    when: getWhenField(doc),
    medium: getStringField(doc, 'medium'),
    summary: getOptionalStringField(doc, 'summary'),
    date: getDateForDocument(doc, path) ?? '',
    day,
    ...docBase(doc, path),
  }
}

export default {
  type: 'message',
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesMessageFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToMessage(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<MessageFilter, ReturnType<typeof docToMessage>>
