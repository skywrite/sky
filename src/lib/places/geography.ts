import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import PlaceDocument, { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import type PlaceStore from '#shared/models/Store/PlaceStore/mod.ts'

const countryNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
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
  return PlaceDocument.createGeographic({ name, ref: ref!, kind: 'country', location: { country: code } })
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
