import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains } from '../filters/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type InvolvesFilter,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getStringField,
  matchesActivityFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface IdeaFilter extends TagFilter, TextFilter, InvolvesFilter, ActivityFilter {
  nameContains?: string
  status?: string
}

/** Status is path-derived for ideas — the folder an idea sits in is its state. */
export function ideaStatusFromPath(path: string): string {
  if (path.includes('/exploring/')) return 'exploring'
  if (path.includes('/actioned/')) return 'actioned'
  if (path.includes('/archived/')) return 'archived'
  return 'draft'
}

export function matchesIdeaFilter(
  doc: Document,
  filter: IdeaFilter,
  path: string,
  resolveNames?: NameResolver,
): boolean {
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.status && ideaStatusFromPath(path) !== filter.status) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

export function docToIdea(doc: Document, path: string) {
  return {
    name: getStringField(doc, 'name'),
    status: ideaStatusFromPath(path),
    ...docBase(doc, path),
  }
}

export default {
  type: 'idea',
  matches: (doc, filter, path, ctx) => matchesIdeaFilter(doc, filter, path, ctx.resolveNames),
  mapper: () => perRow(docToIdea),
} satisfies EntitySpec<IdeaFilter, ReturnType<typeof docToIdea>>
