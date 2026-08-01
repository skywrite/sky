import type { Document } from '#shared/models/Markdown/mod.ts'
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

export interface PlaceFilter extends TagFilter, TextFilter, ActivityFilter {
  nameContains?: string
  type?: string
  country?: string
  cityContains?: string
}

/** country and city are nested inside the location YAML object, not top level. */
function locationField(doc: Document, key: string): string | null {
  const location = doc.yaml['location']
  if (!location || typeof location !== 'object' || Array.isArray(location)) return null
  const value = (location as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : null
}

export function matchesPlaceFilter(doc: Document, filter: PlaceFilter): boolean {
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.type && !matchesExact(doc, 'type', filter.type)) return false
  if (filter.country && locationField(doc, 'country') !== filter.country) return false
  if (filter.cityContains) {
    const city = locationField(doc, 'city')
    if (!city || !city.toLowerCase().includes(filter.cityContains.toLowerCase())) return false
  }
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

export function docToPlace(doc: Document, path: string) {
  return {
    name: getStringField(doc, 'name'),
    type: getStringField(doc, 'type'),
    address: getOptionalStringField(doc, 'address'),
    site: getOptionalStringField(doc, 'site'),
    googleMapsUrl: getOptionalStringField(doc, 'googleMapsUrl'),
    country: locationField(doc, 'country'),
    city: locationField(doc, 'city'),
    ...docBase(doc, path),
  }
}

export default {
  type: 'place',
  matches: (doc, filter) => matchesPlaceFilter(doc, filter),
  mapper: () => perRow(docToPlace),
} satisfies EntitySpec<PlaceFilter, ReturnType<typeof docToPlace>>
