import { normalizePlaceRef, PLACE_TYPES } from '#shared/models/Place/mod.ts'
import type PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import type { PlaceEntry } from '#shared/models/Store/PlaceStore/mod.ts'
import { countryEnding, countryPlace } from './geography.ts'

/** Countries whose state and province codes read naturally after a city: Burlington, VT, USA. */
export const REGION_CODE_COUNTRIES: ReadonlySet<string> = new Set(['US', 'CA', 'AU'])
const REGION_CODE = /^[A-Z]{2,3}$/
const COUNTRY_CODE = /^[A-Z]{2}$/

/** The closest saved geography containing a place: its explicit parent, else the nearest one in its reference. */
export function containingPlace(store: PlaceStore, entry: PlaceEntry): PlaceEntry | undefined {
  if (entry.value.parent) return store.findByPlacePath(entry.value.parent)
  const parts = entry.placePath.split('/')
  for (let end = parts.length - 1; end > 1; end--) {
    const found = store.findByPlacePath(parts.slice(0, end).join('/'))
    if (found && found.value.kind !== 'venue') return found
  }
  return undefined
}

/** A place followed by every saved place containing it, ending at its country when that is saved. */
export function placeChain(store: PlaceStore, entry: PlaceEntry): PlaceEntry[] {
  const chain = [entry]
  const seen = new Set([entry.placePath.toLowerCase()])
  for (let at = containingPlace(store, entry); at; at = containingPlace(store, at)) {
    if (seen.has(at.placePath.toLowerCase())) break
    seen.add(at.placePath.toLowerCase())
    chain.push(at)
    if (at.value.kind === 'country') break
  }
  return chain
}

/** The country a chain belongs to: its saved country, the record's own metadata, or its reference. */
export function chainCountry(chain: PlaceEntry[]): string | undefined {
  const country = chain.find((item) => item.value.kind === 'country')
  for (const candidate of [
    country?.value.location?.country,
    country?.placePath.split('/')[1],
    chain[0]!.value.location?.country,
    chain[0]!.placePath.split('/')[1],
  ]) {
    if (candidate && COUNTRY_CODE.test(candidate) && countryPlace(`places/${candidate}`)) return candidate
  }
  return undefined
}

/** A region's short code (VT, ON), when its metadata or reference carries one. */
function regionCode(entry: PlaceEntry): string | undefined {
  const code = entry.value.location?.region
  if (code && REGION_CODE.test(code)) return code
  const segment = entry.placePath.split('/').at(-1) ?? ''
  return REGION_CODE.test(segment) ? segment : undefined
}

/** Drop a part that repeats the one before it: Monaco, Monaco reads Monaco. */
function distinct(parts: string[]): string[] {
  return parts.filter((part, index) => index === 0 || part.toLowerCase() !== parts[index - 1]!.toLowerCase())
}

/** A reference with no saved record, read from its path: places/US/VT/Burlington → Burlington, VT, USA. */
function describeRef(ref: string): string {
  const country = countryPlace(ref)
  if (country) return country.name
  const [first = '', ...rest] = ref.slice('places/'.length).split('/')
  const code = COUNTRY_CODE.test(first) ? countryEnding(first) : undefined
  const parts = (code ? rest : [first, ...rest])
    .filter((segment) => !PLACE_TYPES.has(segment))
    .reverse()
    .map((segment) => segment.replace(/-/g, ' '))
  return distinct(code ? [...parts, code] : parts).join(', ')
}

/**
 * How a place reads to a person: its name, the places containing it, then its country —
 * `Burlington, VT, USA`, `Paris, France`, `Old North End, Burlington, VT, USA`. A country reads as its
 * name. US, Canadian and Australian regions show their codes after a city; elsewhere their names.
 * Text that is not a place reference comes back trimmed, as written.
 */
export function describePlace(store: PlaceStore, raw: string): string {
  const ref = normalizePlaceRef(raw)
  if (!ref) return raw.trim()
  const entry = store.findByPlacePath(ref)
  if (!entry) return describeRef(ref)
  if (entry.value.kind === 'country') return entry.value.name
  const chain = placeChain(store, entry)
  const code = chainCountry(chain)
  const codes = !!code && REGION_CODE_COUNTRIES.has(code)
  const parts = chain
    .filter((item) => item.value.kind !== 'country')
    .map((item, index) =>
      index > 0 && codes && item.value.kind === 'region' ? (regionCode(item) ?? item.value.name) : item.value.name,
    )
  // A city filed straight under its country still knows its region from its own metadata
  const ownRegion = entry.value.location?.region
  const hasRegion = chain.some((item) => item.value.kind === 'region')
  if (codes && !hasRegion && ownRegion && REGION_CODE.test(ownRegion)) parts.push(ownRegion)
  const country = chain.find((item) => item.value.kind === 'country')
  const ending = code ? countryEnding(code) : country?.value.name
  return distinct(ending ? [...parts, ending] : parts).join(', ')
}
