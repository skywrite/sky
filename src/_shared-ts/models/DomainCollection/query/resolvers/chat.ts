import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains } from '../filters/mod.ts'
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
  matchesDatedFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface ChatFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  summaryContains?: string
}

export function matchesChatFilter(
  doc: Document,
  filter: ChatFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.summaryContains && !matchesContains(doc, 'summary', filter.summaryContains)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  return true
}

export function docToChat(doc: Document, path: string, day: MappedDay | null = null) {
  // Chat filenames encode the start time: HH-MM_Slugified-Summary.md
  const timeMatch = path
    .split('/')
    .pop()
    ?.match(/^(\d{2})-(\d{2})_/)
  const turns = doc.yaml['turns']

  return {
    date: getDateForDocument(doc, path) ?? '',
    day,
    when: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : null,
    summary: getOptionalStringField(doc, 'summary'),
    provider: getOptionalStringField(doc, 'provider'),
    model: getOptionalStringField(doc, 'model'),
    turns: typeof turns === 'number' ? turns : 0,
    ...docBase(doc, path),
  }
}

export default {
  type: 'chat',
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesChatFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToChat(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<ChatFilter, ReturnType<typeof docToChat>>
