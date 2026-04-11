/**
 * Location data combining geographic hierarchy and coordinates.
 */
export interface PlaceLocation {
  country: string // ISO country code (US, JP, PL, etc.)
  region?: string // State/province/prefecture
  city?: string
  subcity?: string // Borough/neighborhood (e.g., Manhattan, Ginza)
  latitude: number
  longitude: number
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
