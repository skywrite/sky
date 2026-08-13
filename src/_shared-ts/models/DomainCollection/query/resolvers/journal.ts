import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesTagPrefix } from '../filters/mod.ts'
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

/** Root of the journal tag namespace. */
const JOURNAL_NAMESPACE = 'Journal/'

/**
 * A journal is anything carrying the tag, whatever medium it was recorded in.
 *
 * `matchesTagPrefix` counts a namespace root as a member of its namespace, so
 * this accepts the bare `Journal` tag and every kind under it in one test.
 */
export function isJournal(doc: Document): boolean {
  return matchesTagPrefix(doc, JOURNAL_NAMESPACE)
}

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
  // Journal is a genre, not a medium. The other entities partition cleanly by
  // location — a message is not a meeting — but a journal entry can be prose,
  // video, voice memo or chat, and those files are correctly typed by their
  // medium. So selection runs over every document and narrows on the tag,
  // leaving a recorded entry both a video and a journal.
  type: '*',
  selects: isJournal,
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesJournalFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToJournal(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<JournalFilter, ReturnType<typeof docToJournal>>
