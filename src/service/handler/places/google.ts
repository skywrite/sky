import {
  assembleGoogleAddressComponents,
  MAP_TYPE_DIR,
  type GoogleAddressComponent,
} from '#commands/all/places/_google.ts'
import { createSecret } from '#lib/secrets/marshal.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import {
  blankPlace,
  PlaceError,
  type GooglePlaceResult,
  type MapsHost,
  type PlaceFields,
  type PlaceKind,
} from './types.ts'

interface GooglePlace {
  id: string
  displayName?: { text: string }
  formattedAddress?: string
  location?: { latitude: number; longitude: number }
  types?: string[]
  primaryType?: string
  websiteUri?: string
  googleMapsUri?: string
  addressComponents?: Array<{ longText: string; shortText: string; types: string[] }>
  attributions?: Array<{ provider: string; providerUri: string }>
}
interface LegacyPlace {
  place_id: string
  name?: string
  formatted_address?: string
  types?: string[]
  website?: string
  url?: string
  geometry?: { location: { lat: number; lng: number } }
  address_components?: GoogleAddressComponent[]
}
const geography = (types: string[]): PlaceKind => {
  if (types.includes('country')) return 'country'
  if (types.includes('administrative_area_level_1')) return 'region'
  if (types.includes('locality') || types.includes('postal_town')) return 'city'
  if (types.includes('neighborhood') || types.some((type) => type.startsWith('sublocality'))) return 'neighborhood'
  return 'venue'
}
function result(place: GooglePlace): GooglePlaceResult {
  const types = [place.primaryType, ...(place.types ?? [])].filter((type): type is string => Boolean(type))
  const categories = MAP_TYPE_DIR as Record<string, string>
  const category = types.map((type) => categories[type]).find(Boolean) || 'visit'
  return {
    id: place.id,
    name: place.displayName?.text ?? '',
    address: place.formattedAddress ?? '',
    kind: geography(types),
    category,
    coordinates: place.location ?? null,
    attributions: (place.attributions ?? [])
      .filter((item) => /^https?:\/\//.test(item.providerUri))
      .map((item) => ({ name: item.provider, uri: item.providerUri })),
  }
}
function legacyPlace(place: LegacyPlace): GooglePlace {
  return {
    id: place.place_id,
    displayName: { text: place.name ?? '' },
    formattedAddress: place.formatted_address,
    types: place.types,
    location: place.geometry
      ? { latitude: place.geometry.location.lat, longitude: place.geometry.location.lng }
      : undefined,
    googleMapsUri: place.url,
    websiteUri: place.website,
    addressComponents: place.address_components?.map((item) => ({
      longText: item.long_name,
      shortText: item.short_name,
      types: item.types,
    })),
  }
}
function draft(place: GooglePlace): PlaceFields {
  const row = result(place)
  const address = assembleGoogleAddressComponents(
    (place.addressComponents ?? []).map((item) => ({
      long_name: item.longText,
      short_name: item.shortText,
      types: item.types,
    })),
  )
  return {
    ...blankPlace(),
    name: row.name,
    kind: row.kind,
    category: row.category,
    address: row.address,
    coordinates: row.coordinates,
    site: place.websiteUri ?? '',
    googleMapsUrl: place.googleMapsUri ?? '',
    googlePlaceId: place.id,
    country: address.country,
    region: address.state,
    city: address.city,
    subcity: address.subcity,
  }
}

/** Reuse Sky's shared Maps key; explicitly server-only keychain entries stay private. */
export function createMapsHost(
  env: Record<string, string | undefined>,
  secrets: SecretsProvider,
  request: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): MapsHost {
  const category = 'google-maps'
  const envBrowserKey = env.GOOGLE_MAPS_BROWSER_KEY || env.GOOGLE_MAPS_KEY || ''
  async function settings() {
    const names = new Set((await secrets.list(category)).map((item) => item.name))
    const read = async (name: string) => {
      if (!names.has(name)) return ''
      const entry = await secrets.get(category, name)
      return entry?.type === 'secret' ? entry.val : ''
    }
    const [browserKey, serverKey, mapId] = await Promise.all([read('browser'), read('server'), read('map-id')])
    return {
      browserKey: browserKey || envBrowserKey,
      serverKey: serverKey || env.GOOGLE_MAPS_KEY || '',
      mapId: mapId || env.GOOGLE_MAPS_MAP_ID || '',
    }
  }
  async function config() {
    try {
      const value = await settings()
      return {
        browserKey: value.browserKey,
        mapId: value.mapId,
        searchAvailable: Boolean(value.serverKey),
        configurable: true,
      }
    } catch {
      return {
        browserKey: envBrowserKey,
        mapId: env.GOOGLE_MAPS_MAP_ID || '',
        searchAvailable: Boolean(env.GOOGLE_MAPS_KEY),
        configurable: true,
        message: 'Sky could not read the Maps keys from Keychain. Manage key access in Settings → Connections.',
      }
    }
  }
  async function key() {
    const value = await settings().catch(() => ({ serverKey: env.GOOGLE_MAPS_KEY || '' }))
    if (!value.serverKey) throw new PlaceError('Connect Google Places to search, or add the place manually.', 503)
    return value.serverKey
  }
  async function legacy(apiKey: string, id?: string, query?: string): Promise<GooglePlace[]> {
    const params = new URLSearchParams({
      key: apiKey,
      ...(id
        ? { place_id: id, fields: 'place_id,name,formatted_address,geometry,address_components,types,website,url' }
        : { query: query! }),
    })
    const response = await request(
      `https://maps.googleapis.com/maps/api/place/${id ? 'details' : 'textsearch'}/json?${params}`,
      { signal: AbortSignal.timeout(15_000) },
    )
    const data = (await response.json()) as { status: string; result?: LegacyPlace; results?: LegacyPlace[] }
    if (response.ok && data.status === 'ZERO_RESULTS') return []
    if (!response.ok || data.status !== 'OK')
      throw new PlaceError(
        'Google Places could not complete this lookup. Check the Places API, billing, and restrictions on your server key in Google Cloud.',
        502,
      )
    return (id ? (data.result ? [data.result] : []) : (data.results ?? [])).map(legacyPlace)
  }
  async function lookup(id?: string, query?: string): Promise<GooglePlace[]> {
    const apiKey = await key()
    try {
      const mask = id
        ? 'id,displayName,formattedAddress,location,types,primaryType,addressComponents,websiteUri,googleMapsUri,attributions'
        : 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.attributions'
      const response = await request(
        `https://places.googleapis.com/v1/places${id ? `/${encodeURIComponent(id)}` : ':searchText'}`,
        {
          method: id ? 'GET' : 'POST',
          headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': mask, 'Content-Type': 'application/json' },
          ...(id ? {} : { body: JSON.stringify({ textQuery: query, pageSize: 8 }) }),
          signal: AbortSignal.timeout(15_000),
        },
      )
      // Existing Sky installations may only have the original Places API enabled.
      if (response.status === 403) return await legacy(apiKey, id, query)
      if (!response.ok)
        throw new PlaceError(
          response.status === 429
            ? 'Google Places reached its request limit. Try again later, or add this place manually.'
            : 'Google Places could not complete this lookup. Check your key and Places API settings in Google Cloud.',
          502,
        )
      if (id) return [(await response.json()) as GooglePlace]
      return ((await response.json()) as { places?: GooglePlace[] }).places ?? []
    } catch (error) {
      if (error instanceof PlaceError) throw error
      // Fetch errors can carry the request URL and its legacy key. Do not send those to the client.
      throw new PlaceError('Google Places did not respond. Try again, or enter the place manually.', 502)
    }
  }
  return {
    config,
    async configure(input) {
      for (const [name, value] of [
        ['browser', input.browserKey],
        ['server', input.serverKey],
        ['map-id', input.mapId],
      ] as const) {
        if (value?.trim()) await secrets.set(category, name, createSecret(value.trim()))
      }
      return config()
    },
    search: async (query) =>
      (await lookup(undefined, query)).filter((place) => place.id && place.displayName?.text).map(result),
    detail: async (id) => {
      const place = (await lookup(id))[0]
      if (!place?.id) throw new PlaceError('That Google place could not be found. Search again.', 404)
      return draft(place)
    },
  }
}
