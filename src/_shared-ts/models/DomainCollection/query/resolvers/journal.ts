import type { Document } from '#shared/models/Markdown/mod.ts'
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

/** Journals filter purely on the shared mixins — they carry no fields of their own. */
export type JournalFilter = DatedFilter & TagFilter & TextFilter & InvolvesFilter

export function matchesJournalFilter(
  doc: Document,
  filter: JournalFilter,
  path?: string,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  return true
}

export function docToJournal(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    date: getDateForDocument(doc, path) ?? '',
    day,
    time: getOptionalStringField(doc, 'time'),
    ...docBase(doc, path),
  }
}

export default {
  type: 'journal',
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesJournalFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToJournal(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<JournalFilter, ReturnType<typeof docToJournal>>
