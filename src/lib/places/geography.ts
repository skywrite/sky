import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import PlaceDocument, { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import type PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'

const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
const shortCountryNames = new Intl.DisplayNames(['en'], { type: 'region', style: 'short', fallback: 'none' })
// CLDR macroregions, deprecated codes, pseudo-locales and the UK alias are not
// country identities. Names for recognized countries/territories come from ICU.
// https://github.com/unicode-org/cldr/blob/main/common/validity/region.xml
const EXCLUDED_CODES = new Set('AN BU CS DD FX NT QU SU TP YD YU ZR EU EZ QO UN XA XB ZZ UK'.split(' '))

/** Only an explicit, recognized country/territory code can create a record automatically. */
export function countryPlace(raw: string): PlaceDocument | undefined {
  const ref = normalizePlaceRef(raw)
  const code = ref?.match(/^places\/([A-Z]{2})$/)?.[1]
  if (!code || EXCLUDED_CODES.has(code)) return undefined
  const name = countryNames.of(code)
  if (!name || name === code) return undefined
  const aliases = [...new Set([code, shortCountryNames.of(code), ...(COUNTRY_ALIASES[code] ?? [])])].filter(
    (alias): alias is string => !!alias && alias !== name,
  )
  return PlaceDocument.createGeographic({ name, aliases, ref: ref!, kind: 'country', location: { country: code } })
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  US: ['USA', 'U.S.', 'U.S.A.', 'United States of America'],
  GB: ['UK', 'U.K.', 'United Kingdom'],
}

let countries: PlaceDocument[] | undefined

/** Runtime country names are lookup candidates; enumerating them never writes files. */
export function countryPlaces(): readonly PlaceDocument[] {
  if (!countries) {
    countries = []
    for (const first of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      for (const second of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        const country = countryPlace(`places/${first}${second}`)
        if (country) countries.push(country)
      }
    }
  }
  return countries
}

/** Materialize only a selected country; other references must already have a unique record. */
export async function ensurePlaceRef(store: PlaceStore, raw: string): Promise<EnsuredPlace> {
  const ref = normalizePlaceRef(raw)
  if (!ref) throw new Error('Choose a valid place reference.')
  const existing = store.findByPlacePath(ref)
  if (existing) {
    try {
      store.set(existing.path, await readFile(existing.path, 'utf8'))
      const current = store.findByPlacePath(ref)
      if (!current) throw new Error('The selected place no longer has an unambiguous identity.')
      return { ref: current.placePath, filePath: current.path, name: current.value.name, created: false }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      store.delete(existing.path)
    }
  }
  const country = countryPlace(ref)
  if (!country || !store.directory) throw new Error('This place needs an existing record with a confirmed identity.')
  return ensurePlaceRecord(store, store.directory, country)
}

export interface EnsuredPlace {
  ref: string
  filePath: string
  name: string
  created: boolean
}

/** Create once, preserving an existing record's metadata and prose byte for byte. */
export async function ensurePlaceRecord(
  store: PlaceStore,
  placesDir: string,
  doc: PlaceDocument,
): Promise<EnsuredPlace> {
  const ref = doc.ref
  if (!ref) throw new Error('A new place needs an explicit places/ reference.')
  const existing = store.findByPlacePath(ref)
  if (existing) return { ref: existing.placePath, filePath: existing.path, name: existing.value.name, created: false }
  if (store.hasPlacePath(ref)) throw new Error(`Several records claim ${ref}. Resolve that conflict first.`)

  const root = path.resolve(placesDir, 'locations')
  const filePath = path.join(root, `${doc.toFilePath()}.md`)
  await mkdir(path.dirname(filePath), { recursive: true })
  const actualRoot = await realpath(root)
  const relative = path.relative(actualRoot, await realpath(path.dirname(filePath)))
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Place destination is outside the locations directory.')
  let created = false
  try {
    await writeFile(filePath, doc.toMarkdown(), { flag: 'wx' })
    created = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  store.set(filePath, await readFile(filePath, 'utf8'))
  const saved = store.findByPlacePath(ref)
  if (!saved) throw new Error(`An existing file prevents creating ${ref}. Its contents have been preserved.`)
  return { ref: saved.placePath, filePath: saved.path, name: saved.value.name, created }
}
