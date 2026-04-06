// TEMPORARY until Deno can fix its Node.js compatibilty
// and I can use google-maps-services-js

export async function fetchGoogleGeocode(lat: number, lng: number, apiKey: string): Promise<Record<string, any>> {
  // add &fields=address_components to narrow down fields
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`

  const res = await fetch(url)
  return await res.json()
}

export interface GoogleAddressComponent {
  long_name: string
  short_name: string
  types: string[]
}

export interface GoogleAddressResult {
  country: string
  country_code: string
  region: string // often the state (in my places task, I actually call it state)
  city: string
  subcity: string // e.g. Manhattan in NYC
  zip?: string
  address: string
  latitude?: number // not returned yet
  longitude?: number // not returned yet
}

export function assembleGoogleAddressComponents(addressComponents: GoogleAddressComponent[]): GoogleAddressResult {
  const res: GoogleAddressResult = { country: '', country_code: '', region: '', city: '', subcity: '', address: '' }

  // Match exact type in the types array
  // IMPORTANT: Must use .includes() on array, not types[0], to avoid missing matches
  const matchTypes = (search: string) => (ac: GoogleAddressComponent) => ac.types.includes(search)

  res.country_code = addressComponents.find(matchTypes('country'))?.short_name || ''
  res.country = addressComponents.find(matchTypes('country'))?.long_name || ''
  res.region = addressComponents.find(matchTypes('administrative_area_level_1'))?.short_name || ''

  // City: prefer locality, fall back to postal_town (UK)
  const cityOption1 = addressComponents.find(matchTypes('locality'))?.short_name
  const cityOption2 = addressComponents.find(matchTypes('postal_town'))?.short_name
  res.city = cityOption1 || cityOption2 || ''

  // Subcity: prefer neighborhood (level_2) over ward/borough (level_1)
  const neighborhood = addressComponents.find(matchTypes('sublocality_level_2'))?.short_name
  const ward = addressComponents.find(matchTypes('sublocality_level_1'))?.short_name
  res.subcity = neighborhood || ward || ''

  const zip = addressComponents.find(matchTypes('postal_code'))?.short_name
  if (zip) res.zip = zip

  const street = addressComponents.find(matchTypes('route'))?.short_name
  const streetNumber = addressComponents.find(matchTypes('street_number'))?.short_name

  if (street && streetNumber) res.address = `${streetNumber} ${street}`

  return res
}

/**
 * Build a place path from location data.
 *
 * Country-based rules:
 * - English-speaking (US, CA, AU, GB, NZ, IE): places/country/state/city/subcity
 * - Japan: places/country/prefecture/subcity (skip ward)
 * - Others: places/country/city/subcity (skip region)
 *
 * @example
 * buildPlacePath({ country_code: 'US', region: 'NY', city: 'New York', subcity: 'Manhattan', ... })
 * // => "places/US/NY/New-York/Manhattan"
 */
export function buildPlacePath(location: GoogleAddressResult): string {
  const slugify = (str: string) => str.replace(/\s+/g, '-')

  const country = slugify(location.country_code)
  const region = slugify(location.region)
  const city = slugify(location.city)
  const subcity = slugify(location.subcity)

  // English-speaking countries: state/province abbreviations are widely recognized
  const COUNTRIES_WITH_REGIONS = new Set(['US', 'CA', 'AU', 'GB', 'NZ', 'IE'])

  // Japan: prefecture (admin_level_1) is recognizable, ward (locality) is not
  const COUNTRIES_USE_ADMIN_AS_CITY = new Set(['JP'])

  let path: string
  if (COUNTRIES_WITH_REGIONS.has(location.country_code)) {
    // English-speaking: places/country/state/city
    path = `places/${country}/${region}/${city}`
  } else if (COUNTRIES_USE_ADMIN_AS_CITY.has(location.country_code)) {
    // Japan: places/country/prefecture (skip ward)
    path = `places/${country}/${region}`
  } else {
    // Others: places/country/city (skip region)
    path = `places/${country}/${city}`
  }

  // Append subcity if available
  if (location.subcity) {
    path = `${path}/${subcity}`
  }

  return path
}
