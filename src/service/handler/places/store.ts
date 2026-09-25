import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import * as path from 'node:path'
import { isMap, parseDocument } from 'yaml'
import { withProcessLock } from '#lib/jobs/files.ts'
import { createDayFile } from '#lib/nbfs/createDayFile.ts'
import { atomicWrite, hash } from '#lib/outbox/files.ts'
import { countryPlaces } from '#lib/places/geography.ts'
import { slugify } from '#lib/string/mod.ts'
import { workstreamIdentityTime } from '#lib/workstreams/identities.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import splitYamlMarkdown from '#shared/models/Markdown/util/splitYamlMarkdown.ts'
import PlaceDocument, { normalizePlaceRef } from '#shared/models/Place/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { isPathWithinRoot, isPathWithinRoots } from '../markdown-preview/request.ts'
import { renderProfileNotes } from '../people/notes.ts'
import { backlinksOf } from '../vocabulary/mod.ts'
import {
  blankPlace,
  isWithinPlace,
  PlaceError,
  type PlaceConnection,
  type PlaceDetail,
  type PlaceFields,
  type PlacesOptions,
  type PlaceSummary,
  type SavePlace,
} from './types.ts'

const plain = (value: string) => value.trim().toLocaleLowerCase()
const text = (value: unknown) => (typeof value === 'string' ? value : '')
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const strings = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((v): v is string => typeof v === 'string')
function fields(doc: PlaceDocument): PlaceFields {
  const loc = doc.location
  const latitude = loc?.latitude,
    longitude = loc?.longitude
  const coordinates =
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
      ? { latitude, longitude }
      : null
  return {
    name: doc.name,
    kind: doc.kind,
    category: text(doc.type),
    aliases: doc.aliases,
    parent: doc.parent ?? '',
    address: doc.address ?? '',
    site: doc.site ?? '',
    country: text(loc?.country),
    region: text(loc?.region),
    city: text(loc?.city),
    subcity: text(loc?.subcity),
    coordinates,
    googlePlaceId: text(doc.yaml.googlePlaceId),
    googleMapsUrl: doc.googleMapsUrl ?? '',
  }
}

export function createPlacesStore(store: MarkdownStore, baseDir: string, dirs: string[], options: PlacesOptions) {
  const base = path.resolve(baseDir)
  const root = path.resolve(options.placesDir, 'locations')
  const lock = path.join(options.stateDir, 'places', hash(base).slice(0, 16), 'write.lock')
  const relative = (file: string) => path.relative(base, file).split(path.sep).join('/')
  const allowed = (file: string) =>
    isPathWithinRoot(file, base) && isPathWithinRoots(file, dirs) && isPathWithinRoot(file, options.placesDir)
  const entries = () => store.places.getEntries().filter((entry) => allowed(entry.path))
  let cache: { version: number; places: PlaceSummary[] } | undefined

  async function safeFile(file: string) {
    if (!allowed(file)) throw new PlaceError('This place is outside your notebook folders.', 403)
    let at = base
    for (const part of path.relative(base, file).split(path.sep)) {
      at = path.join(at, part)
      try {
        if ((await lstat(at)).isSymbolicLink()) throw new PlaceError('Places must be regular notebook files.', 403)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
  const find = (id: string) => {
    const entry = entries().find((entry) => relative(entry.path) === id)
    if (!entry) throw new PlaceError('This place could not be found. Reload your places.', 404)
    return entry
  }
  function index(): PlaceSummary[] {
    if (cache?.version === store.version) return cache.places
    const places: PlaceSummary[] = entries().map(({ path: file, placePath, value: doc }) => {
      const value = fields(doc)
      return {
        ...value,
        id: relative(file),
        ref: placePath,
        parentRef: value.parent,
        archived: doc.yaml.archived === true,
        locationLabel: [value.subcity, value.city, value.region, value.country].filter(Boolean).join(', '),
        connections: backlinksOf(store, base, relative(file)).filter((item) => item.type !== 'place').length,
      }
    })
    for (const place of places) {
      if (!place.parent) {
        // Legacy venues already have geographic refs. Only attach to an actual saved ancestor.
        const ancestors = places
          .filter((p) => p.kind !== 'venue' && place.ref.toLowerCase().startsWith(`${p.ref.toLowerCase()}/`))
          .sort((a, b) => b.ref.length - a.ref.length)
        const candidate = ancestors[0]
        if (candidate && store.places.findByPlacePath(candidate.ref)) place.parentRef = candidate.ref
      }
      if (!place.locationLabel && place.parentRef)
        place.locationLabel = places.find((p) => p.ref === place.parentRef)?.name ?? ''
    }
    places.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    cache = { version: store.version, places }
    return places
  }
  function resolveRef(ref: string): string {
    const entry = store.places.findByPlacePath(ref)
    if (!entry || !allowed(entry.path))
      throw new PlaceError(
        store.places.hasPlacePath(ref)
          ? 'Several records claim this place reference. Open the notebook files to resolve the conflict.'
          : 'This place could not be found.',
        404,
      )
    return relative(entry.path)
  }
  async function snapshot(id: string) {
    const { path: file } = find(id)
    await safeFile(file)
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        store.delete(file)
        throw new PlaceError('This place was moved or removed. Reload your places.', 404)
      }
      throw error
    }
    const split = splitYamlMarkdown(raw),
      yaml = parseDocument(split.yaml),
      doc = PlaceDocument.fromMarkdown(raw)
    if (yaml.errors.length || (yaml.contents && !isMap(yaml.contents)) || doc.yamlError)
      throw new PlaceError('This file has invalid frontmatter. Fix it in the notebook before editing here.', 409)
    if (find(id).value.toMarkdown() !== doc.toMarkdown()) store.set(file, raw)
    return { file, raw, yaml, body: split.markdown, doc, revision: hash(raw) }
  }
  async function detail(id: string): Promise<PlaceDetail> {
    const current = await snapshot(id)
    const all = index(),
      summary = all.find((place) => place.id === id)
    if (!summary) throw new PlaceError('This place needs a name in its frontmatter.', 409)
    const activity = backlinksOf(store, base, id).filter(
      (item) => isPathWithinRoots(path.resolve(base, item.path), dirs) && item.type !== 'place',
    )
    const people = new Map<string, PlaceConnection>()
    const connect = (file: string, type: 'person' | 'org', name: string, via: string) => {
      if (!isPathWithinRoot(file, base) || !isPathWithinRoots(file, dirs)) return
      const id = relative(file)
      if (!people.has(id))
        people.set(id, {
          id,
          type,
          name,
          via,
          href: `/${type === 'person' ? 'people' : 'orgs'}/${encodeURIComponent(id)}`,
        })
    }
    for (const item of activity) {
      const file = path.resolve(base, item.path),
        source = store.findByPath(file)
      if (item.type === 'person' || item.type === 'org')
        connect(
          file,
          item.type,
          text(source?.doc.yaml.name) || item.label,
          item.via === 'location' ? 'Located here' : 'Linked to this place',
        )
      if (!source) continue
      for (const key of ['rel', 'who', 'from', 'to', 'cc', 'org']) {
        for (const raw of strings(source.doc.yaml[key]).flatMap((value) =>
          value.split(',').map((value) => value.trim()),
        )) {
          const resolved = store.resolve(raw, { sourceFilePath: file })
          if (
            (resolved.type === 'person' || resolved.type === 'org') &&
            'path' in resolved &&
            typeof resolved.path === 'string'
          )
            connect(resolved.path, resolved.type, resolved.value.name, `Through ${item.label}`)
        }
      }
    }
    const ancestors: PlaceSummary[] = [],
      seen = new Set([plain(summary.ref)])
    let ref = summary.parentRef
    while (ref && !seen.has(plain(ref))) {
      seen.add(plain(ref))
      const parent = all.find((place) => plain(place.ref) === plain(ref))
      if (!parent) break
      ancestors.unshift(parent)
      ref = parent.parentRef
    }
    return {
      ...summary,
      revision: current.revision,
      html: renderProfileNotes(current.body),
      tags: [...current.doc.tags],
      activity,
      people: [...people.values()],
      ancestors,
      children:
        summary.kind === 'venue'
          ? []
          : all.filter((place) => !place.archived && isWithinPlace(place, summary.ref, all)),
    }
  }
  function creationTime() {
    const now = (options.now ?? fetchNowSync)()
    return options.now ? `${now.plainDateTime.toString()}:00` : workstreamIdentityTime(now.timezone)
  }
  async function replace(current: Awaited<ReturnType<typeof snapshot>>, body: string) {
    await safeFile(current.file)
    if (hash(await readFile(current.file, 'utf8')) !== current.revision)
      throw new PlaceError('This place changed while saving. Reload it before trying again.', 409)
    const content = `---\n${current.yaml.toString()}---\n${body}`
    await atomicWrite(current.file, content)
    store.set(current.file, content)
  }
  async function save(input: SavePlace): Promise<PlaceDetail> {
    return withProcessLock(lock, async () => {
      const current = input.id ? await snapshot(input.id) : null
      if (current && input.revision !== current.revision)
        throw new PlaceError(
          'This place changed since you opened it. Your draft is still here; reload the place before saving.',
          409,
        )
      const all = index(),
        previous = current ? fields(current.doc) : blankPlace()
      const self = input.id ? all.find((p) => p.id === input.id)! : null
      const parent = input.parent ? all.find((p) => p.ref === normalizePlaceRef(input.parent)) : null
      if (input.parent && (!parent || !store.places.findByPlacePath(input.parent) || parent.kind === 'venue'))
        throw new PlaceError('Choose an existing city, neighborhood, region, or country as the parent.')
      if (self && parent && (parent.id === self.id || isWithinPlace(parent, self.ref, all)))
        throw new PlaceError('A place cannot be contained by itself or one of its descendants.')
      if (input.kind === 'country' && input.parent) throw new PlaceError('A country does not need a containing place.')
      if (self && input.kind === 'venue' && all.some((p) => p.parentRef === self.ref))
        throw new PlaceError('This geography contains other places. Move them before changing it to a venue.', 409)
      if (input.googlePlaceId && all.some((p) => p.id !== input.id && p.googlePlaceId === input.googlePlaceId))
        throw new PlaceError('This Google place is already saved. Open the existing place to edit it.', 409)
      if (
        !input.allowNamesake &&
        all.some((p) => p.id !== input.id && [p.name, ...p.aliases].some((name) => plain(name) === plain(input.name)))
      )
        throw new PlaceError(
          'A place with this name already exists. Open it, or confirm this is a different place.',
          409,
        )
      const country =
        input.kind === 'country'
          ? countryPlaces().find(
              (p) =>
                (input.country && p.location?.country === input.country) ||
                [p.name, ...p.aliases].some((name) => plain(name) === plain(input.name)),
            )
          : undefined
      if (!current && country?.ref && store.places.hasPlacePath(country.ref))
        throw new PlaceError('This country already has a saved record. Open that place instead.', 409)
      const yaml = current?.yaml ?? parseDocument('')
      const set = (key: string, value: unknown) =>
        value === '' || value === undefined ? yaml.delete(key) : yaml.set(key, value)
      const aliases = [
        ...new Set([...input.aliases, ...(current && previous.name !== input.name ? [previous.name] : [])]),
      ].filter((alias) => plain(alias) !== plain(input.name))
      if (!current || previous.name !== input.name) set('name', input.name)
      if (!current || !same(previous.aliases, aliases)) {
        set('alt', aliases.length ? aliases : undefined)
        yaml.delete('names')
      }
      if (!current || previous.kind !== input.kind) set('kind', input.kind)
      if (!current || previous.category !== input.category)
        set('type', input.kind === 'venue' ? input.category : undefined)
      if (!current || previous.parent !== input.parent) set('parent', parent?.ref)
      for (const key of ['address', 'site', 'googleMapsUrl', 'googlePlaceId'] as const)
        if (!current || previous[key] !== input[key]) set(key, input[key])
      if (previous.googleMapsUrl !== input.googleMapsUrl && isMap(yaml.get('GoogleMaps')))
        yaml.deleteIn(['GoogleMaps', 'url'])
      for (const key of ['country', 'region', 'city', 'subcity'] as const) {
        const next = key === 'country' && !current && country ? country.location!.country : input[key]
        if (next !== previous[key]) {
          yaml.setIn(['location', key], next || null)
          // The legacy reader falls back to these keys. Clearing a field must not revive its old value.
          const legacyKey = { country: 'country', region: 'state', city: 'city', subcity: '' }[key]
          if (legacyKey && isMap(yaml.get('addressComponents')))
            yaml.setIn(['addressComponents', legacyKey], next || null)
        }
      }
      if (!same(previous.coordinates, input.coordinates)) {
        yaml.setIn(['location', 'latitude'], input.coordinates?.latitude ?? null)
        yaml.setIn(['location', 'longitude'], input.coordinates?.longitude ?? null)
      }
      // Keep the old reference even for legacy files on the first metadata edit.
      if (self) set('ref', self.ref)
      const time = creationTime(),
        today = time.slice(0, 10)
      set('updated', today)
      if (current) {
        await replace({ ...current, yaml }, current.body)
        return detail(input.id!)
      }
      set('created', today)
      const dir = path.join(root, time.slice(0, 4))
      await safeFile(dir)
      await mkdir(dir, { recursive: true })
      const stem = `${today}_${time.slice(11, 19).replaceAll(':', '')}_${slugify(input.name, { preserveCase: true }).slice(0, 100) || 'Place'}`
      const existing = new Set((await readdir(dir)).map(plain))
      for (let suffix = 1; suffix < 10_000; suffix++) {
        const name = `${stem}${suffix === 1 ? '' : `-${suffix}`}`
        const file = path.join(dir, `${name}.md`)
        // Countries retain the shared natural key used by CLI repair and automatic linking.
        const ref = country?.ref ?? `places/${name}`
        if (existing.has(plain(`${name}.md`)) || store.places.hasPlacePath(ref)) continue
        yaml.set('ref', ref)
        const content = `---\n${yaml.toString()}---\n\n# ${input.name}\n\n${input.notes?.trim() ?? ''}\n`
        if (!(await createDayFile(file, content))) continue
        store.set(file, content)
        return detail(relative(file))
      }
      throw new PlaceError('Could not allocate a unique place filename. Try again.', 409)
    })
  }
  async function addNote(id: string, revision: string, note: string): Promise<PlaceDetail> {
    return withProcessLock(lock, async () => {
      const current = await snapshot(id)
      if (current.revision !== revision)
        throw new PlaceError('This place changed. Reload it before adding your note.', 409)
      const today = creationTime().slice(0, 10)
      current.yaml.set('updated', today)
      await replace(current, `${current.body.trimEnd()}\n\n## ${today}\n\n${note.trim()}\n`)
      return detail(id)
    })
  }
  async function archive(id: string, revision: string, archived: boolean): Promise<PlaceDetail> {
    return withProcessLock(lock, async () => {
      const current = await snapshot(id)
      if (current.revision !== revision)
        throw new PlaceError('This place changed. Reload it before archiving or restoring it.', 409)
      current.yaml.set('archived', archived)
      current.yaml.set('updated', creationTime().slice(0, 10))
      await replace(current, current.body)
      return detail(id)
    })
  }
  return { index, resolveRef, detail, save, addNote, archive }
}
