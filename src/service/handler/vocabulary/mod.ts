/**
 * What the front matter panel completes from: the notebook's people, orgs, projects, places and
 * documents by name; its tags with counts; and, per top-level directory, the keys in use and the
 * values a key already has. Built once per store version, matched per request.
 */

import type Document from '#shared/models/Markdown/Document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import type { OrgScore, PersonScore, TagScore } from '../../scoring/ScoringStore.ts'
import { toNotebookRelativePath } from '../markdown-preview/request.ts'

export type EntityType = 'person' | 'org' | 'project' | 'place' | 'library' | 'day'
export type CompletionKind = 'people' | 'orgs' | 'projects' | 'places' | 'library' | 'rel' | 'tags' | 'values' | 'keys'

export const COMPLETION_KINDS: ReadonlySet<string> = new Set([
  'people',
  'orgs',
  'projects',
  'places',
  'library',
  'rel',
  'tags',
  'values',
  'keys',
])

export interface Completion {
  /** What goes into the document */
  value: string
  /** What to show when it differs from the value — a document's title for a path */
  label?: string
  type: EntityType | 'tag' | 'value' | 'key'
  /** The document's notebook-relative path, for entities */
  path?: string
  /** A second line: the org for a person, the status for a project, the directory for a document */
  hint?: string
  count?: number
}

export interface CompletionRequest {
  kind: CompletionKind
  query: string
  /** For `values`: the front matter key */
  key?: string
  /** For `keys` and `values`: the document's top-level directory */
  dir?: string
  limit?: number
}

interface Entity {
  type: EntityType
  value: string
  label?: string
  aliases: string[]
  path: string
  hint?: string
  /** A day document's day, for ordering newest first */
  date?: string
  /** A project still open — ahead of closed ones */
  open?: boolean
}

/** The notebook's interaction scores — what the VS Code extension orders its completions by — keyed by lowercased name. */
export interface Scores {
  people: Map<string, PersonScore>
  orgs: Map<string, OrgScore>
  tags: Map<string, TagScore>
}

export function scoresFrom(people: PersonScore[], orgs: OrgScore[], tags: TagScore[]): Scores {
  const byName = <T extends { name: string }>(items: T[]) =>
    new Map(items.map((item) => [item.name.toLowerCase(), item]))
  return { people: byName(people), orgs: byName(orgs), tags: byName(tags) }
}

const CLOSED_STATUSES = new Set(['closed', 'done', 'archived', 'cancelled', 'canceled'])

/** Days since the civil epoch for a calendar date — plain arithmetic, no clock. */
function epochDays(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year
  const era = Math.floor(y / 400)
  const yoe = y - era * 400
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
}

function daysBetween(from: string, to: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(from)
  const b = /^(\d{4})-(\d{2})-(\d{2})/.exec(to)
  if (!a || !b) return null
  return epochDays(Number(b[1]), Number(b[2]), Number(b[3])) - epochDays(Number(a[1]), Number(a[2]), Number(a[3]))
}

/** How long ago a day was, in words: today, yesterday, N days, N weeks, N months, N years. */
export function ago(iso: string, today: string): string {
  const days = daysBetween(iso, today)
  if (days === null) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  if (days < 60) return `${Math.round(days / 7)} weeks ago`
  if (days < 365) return `${Math.round(days / 30)} months ago`
  const years = Math.round(days / 365)
  return years === 1 ? 'a year ago' : `${years} years ago`
}

export interface Vocabulary {
  version: number
  entities: Entity[]
  tags: Map<string, number>
  /** dir → key → documents carrying it */
  keys: Map<string, Map<string, number>>
  /** `${dir}\n${key}` → scalar value → documents carrying it */
  values: Map<string, Map<string, number>>
}

const ENTITY_ORDER: Record<EntityType, number> = { person: 0, project: 1, org: 2, place: 3, library: 4, day: 5 }
const DEFAULT_LIMIT = 20

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function asStrings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim().length > 0 ? [value.trim()] : []
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string').map((s) => s.trim())
  return []
}

/** A document with every name the store answers to for it. */
interface Profile {
  /** Absolute path */
  path: string
  doc: Document
  /** As indexed: lowercased and trimmed */
  names: string[]
}

/**
 * Each document once, with every name the store indexes for it. The stores key by name, so a
 * person with an `alt:` — or a `name:` list — is found under each of them; the panel wants the
 * person once, answering to all of them.
 */
function profilesOf(s: {
  names: string[]
  find(name: string): { value: Document; path: string } | undefined
}): Profile[] {
  const byPath = new Map<string, Profile>()
  for (const name of s.names) {
    const hit = s.find(name)
    if (!hit) continue
    const profile = byPath.get(hit.path)
    if (profile) profile.names.push(name)
    else byPath.set(hit.path, { path: hit.path, doc: hit.value, names: [name] })
  }
  return [...byPath.values()]
}

/**
 * The other names a document answers to — `alt:` and `names:` as written, then whatever else
 * the store indexes — each once, the display name left out.
 */
function aliasesOf(display: string, doc: Document, indexed: string[]): string[] {
  const seen = new Set([plain(display)])
  const aliases: string[] = []
  for (const alias of [...asStrings(doc.yaml['alt']), ...asStrings(doc.yaml['names']), ...indexed]) {
    const key = plain(alias)
    if (key.length === 0 || seen.has(key)) continue
    seen.add(key)
    aliases.push(alias)
  }
  return aliases
}

/** Every document the store holds, once, with its notebook-relative path and top-level directory. */
function documentsOf(store: MarkdownStore, base: string): Array<{ path: string; dir: string; doc: Document }> {
  const out: Array<{ path: string; dir: string; doc: Document }> = []
  const add = (absolute: string, doc: Document | undefined) => {
    if (!doc) return
    const path = toNotebookRelativePath(base, absolute)
    out.push({ path, dir: path.split('/')[0] ?? '', doc })
  }
  for (const s of [store.people, store.orgs, store.projects, store.places]) {
    for (const { path, doc } of profilesOf(s)) add(path, doc)
  }
  for (const s of [store.library, store.time, store.ai]) {
    for (const absolute of s.paths) add(absolute, s.findByPath(absolute))
  }
  return out
}

/** The tags of a document as written: one line, `;`-separated (a few older files use commas). */
function tagsOf(doc: Document): string[] {
  const raw = doc.yaml['tags']
  if (Array.isArray(raw)) return asStrings(raw)
  const line = asString(raw)
  if (!line) return []
  return line
    .split(line.includes(';') ? ';' : ',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

/** The name a document shows: `name:` as written (the store's lookup keys are normalized). */
function displayName(doc: Document, fallback: string): string {
  const raw = doc.yaml['name']
  return asString(raw) ?? asStrings(raw)[0] ?? fallback
}

function stem(path: string): string {
  const name = path.split('/').pop() ?? path
  return name.replace(/\.md$/i, '')
}

function entityOf(type: EntityType, value: string, path: string, doc: Document, aliases: string[] = []): Entity {
  const yaml = doc.yaml
  let hint: string | undefined
  switch (type) {
    case 'person':
      hint = [asString(yaml['title']), asString(yaml['org'])].filter((s): s is string => s !== undefined).join(' · ')
      break
    case 'org':
      hint = asString(yaml['sector'])
      break
    case 'project':
      hint = asString(yaml['status'])
      break
    default:
      hint = path.split('/').slice(0, -1).join('/')
  }
  return { type, value, aliases, path, hint: hint || undefined }
}

export function buildVocabulary(store: MarkdownStore, base: string): Vocabulary {
  const entities: Entity[] = []
  const tags = new Map<string, number>()
  const keys = new Map<string, Map<string, number>>()
  const values = new Map<string, Map<string, number>>()
  const count = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1)

  const named = (type: EntityType, { path, doc, names }: Profile): Entity => {
    const display = displayName(doc, names[0] ?? stem(path))
    return entityOf(type, display, toNotebookRelativePath(base, path), doc, aliasesOf(display, doc, names))
  }
  for (const profile of profilesOf(store.people)) entities.push(named('person', profile))
  for (const profile of profilesOf(store.orgs)) entities.push(named('org', profile))
  for (const profile of profilesOf(store.projects)) {
    const entity = named('project', profile)
    entity.open = !CLOSED_STATUSES.has((asString(profile.doc.yaml['status']) ?? '').toLowerCase())
    entities.push(entity)
  }
  for (const profile of profilesOf(store.places)) entities.push(named('place', profile))
  for (const [type, s] of [
    ['library', store.library],
    ['day', store.time],
  ] as const) {
    for (const absolute of s.paths) {
      const doc = s.findByPath(absolute)
      if (!doc) continue
      const path = toNotebookRelativePath(base, absolute)
      const title = asString(doc.yaml['title']) ?? asString(doc.yaml['name'])
      const entity = entityOf(type, path.replace(/\.md$/i, ''), path, doc)
      if (title) entity.label = title
      entity.aliases = [stem(path), ...(title ? [title] : [])]
      if (type === 'day') entity.date = parseTimePath(path)?.start.toString()
      entities.push(entity)
    }
  }

  for (const { dir, doc } of documentsOf(store, base)) {
    for (const tag of tagsOf(doc)) count(tags, tag)
    const dirKeys = keys.get(dir) ?? new Map<string, number>()
    keys.set(dir, dirKeys)
    for (const [key, raw] of Object.entries(doc.yaml)) {
      count(dirKeys, key)
      const value = asString(raw)
      if (value === undefined || value.length > 80 || key === 'tags') continue
      const id = `${dir}\n${key}`
      const keyValues = values.get(id) ?? new Map<string, number>()
      values.set(id, keyValues)
      count(keyValues, value)
    }
  }
  return { version: store.version, entities, tags, keys, values }
}

const cache = new WeakMap<MarkdownStore, Vocabulary>()

/** The vocabulary for the store as it is now — rebuilt when the store's version moved. */
export function vocabularyOf(store: MarkdownStore, base: string): Vocabulary {
  const cached = cache.get(store)
  if (cached && cached.version === store.version) return cached
  const built = buildVocabulary(store, base)
  cache.set(store, built)
  return built
}

/**
 * How well a candidate answers a query: 0 exact, 1 prefix, 2 a word's prefix, 3 substring,
 * 4 the letters in order; null when it does not match. An empty query matches everything.
 */
export function matchScore(query: string, candidate: string): number | null {
  const q = plain(query)
  if (q.length === 0) return 3
  const c = plain(candidate)
  if (c === q) return 0
  if (c.startsWith(q)) return 1
  if (c.split(/[\s\-_/.,()]+/).some((word) => word.startsWith(q))) return 2
  if (c.includes(q)) return 3
  let i = 0
  for (const ch of c) if (ch === q[i]) i++
  return i === q.length ? 4 : null
}

/** Lowercased, with dashes, underscores and runs of spaces read as one space — so "weekly sync" finds Weekly-Sync. */
function plain(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
}

function best(query: string, candidates: string[]): number | null {
  let bestScore: number | null = null
  for (const candidate of candidates) {
    const score = matchScore(query, candidate)
    if (score !== null && (bestScore === null || score < bestScore)) bestScore = score
  }
  return bestScore
}

function ranked<T>(
  items: T[],
  scoreOf: (item: T) => number | null,
  tieBreak: (a: T, b: T) => number,
  limit: number,
): T[] {
  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const score = scoreOf(item)
    if (score !== null) scored.push({ item, score })
  }
  scored.sort((a, b) => a.score - b.score || tieBreak(a.item, b.item))
  return scored.slice(0, limit).map((s) => s.item)
}

const KINDS_TO_TYPES: Partial<Record<CompletionKind, EntityType[]>> = {
  people: ['person'],
  orgs: ['org'],
  projects: ['project'],
  places: ['place'],
  library: ['library'],
  rel: ['person', 'project', 'org', 'place', 'library', 'day'],
}

/**
 * The completions for a request, best first: by how the query sits in the name, then — like the
 * VS Code extension — by the notebook's interaction score, then by recency; day documents newest
 * first, open projects before closed ones, people before projects, orgs, places and documents.
 */
export function complete(
  vocabulary: Vocabulary,
  request: CompletionRequest,
  scores?: Scores,
  today?: string,
): Completion[] {
  const limit = request.limit ?? DEFAULT_LIMIT
  const query = request.query
  const tagScore = (name: string) => scores?.tags.get(name.toLowerCase())?.score ?? 0
  const byCount = (a: [string, number], b: [string, number]) =>
    tagScore(b[0]) - tagScore(a[0]) || b[1] - a[1] || a[0].localeCompare(b[0])
  const counted = (map: Map<string, number>, type: 'tag' | 'value' | 'key'): Completion[] =>
    ranked([...map.entries()], ([value]) => matchScore(query, value), byCount, limit).map(([value, count]) => ({
      value,
      type,
      count,
    }))

  if (request.kind === 'tags') return counted(vocabulary.tags, 'tag')
  if (request.kind === 'keys') return counted(vocabulary.keys.get(request.dir ?? '') ?? new Map(), 'key')
  if (request.kind === 'values') {
    return counted(vocabulary.values.get(`${request.dir ?? ''}\n${request.key ?? ''}`) ?? new Map(), 'value')
  }
  const types = KINDS_TO_TYPES[request.kind]
  if (!types) return []
  const pool = vocabulary.entities.filter((entity) => types.includes(entity.type))
  const scoreOf = (entity: Entity): { score: number; last: string } => {
    const hit =
      entity.type === 'person'
        ? scores?.people.get(entity.value.toLowerCase())
        : entity.type === 'org'
          ? scores?.orgs.get(entity.value.toLowerCase())
          : undefined
    return { score: hit?.score ?? 0, last: hit?.lastInteraction ?? '' }
  }
  const chosen = ranked(
    pool,
    (entity) => best(query, [entity.value, ...(entity.label ? [entity.label] : []), ...entity.aliases]),
    (a, b) => {
      const sa = scoreOf(a)
      const sb = scoreOf(b)
      return (
        sb.score - sa.score ||
        sb.last.localeCompare(sa.last) ||
        (b.date ?? '').localeCompare(a.date ?? '') ||
        Number(b.open ?? false) - Number(a.open ?? false) ||
        ENTITY_ORDER[a.type] - ENTITY_ORDER[b.type] ||
        (a.label ?? a.value).localeCompare(b.label ?? b.value)
      )
    },
    limit,
  )
  return chosen.map((entity) => {
    const completion: Completion = { value: entity.value, type: entity.type, path: entity.path }
    if (entity.label) completion.label = entity.label
    const { last } = scoreOf(entity)
    const recency = last && today ? ago(last, today) : ''
    const hint = [entity.hint, recency].filter((part) => part && part.length > 0).join(' · ')
    if (hint) completion.hint = hint
    return completion
  })
}

/** The type a resolved reference reads as in the panel. */
function typeOfResolved(type: string, path: string): EntityType | null {
  switch (type) {
    case 'person':
    case 'org':
    case 'project':
    case 'place':
      return type
    case 'document':
      return path.startsWith('time/') ? 'day' : 'library'
    default:
      return null
  }
}

/** Where each name points, for the chips of a document: null when the notebook has no such thing. */
export function resolveNames(
  store: MarkdownStore,
  base: string,
  names: string[],
  sourcePath?: string,
): Record<string, { type: EntityType; path: string } | null> {
  const out: Record<string, { type: EntityType; path: string } | null> = {}
  for (const name of names) {
    const ref = store.resolve(name, sourcePath ? { sourceFilePath: sourcePath } : undefined)
    if (!('path' in ref) || typeof ref.path !== 'string') {
      out[name] = null
      continue
    }
    const path = toNotebookRelativePath(base, ref.path)
    const type = typeOfResolved(ref.type, path)
    out[name] = type ? { type, path } : null
  }
  return out
}

// --- linked from: what points at a document ----------------------------------------------------

export interface Backlink {
  /** The document that points here, notebook-relative */
  path: string
  type: EntityType
  /** Its title, or its file name */
  label: string
  /** The day it belongs to, for captures; `created` otherwise */
  date?: string
  /** How it points here: the key it names this document under */
  via: string
}

const LINK_KEYS = ['rel', 'who', 'from', 'to', 'cc', 'org', 'where'] as const

/** The names a document points at, by the key that carries them. */
function namesOf(doc: Document): Array<{ via: string; name: string }> {
  const out: Array<{ via: string; name: string }> = []
  for (const key of LINK_KEYS) {
    const raw = doc.yaml[key]
    const values = Array.isArray(raw)
      ? asStrings(raw)
      : (asString(raw)
          ?.split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0) ?? [])
    for (const name of values) out.push({ via: key, name })
  }
  return out
}

function typeOfDir(dir: string): EntityType {
  switch (dir) {
    case 'time':
      return 'day'
    case 'people':
    case 'people-old':
      return 'person'
    case 'orgs':
      return 'org'
    case 'projects':
      return 'project'
    case 'places':
      return 'place'
    default:
      return 'library'
  }
}

function dateOf(path: string, doc: Document): string | undefined {
  const time = parseTimePath(path)
  if (time) return time.start.toString()
  const created = asString(doc.yaml['created'])
  return created ? created.slice(0, 10) : undefined
}

const backlinkCache = new WeakMap<MarkdownStore, { version: number; index: Map<string, Backlink[]> }>()

/** Every document's backlinks, built once per store version: a name in `rel`, `who`, `from`, `to`, `cc`, `org` or `where` resolved to its document. */
export function backlinkIndex(store: MarkdownStore, base: string): Map<string, Backlink[]> {
  const cached = backlinkCache.get(store)
  if (cached && cached.version === store.version) return cached.index
  const index = new Map<string, Backlink[]>()
  const resolvedNames = new Map<string, string | null>()
  for (const { path, dir, doc } of documentsOf(store, base)) {
    const seen = new Set<string>()
    for (const { via, name } of namesOf(doc)) {
      let target = resolvedNames.get(name)
      if (target === undefined) {
        const ref = store.resolve(name)
        target = 'path' in ref && typeof ref.path === 'string' ? toNotebookRelativePath(base, ref.path) : null
        resolvedNames.set(name, target)
      }
      if (!target || target === path || seen.has(target)) continue
      seen.add(target)
      const list = index.get(target) ?? []
      index.set(target, list)
      list.push({
        path,
        type: typeOfDir(dir),
        label: asString(doc.yaml['title']) ?? asString(doc.yaml['name']) ?? stem(path),
        date: dateOf(path, doc),
        via,
      })
    }
  }
  for (const list of index.values()) {
    list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.label.localeCompare(b.label))
  }
  backlinkCache.set(store, { version: store.version, index })
  return index
}

/** What points at a document, newest first. */
export function backlinksOf(store: MarkdownStore, base: string, path: string): Backlink[] {
  return backlinkIndex(store, base).get(path) ?? []
}
