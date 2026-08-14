import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type TagFilter,
  type TextFilter,
  docBase,
  getField,
  getOptionalStringField,
  getStringField,
  matchesActivityFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface PersonFilter extends TagFilter, TextFilter, ActivityFilter {
  name?: string
  nameContains?: string
  org?: string
  orgContains?: string
  titleContains?: string
}

export function matchesPersonFilter(doc: Document, filter: PersonFilter): boolean {
  if (filter.name && !matchesExact(doc, 'name', filter.name)) return false
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.org && !matchesExact(doc, 'org', filter.org)) return false
  if (filter.orgContains && !matchesContains(doc, 'org', filter.orgContains)) return false
  if (filter.titleContains && !matchesContains(doc, 'title', filter.titleContains)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

/** Org lists tolerate a bare string as well as the array the schema promises. */
function parseOrgArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return [value]
  }
  return []
}

export function docToPerson(doc: Document, path: string) {
  const names = getField(doc, 'names')
  const met = getField(doc, 'met')

  // Parse orgs structure: { current: string[], past: string[] }
  const orgsRaw = getField(doc, 'orgs')
  const orgs =
    orgsRaw && typeof orgsRaw === 'object' && !Array.isArray(orgsRaw)
      ? {
          current: parseOrgArray((orgsRaw as Record<string, unknown>)['current']),
          past: parseOrgArray((orgsRaw as Record<string, unknown>)['past']),
        }
      : { current: [], past: [] }

  return {
    name: getStringField(doc, 'name'),
    // Read straight from YAML rather than through a set type, so a malformed
    // list item would reach the schema's [String!]! as a null and null the
    // whole response.
    names: Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [],
    org: getOptionalStringField(doc, 'org'),
    orgs,
    title: getOptionalStringField(doc, 'title'),
    location: getOptionalStringField(doc, 'location'),
    met: met != null ? String(met) : null,
    ...docBase(doc, path),
  }
}

export default {
  type: 'person',
  matches: (doc, filter) => matchesPersonFilter(doc, filter),
  mapper: () => perRow(docToPerson),
} satisfies EntitySpec<PersonFilter, ReturnType<typeof docToPerson>>
