import type { PlaceKind } from '#shared/models/Place/document/types.ts'
import type { ZonedDateTime } from '#universal/dates/nbdt/mod.ts'
import type { Backlink } from '../vocabulary/mod.ts'

export type { PlaceKind }

export const placeKinds = {
  venue: 'Venue or address',
  country: 'Country',
  region: 'Region',
  city: 'City',
  neighborhood: 'Neighborhood',
  area: 'Area',
} as const
export const placeCategories: Record<string, string> = {
  drink: 'Café & drinks',
  eat: 'Restaurant',
  stay: 'Hotel & stay',
  office: 'Office',
  residence: 'Home',
  visit: 'Place to visit',
  park: 'Park',
  shop: 'Shop',
  travel: 'Travel',
  learn: 'Learning',
  fitness: 'Fitness',
  medical: 'Medical',
  church: 'Place of worship',
  stadium: 'Stadium',
  do: 'Activity',
}
export interface Coordinates {
  latitude: number
  longitude: number
}
export interface PlaceFields {
  name: string
  kind: PlaceKind
  category: string
  aliases: string[]
  parent: string
  address: string
  site: string
  country: string
  region: string
  city: string
  subcity: string
  coordinates: Coordinates | null
  googlePlaceId: string
  googleMapsUrl: string
}
export interface PlaceSummary extends PlaceFields {
  id: string
  ref: string
  locationLabel: string
  /** Explicit parent first; otherwise the closest saved geography in the existing reference. */
  parentRef: string
  archived: boolean
  connections: number
}
export interface PlaceConnection {
  id: string
  name: string
  type: 'person' | 'org'
  href: string
  via: string
}
export interface PlaceDetail extends PlaceSummary {
  revision: string
  html: string
  tags: string[]
  activity: Backlink[]
  people: PlaceConnection[]
  ancestors: PlaceSummary[]
  children: PlaceSummary[]
}
export interface SavePlace extends PlaceFields {
  id?: string
  revision?: string
  notes?: string
  allowNamesake?: boolean
}
export interface MapsConfig {
  browserKey: string
  mapId: string
  searchAvailable: boolean
  configurable: boolean
  message?: string
}
export interface PlacesIndex {
  places: PlaceSummary[]
  maps: MapsConfig
}
export interface GooglePlaceResult {
  id: string
  name: string
  address: string
  kind: PlaceKind
  category: string
  coordinates: Coordinates | null
  savedRef?: string
  attributions: Array<{ name: string; uri: string }>
}
export interface MapsHost {
  config(): Promise<MapsConfig>
  configure(input: { browserKey?: string; serverKey?: string; mapId?: string }): Promise<MapsConfig>
  search(query: string): Promise<GooglePlaceResult[]>
  detail(id: string): Promise<PlaceFields>
}
export interface PlacesOptions {
  placesDir: string
  stateDir: string
  now?: () => ZonedDateTime
  maps?: MapsHost
}
export class PlaceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 | 502 | 503 = 400,
  ) {
    super(message)
  }
}
export const blankPlace = (): PlaceFields => ({
  name: '',
  kind: 'venue',
  category: 'visit',
  aliases: [],
  parent: '',
  address: '',
  site: '',
  country: '',
  region: '',
  city: '',
  subcity: '',
  coordinates: null,
  googlePlaceId: '',
  googleMapsUrl: '',
})
export function placeHref(ref: string): string {
  return `/places/${ref
    .replace(/^places\//, '')
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
}
export function placeLabel(place: Pick<PlaceFields, 'kind' | 'category'>): string {
  return place.kind === 'venue' ? placeCategories[place.category] || place.category || 'Venue' : placeKinds[place.kind]
}
export function placeMapHref(
  place: Pick<PlaceFields, 'googleMapsUrl' | 'googlePlaceId' | 'coordinates' | 'name' | 'address'>,
): string {
  if (/^https:\/\/(?:www\.)?google\.[a-z.]+\/maps\b/.test(place.googleMapsUrl)) return place.googleMapsUrl
  const query = place.coordinates
    ? `${place.coordinates.latitude},${place.coordinates.longitude}`
    : [place.name, place.address].filter(Boolean).join(', ')
  return `https://www.google.com/maps/search/?${new URLSearchParams({ api: '1', query, ...(place.googlePlaceId ? { query_place_id: place.googlePlaceId } : {}) })}`
}
export function isWithinPlace(place: PlaceSummary, ref: string, places: readonly PlaceSummary[]): boolean {
  const byRef = new Map(places.map((p) => [p.ref.toLowerCase(), p]))
  const seen = new Set<string>([place.ref.toLowerCase()])
  let parent = place.parentRef
  while (parent && !seen.has(parent.toLowerCase())) {
    if (parent.toLowerCase() === ref.toLowerCase()) return true
    seen.add(parent.toLowerCase())
    parent = byRef.get(parent.toLowerCase())?.parentRef ?? ''
  }
  return false
}
