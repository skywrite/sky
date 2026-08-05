import { detectTypeFromPath } from '#shared/models/Markdown/Collection/entityTypes.ts'
import type { Document } from '#shared/models/Markdown/mod.ts'
import {
  type DatedFilter,
  type EntitySpec,
  type InvolvesFilter,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  matchesDatedFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface DocumentFilter extends DatedFilter, TagFilter, TextFilter, InvolvesFilter {
  type?: string
  pathContains?: string
}

export function matchesDocumentFilter(
  doc: Document,
  path: string,
  filter: DocumentFilter,
  resolveNames?: NameResolver,
): boolean {
  if (!matchesDatedFilter(doc, filter, path)) return false
  if (filter.type && detectTypeFromPath(path) !== filter.type) return false
  if (filter.pathContains && !path.includes(filter.pathContains)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  return true
}

export function docToDocument(doc: Document, path: string) {
  return {
    type: detectTypeFromPath(path),
    markdown: doc.markdown,
    path,
  }
}

export default {
  // Every document, whatever its detected type — this is the untyped escape
  // hatch the other fourteen root fields narrow.
  type: '*',
  // Without this, `limit` sliced store order — roughly oldest path first — so
  // a broad tag query returned 2022 files and cut the current ones. Undated
  // entity files sink to the end.
  sortByDate: true,
  matches: (doc, filter, path, ctx) => matchesDocumentFilter(doc, path, filter, ctx.resolveNames),
  mapper: () => perRow(docToDocument),
} satisfies EntitySpec<DocumentFilter, ReturnType<typeof docToDocument>>
