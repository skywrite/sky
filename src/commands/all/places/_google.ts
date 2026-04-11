// TEMPORARY until Deno can fix its Node.js compatibilty
// and I can use google-maps-services-js

export async function fetchGoogleMapsTextSearch(query: string, apiKey: string): Promise<Record<string, any>> {
  const q = encodeURIComponent(query).replace(/%20/g, '+')

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${apiKey}`

  const res = await fetch(url)
  return await res.json()
}

export async function fetchGoogleMapsPlaceDetails(placeId: string, apiKey: string): Promise<Record<string, any>> {
  // add &fields=address_components to narrow down fields
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}`

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
  state: string
  city: string
  subcity: string // e.g. Manhattan in NYC
  zip?: string
  address: string
}

/**
 * Parse Google Maps address_components into a structured result.
 *
 * Google Maps Address Component Types:
 * ------------------------------------
 * - country: Country (short_name = "US", "JP", "MX", etc.)
 * - administrative_area_level_1: State/province/prefecture (e.g., "NY", "Tokyo", "Q.R.")
 * - locality: City (e.g., "New York", "Cancun") or ward in Japan (e.g., "Chuo City")
 * - postal_town: City alternative used in UK
 * - sublocality_level_1: Borough/district (e.g., "Manhattan", "Shibuya")
 * - sublocality_level_2: Neighborhood (e.g., "Ginza", "Roppongi", "Zona Hotelera")
 *
 * Subcity Selection:
 * ------------------
 * We prefer the most granular subcity (neighborhood over borough).
 * - NYC: Manhattan (level_1) - no level_2 available
 * - Tokyo: Ginza (level_2) preferred over Chuo City (level_1 is actually locality here)
 * - Cancun: Zona Hotelera (level_1 or level_2 depending on location)
 *
 * See search.ts buildFileLoc() for how these are assembled into file paths.
 */
export function assembleGoogleAddressComponents(addressComponents: GoogleAddressComponent[]): GoogleAddressResult {
  const res: GoogleAddressResult = { country: '', state: '', city: '', subcity: '', address: '' }

  // Match exact type in the types array
  // IMPORTANT: Must use .includes() on array, not string, to avoid partial matches
  // e.g., "sublocality".includes("locality") would incorrectly match
  const matchTypes = (search: string) => (ac: GoogleAddressComponent) => ac.types.includes(search)

  // City: prefer locality, fall back to postal_town (UK)
  const cityOption1 = addressComponents.find(matchTypes('locality'))?.short_name
  const cityOption2 = addressComponents.find(matchTypes('postal_town'))?.short_name

  res.country = addressComponents.find(matchTypes('country'))?.short_name || ''
  res.state = addressComponents.find(matchTypes('administrative_area_level_1'))?.short_name || ''
  res.city = cityOption1 || cityOption2 || ''

  // Subcity: prefer neighborhood (level_2) over ward/borough (level_1)
  // Examples:
  //   - Tokyo: Ginza (level_2) instead of Chuo City ward
  //   - NYC: Manhattan (level_1) - no level_2 available
  //   - Cancun: Zona Hotelera (whichever level Google provides)
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

// https://developers.google.com/maps/documentation/places/web-service/supported_types
export const MAP_TYPE_DIR = {
  church: 'church',
  casino: 'stay',
  park: 'park',
  restaurant: 'eat',
  bakery: 'eat',
  lodging: 'stay',
  bar: 'drink',
  cafe: 'drink',
  night_club: 'drink',
  point_of_interest: 'visit',
  museum: 'visit',
  tourist_attraction: 'visit',
  stadium: 'stadium',
  primary_school: 'learn',
  secondary_school: 'learn',
  clothing_store: 'shop',
  department_store: 'shop',
  liquor_store: 'shop',
  neighborhood: 'visit',
  store: 'shop',
  electronics_store: 'shop',
  gym: 'fitness',
  premise: 'residence',
  airport: 'travel',
  meal_takeaway: 'eat',
  bowling_alley: 'do',
  jewelry_store: 'shop',
  movie_theater: 'do',
  book_store: 'shop',
  shoe_store: 'shop',
  spa: 'do',
  route: 'visit',
  subpremise: 'office',
  hospital: 'medical',
  food: 'eat',
  natural_feature: 'visit',
  shopping_mall: 'shop',
  train_station: 'travel',
  finance: 'office',
  real_estate_agency: 'office',
  zoo: 'visit',
  amusement_park: 'visit',
  travel_agency: 'do',
  supermarket: 'shop',
  university: 'visit',
  establishment: 'eat',
}
