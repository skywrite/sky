import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type DatedFilter,
  type EntitySpec,
  type MappedDay,
  type TagFilter,
  type TextFilter,
  docBase,
  getDateForDocument,
  getStringField,
  getWhenField,
  matchesDatedFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface RecapFilter extends DatedFilter, TagFilter, TextFilter {
  app?: string
  appNot?: string
  whatContains?: string
}

export function matchesRecapFilter(doc: Document, filter: RecapFilter, path?: string): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.app && !matchesExact(doc, 'app', filter.app)) return false
  if (filter.appNot && matchesExact(doc, 'app', filter.appNot)) return false
  if (filter.whatContains && !matchesContains(doc, 'what', filter.whatContains)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  return true
}

export function docToRecap(doc: Document, path: string, day: MappedDay | null = null) {
  return {
    app: getStringField(doc, 'app', ''),
    what: getStringField(doc, 'what', ''),
    when: getWhenField(doc),
    date: getDateForDocument(doc, path) ?? '',
    day,
    ...docBase(doc, path),
  }
}

export default {
  type: 'recap',
  sortByDate: true,
  matches: (doc, filter, path) => matchesRecapFilter(doc, filter, path),
  mapper: (ctx) => perRow((doc, path) => docToRecap(doc, path, ctx.dayFor(doc, path))),
} satisfies EntitySpec<RecapFilter, ReturnType<typeof docToRecap>>
