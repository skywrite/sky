import { slugify } from '#lib/string/mod.ts'
import PlaceDocument, {
  COUNTRIES_WITH_REGIONS,
  normalizePlaceRef,
  type GeographicKind,
  type PlaceLocation,
} from '#shared/models/Place/mod.ts'
import type PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'
import type { PlaceEntry } from '#shared/models/Store/PlaceStore/mod.ts'
import { matchPlace, normalizePlaceName, placeChoiceForRef, placeChoices, type PlaceChoice } from './catalog.ts'
import { chainCountry, containingPlace, describePlace, placeChain } from './describe.ts'
import { countryPlace, ensurePlaceRecord } from './geography.ts'

/** A place someone can be located in, as the location picker lists it. */
export interface LocationChoice {
  ref: string
  /** How it reads: Burlington, VT, USA */
  label: string
  name: string
  aliases: string[]
  kind: GeographicKind
  /** A recognized country with no record yet; choosing it creates the record */
  needsCreation?: boolean
}

/** A geographic place found on Google Maps, with the places containing it. */
export interface FoundGeography {
  kind: GeographicKind
  name: string
  /** ISO country code */
  country: string
  /** The state or province containing it: code VT, name Vermont */
  region?: { code: string; name: string }
  /** The city containing a neighborhood or area */
  city?: string
  coordinates?: { latitude: number; longitude: number } | null
  googlePlaceId?: string
  googleMapsUrl?: string
}

export interface EnsuredLocation {
  ref: string
  /** Files written for places that had no record, outermost first */
  created: string[]
}

const geographic = (choice: PlaceChoice) => choice.kind !== 'venue'
const slug = (value: string) => slugify(value, { preserveCase: true }).slice(0, 100) || 'Place'
const sameName = (a: string, b: string) => normalizePlaceName(a) === normalizePlaceName(b)
const named = (entry: PlaceEntry, name: string) =>
  [entry.value.name, ...entry.value.aliases].some((alias) => sameName(alias, name))
const sameRef = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Every saved geography and every recognized country, described: what a location can be. */
export function locationChoices(store: PlaceStore): LocationChoice[] {
  return placeChoices(store)
    .filter((choice) => geographic(choice) && store.findByPlacePath(choice.ref)?.value.yaml.archived !== true)
    .map((choice) => ({
      ref: choice.ref,
      label: choice.needsCreation ? choice.name : describePlace(store, choice.ref),
      name: choice.name,
      aliases: choice.aliases,
      kind: choice.kind as GeographicKind,
      ...(choice.needsCreation ? { needsCreation: true } : {}),
    }))
}

/**
 * The one place written text names — `Burlington, VT, USA`, `Burlington, Vermont`, `France` or a place
 * reference — among saved geography and recognized countries. Undefined when several could be
 * meant or none is saved; a match is never guessed.
 */
export function matchLocation(store: PlaceStore, text: string): LocationChoice | undefined {
  const value = text.trim()
  if (!value) return undefined
  const choices = placeChoices(store).filter(geographic)
  const choice = normalizePlaceRef(value)
    ? placeChoiceForRef(value, choices)
    : choices.find((item) => item.ref === matchPlace({ name: value }, choices).ref)
  if (!choice) return undefined
  return locationChoices(store).find((item) => item.ref === choice.ref)
}

/** Whether `entry` sits inside the place `ref`, by its saved parents or by its own reference. */
function isWithin(store: PlaceStore, entry: PlaceEntry, ref: string): boolean {
  return (
    entry.placePath.toLowerCase().startsWith(`${ref.toLowerCase()}/`) ||
    placeChain(store, entry)
      .slice(1)
      .some((item) => sameRef(item.placePath, ref))
  )
}

/** A region's code from its metadata or its reference: VT for places/US/VT. */
function regionCodeOf(entry: PlaceEntry): string | undefined {
  return entry.value.location?.region || entry.placePath.split('/').at(-1)
}

/** The region a place is in, when its saved parents or its metadata say. */
function regionOf(store: PlaceStore, entry: PlaceEntry): string | undefined {
  const region = placeChain(store, entry)
    .slice(1)
    .find((item) => item.value.kind === 'region')
  return region ? regionCodeOf(region) : entry.value.location?.region
}

/** At most one of the matches, preferring a direct child of `parent`; several stay a question. */
function onlyOne(store: PlaceStore, matches: PlaceEntry[], parent: string, name: string): PlaceEntry | undefined {
  const unique = [...new Map(matches.map((entry) => [entry.path, entry])).values()]
  if (unique.length <= 1) return unique[0]
  const direct = unique.filter((entry) => sameRef(containingPlace(store, entry)?.placePath ?? '', parent))
  if (direct.length === 1) return direct[0]
  throw new Error(
    `More than one saved place could be ${name}: ${unique.map((entry) => entry.placePath).join(', ')}. Rename or archive one in Places, then try again.`,
  )
}

/** Geographic metadata with only the parts that are known; none without a country. */
function locationOf(value: Partial<PlaceLocation>): PlaceLocation | undefined {
  if (!value.country) return undefined
  const location: PlaceLocation = { country: value.country }
  for (const key of ['region', 'city', 'subcity'] as const) if (value[key]) location[key] = value[key]
  for (const key of ['latitude', 'longitude'] as const) if (typeof value[key] === 'number') location[key] = value[key]
  return location
}

/** Write a new geographic record once; a reference another record already holds is never reused. */
async function createGeography(
  store: PlaceStore,
  placesDir: string,
  input: {
    name: string
    ref: string
    kind: GeographicKind
    parent?: string
    location?: PlaceLocation
    googlePlaceId?: string
    googleMapsUrl?: string
  },
  today: string,
  created: string[],
): Promise<PlaceEntry> {
  if (store.hasPlacePath(input.ref))
    throw new Error(
      `${input.ref} already belongs to another saved place. Open it in Places to check it, then try again.`,
    )
  const doc = PlaceDocument.createGeographic(input)
  if (input.googleMapsUrl) doc.yaml.googleMapsUrl = input.googleMapsUrl
  if (input.googlePlaceId) doc.yaml.googlePlaceId = input.googlePlaceId
  doc.yaml.created = today
  doc.yaml.updated = today
  const saved = await ensurePlaceRecord(store, placesDir, doc)
  if (saved.created) created.push(saved.filePath)
  return store.findByPlacePath(saved.ref)!
}

/** A recognized country's record, created the first time it is needed. */
async function countryEntry(
  store: PlaceStore,
  placesDir: string,
  code: string,
  today: string,
  created: string[],
): Promise<PlaceEntry> {
  const country = countryPlace(`places/${code}`)
  if (!country) throw new Error(`Sky does not recognize the country code ${code}.`)
  const existing = store.findByPlacePath(country.ref!)
  if (existing) return existing
  country.yaml.created = today
  country.yaml.updated = today
  const saved = await ensurePlaceRecord(store, placesDir, country)
  if (saved.created) created.push(saved.filePath)
  return store.findByPlacePath(saved.ref)!
}

/**
 * Save a place found on Google Maps with the places containing it, reusing every record that
 * already exists: a city gets its country and, in the US, Canada, Australia, the UK and New
 * Zealand, its state or province — places/US/VT/Burlington inside places/US/VT inside places/US.
 * Only the chosen place carries Google's coordinates and identifiers.
 */
export async function ensureGeography(
  store: PlaceStore,
  placesDir: string,
  found: FoundGeography,
  today: string,
): Promise<EnsuredLocation> {
  const created: string[] = []
  const chosen = (kind: GeographicKind) =>
    found.kind === kind
      ? {
          googlePlaceId: found.googlePlaceId || undefined,
          googleMapsUrl: found.googleMapsUrl || undefined,
          latitude: found.coordinates?.latitude,
          longitude: found.coordinates?.longitude,
        }
      : {}
  const sameGoogle = (entry: PlaceEntry, kind: GeographicKind) =>
    found.kind === kind && !!found.googlePlaceId && entry.value.yaml.googlePlaceId === found.googlePlaceId
  const write = async (
    kind: GeographicKind,
    name: string,
    ref: string,
    parent: string,
    location: Partial<PlaceLocation>,
  ) => {
    const { googlePlaceId, googleMapsUrl, latitude, longitude } = chosen(kind)
    return createGeography(
      store,
      placesDir,
      {
        name,
        ref,
        kind,
        parent,
        location: locationOf({ ...location, latitude, longitude }),
        googlePlaceId,
        googleMapsUrl,
      },
      today,
      created,
    )
  }

  const country = await countryEntry(store, placesDir, found.country, today, created)
  if (found.kind === 'country') return { ref: country.placePath, created }
  let parent = country.placePath

  const region = found.kind === 'region' ? { code: found.region?.code ?? '', name: found.name } : found.region
  const regionCode = region && COUNTRIES_WITH_REGIONS.has(found.country) ? region.code : undefined
  if (region && (found.kind === 'region' || regionCode)) {
    const ref = `${parent}/${regionCode && /^[A-Za-z0-9]{1,12}$/.test(regionCode) ? regionCode : slug(region.name)}`
    const existing = onlyOne(
      store,
      store
        .getEntries()
        .filter(
          (entry) =>
            entry.value.kind === 'region' &&
            isWithin(store, entry, country.placePath) &&
            (sameRef(entry.placePath, ref) ||
              (!!region.code && regionCodeOf(entry) === region.code) ||
              named(entry, region.name) ||
              sameGoogle(entry, 'region')),
        ),
      parent,
      region.name,
    )
    const entry =
      existing ??
      (await write('region', region.name, ref, parent, { country: found.country, region: region.code || undefined }))
    if (found.kind === 'region') return { ref: entry.placePath, created }
    parent = entry.placePath
  }

  const cityName = found.kind === 'city' ? found.name : found.city
  if (cityName) {
    const ref = `${parent}/${slug(cityName)}`
    const existing = onlyOne(
      store,
      store.getEntries().filter((entry) => {
        if (entry.value.kind !== 'city' || !isWithin(store, entry, country.placePath)) return false
        if (!sameRef(entry.placePath, ref) && !named(entry, cityName) && !sameGoogle(entry, 'city')) return false
        // A namesake in another state is a different city; one with no known state may be this one
        const theirs = regionOf(store, entry)
        return !theirs || !region?.code || theirs.toLowerCase() === region.code.toLowerCase()
      }),
      parent,
      cityName,
    )
    const entry =
      existing ??
      (await write('city', cityName, ref, parent, {
        country: found.country,
        region: regionCode,
        city: cityName,
      }))
    if (found.kind === 'city') return { ref: entry.placePath, created }
    parent = entry.placePath
  }

  const ref = `${parent}/${slug(found.name)}`
  const existing = onlyOne(
    store,
    store
      .getEntries()
      .filter(
        (entry) =>
          (entry.value.kind === 'neighborhood' || entry.value.kind === 'area') &&
          isWithin(store, entry, parent) &&
          (sameRef(entry.placePath, ref) || named(entry, found.name) || sameGoogle(entry, found.kind)),
      ),
    parent,
    found.name,
  )
  const entry =
    existing ??
    (await write(found.kind, found.name, ref, parent, {
      country: found.country,
      region: regionCode,
      city: cityName,
      subcity: found.kind === 'neighborhood' ? found.name : undefined,
    }))
  return { ref: entry.placePath, created }
}

/**
 * A city typed by hand, inside a saved place or a recognized country: for notebooks without
 * Google Maps. An existing city of that name there is reused; a country is created when needed.
 */
export async function ensureCityIn(
  store: PlaceStore,
  placesDir: string,
  name: string,
  inside: string,
  today: string,
): Promise<EnsuredLocation> {
  const created: string[] = []
  const value = name.trim()
  if (!value) throw new Error('Type the name of the city.')
  const country = countryPlace(inside)
  const parent = country
    ? await countryEntry(store, placesDir, country.location!.country, today, created)
    : store.findByPlacePath(inside)
  if (!parent || parent.value.kind === 'venue') throw new Error('Choose the country, region, or area this city is in.')
  const ref = `${parent.placePath}/${slug(value)}`
  const existing = onlyOne(
    store,
    store
      .getEntries()
      .filter(
        (entry) =>
          entry.value.kind !== 'venue' &&
          sameRef(containingPlace(store, entry)?.placePath ?? '', parent.placePath) &&
          (sameRef(entry.placePath, ref) || named(entry, value)),
      ),
    parent.placePath,
    value,
  )
  if (existing) return { ref: existing.placePath, created }
  const chain = placeChain(store, parent)
  const region = chain.find((item) => item.value.kind === 'region')
  const entry = await createGeography(
    store,
    placesDir,
    {
      name: value,
      ref,
      kind: 'city',
      parent: parent.placePath,
      location: locationOf({
        country: chainCountry(chain),
        region: region ? regionCodeOf(region) : undefined,
        city: value,
      }),
    },
    today,
    created,
  )
  return { ref: entry.placePath, created }
}

/**
 * Every place written text could mean — a name, another name, or a reference — for a search:
 * namesakes are all included rather than guessed between. Each comes with every reference it
 * answers to, so a link written another way still counts.
 */
export function placesNamed(store: PlaceStore, text: string): string[] {
  const value = text.trim()
  if (!value) return []
  const choices = placeChoices(store).filter(geographic)
  const named = normalizePlaceRef(value)
    ? [placeChoiceForRef(value, choices)].filter((choice): choice is PlaceChoice => !!choice)
    : matchPlace({ name: value }, choices).candidates
  return [...new Set(named.flatMap((choice) => [choice.ref, ...choice.refs]))]
}

/** Whether a location — a place reference — is one of `places`, or a place inside one of them. */
export function isLocatedIn(store: PlaceStore, location: unknown, places: readonly string[]): boolean {
  const ref = typeof location === 'string' ? normalizePlaceRef(location) : undefined
  if (!ref || places.length === 0) return false
  const wanted = places.map((place) => place.toLowerCase())
  const entry = store.findByPlacePath(ref)
  const chain = entry ? placeChain(store, entry).flatMap((item) => [item.placePath, ...item.value.refAliases]) : [ref]
  if (chain.some((item) => wanted.includes(item.toLowerCase()))) return true
  // A link to a place with no record is still inside the places its path names
  return wanted.some((place) => ref.toLowerCase().startsWith(`${place}/`))
}
