// Resolve Google Maps share links (and full map URLs) to coordinates.
//
// Short links like https://maps.app.goo.gl/XXXX redirect to a canonical maps
// URL that encodes the coordinates. We follow the redirect and parse them out.
// No API key is required for this step.

export interface MapsCoords {
  latitude: number
  longitude: number
}

// Tried in order, most precise first. The viewport center (@lat,lng) is the
// least precise, so it comes after the pin (!3d!4d) and dropped-pin (/search/).
const COORD_PATTERNS: RegExp[] = [
  // Dropped pin / shared coordinates: /maps/search/48.85837,+2.294481
  /\/search\/(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/,
  // Named place pin: ...!3d48.85837!4d2.294481
  /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
  // Viewport center (approximate): /@48.85837,2.294481,17z
  /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
  // Query params: ?q=48.85837,2.294481  &query=  &ll=  &center=  &destination=  &daddr=
  /[?&](?:q|query|ll|center|destination|daddr)=(-?\d+(?:\.\d+)?),\s*\+?(-?\d+(?:\.\d+)?)/,
]

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Parse coordinates out of an (already-expanded) Google Maps URL.
 * Returns null when no coordinates are present.
 */
export function parseCoordsFromMapsUrl(rawUrl: string): MapsCoords | null {
  const url = safeDecode(rawUrl)
  for (const pattern of COORD_PATTERNS) {
    const match = url.match(pattern)
    if (!match) continue
    const latitude = Number.parseFloat(match[1])
    const longitude = Number.parseFloat(match[2])
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude }
    }
  }
  return null
}

/**
 * Resolve a Google Maps link to coordinates by following its redirect to the
 * canonical URL, then parsing the coordinates from it. Falls back to parsing
 * the original URL (in case it already contains coordinates and isn't a short
 * link). Returns null when coordinates can't be determined.
 */
export async function resolveMapsUrlToCoords(url: string): Promise<MapsCoords | null> {
  let finalUrl = url
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    })
    finalUrl = res.url || url
  } catch {
    // Network failure — fall back to parsing the URL as given.
  }
  return parseCoordsFromMapsUrl(finalUrl) ?? parseCoordsFromMapsUrl(url)
}
