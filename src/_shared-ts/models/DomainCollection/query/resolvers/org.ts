import type { Document } from '#shared/models/Markdown/mod.ts'
import { kindFromTags } from '#shared/models/Organization/document/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type TagFilter,
  type TextFilter,
  docBase,
  getOptionalStringField,
  getStringField,
  matchesActivityFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface OrgFilter extends TagFilter, TextFilter, ActivityFilter {
  name?: string
  nameContains?: string
  sector?: string
  kind?: string
}

export function matchesOrgFilter(doc: Document, filter: OrgFilter): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.sector && !matchesExact(doc, 'sector', filter.sector)) return false
  // kind is derived from tags, which may be sector-qualified (Organization/Company/Crypto)
  if (filter.kind && kindFromTags(doc.tags) !== filter.kind.toLowerCase()) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

export function docToOrg(doc: Document, path: string) {
  const kind = kindFromTags(doc.tags)

  return {
    name: getStringField(doc, 'name'),
    slug: getOptionalStringField(doc, 'slug'),
    site: getOptionalStringField(doc, 'site'),
    sector: getOptionalStringField(doc, 'sector'),
    subcategory: getOptionalStringField(doc, 'subcategory'),
    description: getOptionalStringField(doc, 'description'),
    kind,
    ...docBase(doc, path),
  }
}

export default {
  type: 'org',
  matches: (doc, filter) => matchesOrgFilter(doc, filter),
  mapper: () => perRow(docToOrg),
} satisfies EntitySpec<OrgFilter, ReturnType<typeof docToOrg>>
