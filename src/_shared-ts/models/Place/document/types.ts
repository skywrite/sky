/**
 * Location data combining geographic hierarchy and coordinates.
 */
export interface PlaceLocation {
  country: string // ISO country code (US, JP, PL, etc.)
  region?: string // State/province/prefecture
  city?: string
  subcity?: string // Borough/neighborhood (e.g., Manhattan, Ginza)
  latitude?: number
  longitude?: number
  plusCode?: string
}

/**
 * Input data for creating a new Place from Google Maps data.
 */
export interface PlaceCreateInput {
  name: string
  type: string // eat, drink, stay, visit, etc.
  address?: string
  site?: string
  location: PlaceLocation
  googleMapsUrl?: string
}

export const GEOGRAPHIC_KINDS = ['country', 'region', 'city', 'neighborhood', 'area'] as const
export type GeographicKind = (typeof GEOGRAPHIC_KINDS)[number]
export type PlaceKind = GeographicKind | 'venue'

/** Geographic records do not require a Maps lookup or a representative point. */
export interface GeographicPlaceInput {
  name: string
  ref: string
  kind: GeographicKind
  parent?: string
  aliases?: string[]
  location?: PlaceLocation
}

/**
 * Parsed components from a place path.
 */
export interface PlacePathComponents {
  country: string
  region?: string
  city?: string
  subcity?: string
  type?: string
  slug?: string
}
