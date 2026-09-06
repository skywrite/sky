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
  getStringField,
  matchesDatedFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface NoteFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  summaryContains?: string
}

/**
 * A note is anything declaring `type: Notes` in its frontmatter.
 *
 * Current captures live in the day's notes folder, but earlier eras filed notes
 * directly in their day dirs and a few landed in library/ and project
 * folders — the frontmatter marker is the one constant across eras, and no
 * other document kind declares a `type:` that collides with it.
 */
export function isNote(doc: Document): boolean {
  return getStringField(doc, 'type') === 'Notes'
}

export function matchesNoteFilter(
  doc: Document,
  filter: NoteFilter,
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

export function docToNote(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    date: getDateForDocument(doc, path) ?? '',
    day,
    // Notes store a bare time scalar in `when:`, not a When object.
    when: getOptionalStringField(doc, 'when'),
    summary: getOptionalStringField(doc, 'summary'),
    context: getOptionalStringField(doc, 'context'),
    ...docBase(doc, path),
  }
}

export default {
  // Notes declare membership in frontmatter rather than partitioning by
  // location the way messages or meetings do, so selection runs over every
  // document and narrows on the marker (see isNote).
  type: '*',
  selects: isNote,
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesNoteFilter(doc, filter, path, ctx.resolveNames),
  mapper: (ctx) => perRow((doc, path) => docToNote(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<NoteFilter, ReturnType<typeof docToNote>>
