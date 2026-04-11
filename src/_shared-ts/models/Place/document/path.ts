import type { PlaceLocation, PlacePathComponents } from './types.ts'

/**
 * Place File Path Logic
 * =====================
 *
 * Places are stored in a hierarchical directory structure based on location.
 * The structure varies by country to balance navigability with usefulness.
 *
 * Google Maps provides these address components:
 *   - country: Country code (US, JP, MX, etc.)
 *   - administrative_area_level_1: State/province/prefecture
 *   - locality: City (or ward in Japan)
 *   - sublocality_level_1: Borough/district (e.g., Manhattan in NYC)
 *   - sublocality_level_2: Neighborhood (e.g., Ginza in Tokyo)
 *
 * We prefer the most granular subcity available (level_2 over level_1).
 * See tasks/all/places/_google.ts assembleGoogleAddressComponents() for parsing logic.
 *
 * Country Categories:
 * -------------------
 *
 * 1. COUNTRIES_WITH_REGIONS (English-speaking)
 *    State/province abbreviations are widely recognized.
 *    Path: places/country/state/city/subcity/type/Name.md
 *    Examples:
 *      - places/US/NY/New-York/Manhattan/drink/Ty-Bar.md
 *      - places/CA/ON/Toronto/eat/Restaurant.md
 *      - places/AU/NSW/Sydney/visit/Opera-House.md
 *      - places/GB/England/London/Soho/drink/Bar.md
 *
 * 2. COUNTRIES_USE_ADMIN_AS_CITY (Japan)
 *    Prefecture is recognizable, ward (locality) is not.
 *    Use prefecture as city, skip ward, use neighborhood as subcity.
 *    Path: places/country/prefecture/neighborhood/type/Name.md
 *    Examples:
 *      - places/JP/Tokyo/Ginza/eat/Sukiyabashi-Jiro.md
 *      - places/JP/Tokyo/Roppongi/drink/Bar.md
 *      - places/JP/Osaka/Dotonbori/eat/Restaurant.md
 *
 * 3. All Other Countries
 *    Skip region (abbreviations like Q.R., CDMX are not intuitive).
 *    Path: places/country/city/subcity/type/Name.md
 *    Examples:
 *      - places/MX/Cancun/Zona-Hotelera/drink/Coco-Bongo.md
 *      - places/FR/Paris/Le-Marais/eat/Cafe.md
 *      - places/IT/Rome/eat/Restaurant.md
 */

/**
 * Known place types used in file paths.
 * These help distinguish between subcity names and type directories when parsing paths.
 */
export const PLACE_TYPES = new Set([
  'church',
  'do',
  'drink',
  'eat',
  'fitness',
  'learn',
  'medical',
  'office',
  'park',
  'residence',
  'shop',
  'stadium',
  'stay',
  'travel',
  'visit',
])

/**
 * English-speaking countries where state/province abbreviations are widely recognized.
 * Note: Ireland (IE) excluded - Irish counties aren't as recognizable internationally.
 */
export const COUNTRIES_WITH_REGIONS = new Set(['US', 'CA', 'AU', 'GB', 'NZ'])

/**
 * Countries where administrative_area_level_1 (prefecture) is more recognizable
 * than locality (ward). Use prefecture as city, skip ward, neighborhood becomes subcity.
 */
export const COUNTRIES_USE_ADMIN_AS_CITY = new Set(['JP'])

/**
 * De-slugify a string by replacing hyphens with spaces.
 * "New-York" -> "New York"
 */
export function deslugify(slug: string): string {
  return slug.replace(/-/g, ' ')
}

/**
 * Slugify a string for use in file paths.
 * Simple version that just replaces spaces with hyphens.
 */
function slugify(str: string): string {
  return str.replace(/\s+/g, '-')
}

/**
 * Build a place path from location data (without the `places/` prefix).
 *
 * Country-based rules:
 * - English-speaking (US, CA, AU, GB, NZ): country/region/city/subcity/type
 * - Japan: country/region/subcity/type (skip city/ward)
 * - Others: country/city/subcity/type (skip region)
 *
 * @example
 * buildPlacePath({ country: 'US', region: 'NY', city: 'New York', subcity: 'Manhattan', ... }, 'drink')
 * // => "US/NY/New-York/Manhattan/drink"
 */
export function buildPlacePath(location: PlaceLocation, type: string): string {
  const country = slugify(location.country)
  const region = location.region ? slugify(location.region) : ''
  const city = location.city ? slugify(location.city) : ''
  const subcity = location.subcity ? slugify(location.subcity) : ''

  let path: string
  if (COUNTRIES_WITH_REGIONS.has(location.country)) {
    // English-speaking: country/region/city
    path = `${country}/${region}/${city}`
  } else if (COUNTRIES_USE_ADMIN_AS_CITY.has(location.country)) {
    // Japan: country/region (skip ward)
    path = `${country}/${region}`
  } else {
    // Others: country/city (skip region)
    path = `${country}/${city}`
  }

  // Append subcity if available
  if (subcity) {
    path = `${path}/${subcity}`
  }

  // Append type
  path = `${path}/${type}`

  return path
}

/**
 * Parse a place path into its components.
 *
 * Uses PLACE_TYPES to distinguish between subcity names and type directories.
 *
 * @example
 * parsePlacePath("places/US/NY/New-York/Manhattan/drink/Ty-Bar")
 * // => { country: "US", region: "NY", city: "New-York", subcity: "Manhattan", type: "drink", slug: "Ty-Bar" }
 */
export function parsePlacePath(path: string): PlacePathComponents {
  // Remove "places/" prefix if present
  const normalized = path.replace(/^places\//, '')
  const parts = normalized.split('/')

  if (parts.length < 2) {
    return { country: parts[0] || '' }
  }

  const country = parts[0]

  // Helper to check if a segment is a known place type
  const isType = (segment: string) => PLACE_TYPES.has(segment)

  // Determine structure based on country
  if (COUNTRIES_WITH_REGIONS.has(country)) {
    // English-speaking: country/region/city/subcity?/type/slug?
    const [, region, city, ...rest] = parts
    if (rest.length === 0) {
      return { country, region, city }
    } else if (rest.length === 1) {
      return { country, region, city, type: rest[0] }
    } else if (rest.length === 2) {
      // Check if first is type or subcity
      if (isType(rest[0])) {
        return { country, region, city, type: rest[0], slug: rest[1] }
      }
      return { country, region, city, subcity: rest[0], type: rest[1] }
    } else {
      // subcity/type/slug
      return { country, region, city, subcity: rest[0], type: rest[1], slug: rest[2] }
    }
  } else if (COUNTRIES_USE_ADMIN_AS_CITY.has(country)) {
    // Japan: country/region/subcity?/type/slug?
    const [, region, ...rest] = parts
    if (rest.length === 0) {
      return { country, region }
    } else if (rest.length === 1) {
      return { country, region, type: rest[0] }
    } else if (rest.length === 2) {
      // Check if first is type or subcity
      if (isType(rest[0])) {
        return { country, region, type: rest[0], slug: rest[1] }
      }
      return { country, region, subcity: rest[0], type: rest[1] }
    } else {
      return { country, region, subcity: rest[0], type: rest[1], slug: rest[2] }
    }
  } else {
    // Others: country/city/subcity?/type/slug?
    const [, city, ...rest] = parts
    if (rest.length === 0) {
      return { country, city }
    } else if (rest.length === 1) {
      return { country, city, type: rest[0] }
    } else if (rest.length === 2) {
      // Check if first is type or subcity
      if (isType(rest[0])) {
        return { country, city, type: rest[0], slug: rest[1] }
      }
      return { country, city, subcity: rest[0], type: rest[1] }
    } else {
      return { country, city, subcity: rest[0], type: rest[1], slug: rest[2] }
    }
  }
}

/**
 * Convert a place path or location to a human-readable display string.
 *
 * @example
 * toDisplayString({ country: 'US', region: 'NY', city: 'New-York', subcity: 'Manhattan' })
 * // => "Manhattan, New York, NY"
 *
 * toDisplayString({ country: 'PL', city: 'Kraków' })
 * // => "Kraków, PL"
 */
export function toDisplayString(location: PlacePathComponents): string {
  const parts: string[] = []

  // Add most specific first (subcity -> city -> region -> country)
  if (location.subcity) {
    parts.push(deslugify(location.subcity))
  }

  if (COUNTRIES_WITH_REGIONS.has(location.country)) {
    // English-speaking: include city and region abbreviation
    if (location.city) {
      parts.push(deslugify(location.city))
    }
    if (location.region) {
      parts.push(location.region) // Keep region as-is (it's already an abbreviation like NY)
    }
  } else if (COUNTRIES_USE_ADMIN_AS_CITY.has(location.country)) {
    // Japan: include region (prefecture) as city
    if (location.region) {
      parts.push(deslugify(location.region))
    }
    parts.push(location.country)
  } else {
    // Others: include city and country
    if (location.city) {
      parts.push(deslugify(location.city))
    }
    parts.push(location.country)
  }

  return parts.join(', ')
}
