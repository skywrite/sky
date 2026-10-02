import * as path from 'node:path'
import { placeChoices } from '#lib/places/catalog.ts'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { dayDir, isActionPath } from '#shared/nbfs/mod.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import { docDate, docTitle } from '../home/docMeta.ts'
import { isPathWithinRoots } from '../markdown-preview/request.ts'
import { type Scores, vocabularyOf } from '../vocabulary/mod.ts'
import { linkFrequency } from './frequency.ts'
import { type LinkItem, type LinkKind, PRIMARY_LINK_KINDS } from './types.ts'

function text(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join(', ') || undefined
  return undefined
}

function recordKind(file: string, fallback: LinkKind): LinkKind {
  for (const kind of ['video', 'meeting', 'message'] as const) {
    if (isActionPath(kind, file) || new RegExp(`/(?:[^/]*_)?${kind}_`, 'i').test(file)) return kind
  }
  if (file.includes('/ai-chats/')) return 'chat'
  if (file.includes('/journals/') || /\/journal_/.test(file)) return 'journal'
  return fallback === 'day' && !file.endsWith('/day.md') ? 'note' : fallback
}

function branch(doc: Document, store: MarkdownStore, base: string): LinkItem['parent'] {
  const parent = doc.yaml['parent']
  if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return undefined
  const p = parent as Record<string, unknown>
  if (typeof p.chat !== 'string' || typeof p.turn !== 'number') return undefined
  const parentDoc = store.findByPath(path.resolve(base, p.chat))?.doc
  return {
    path: p.chat,
    title: parentDoc ? docTitle(parentDoc, p.chat) : path.basename(p.chat, '.md').replace(/[-_]/g, ' '),
    turn: p.turn,
  }
}

/** A person's or org's interaction score, looked up by name as the front matter completions do. */
function interactionOf(item: LinkItem, scores: Scores | undefined): Pick<LinkItem, 'interactionScore' | 'lastContact'> {
  const name = item.value.toLowerCase()
  if (item.kind === 'person') {
    const hit = scores?.people.get(name)
    return hit ? { interactionScore: hit.score, ...(hit.lastContact ? { lastContact: hit.lastContact } : {}) } : {}
  }
  const org = item.kind === 'org' ? scores?.orgs.get(name) : undefined
  return org ? { interactionScore: org.score } : {}
}

/**
 * The existing index supplies records at every nesting depth; no notebook walk per search.
 * Scores are read per call: they change independently of the markdown index.
 */
export async function linkCatalog(
  store: MarkdownStore,
  base: string,
  dirs: string[],
  scores?: Scores,
): Promise<LinkItem[]> {
  const vocabulary = await vocabularyOf(store, base)
  const items: LinkItem[] = vocabulary.entities
    .filter((e) => isPathWithinRoots(path.resolve(base, e.path), dirs))
    .map((entity) => {
      const doc = store.findByPath(path.resolve(base, entity.path))?.doc
      const time = parseTimePath(entity.path)
      // Use the same dated references as VS Code: independent of the notebook's week layout.
      const value =
        time?.kind === 'day'
          ? `${time.date.ymd}/${path.posix.relative(path.posix.join('time', dayDir(time.date)), entity.path).replace(/\.md$/i, '')}`
          : entity.value
      return {
        value,
        path: entity.path,
        title:
          entity.type === 'person'
            ? entity.value
            : doc && entity.type === 'day'
              ? docTitle(doc, entity.path)
              : (entity.label ?? (doc ? text(doc.yaml['name']) : undefined) ?? entity.value),
        aliases: entity.aliases,
        hint: entity.type === 'place' ? entity.hint : undefined,
        kind: recordKind(entity.path, entity.type),
        date: doc ? (parseTimePath(entity.path)?.start.toString() ?? docDate(doc, entity.path)?.ymd) : undefined,
        people: doc
          ? [...new Set(['who', 'from', 'to'].map((key) => text(doc.yaml[key])).filter(Boolean))].join(' · ') ||
            undefined
          : undefined,
        summary: doc
          ? [text(doc.yaml['summary']), text(doc.yaml['tags'])].filter(Boolean).join(' · ') || undefined
          : undefined,
        parent: doc ? branch(doc, store, base) : undefined,
      }
    })
  for (const place of placeChoices(store.places)) {
    if (!isPathWithinRoots(place.path, dirs)) continue
    const relative = path.relative(base, place.path)
    const at = items.findIndex((item) => item.path === relative)
    const item: LinkItem = {
      ...(at >= 0 ? items[at] : {}),
      value: place.ref,
      path: relative,
      title: place.name,
      kind: 'place',
      aliases: place.aliases,
      hint: place.hint,
      ...(place.needsCreation ? { needsCreation: true } : {}),
    }
    if (at >= 0) items[at] = item
    else items.push(item)
  }
  const counts = linkFrequency(store, base, dirs, items)
  return items.map((item) => ({ ...item, linkCount: counts.get(item.path), ...interactionOf(item, scores) }))
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

/** Entity names lead; record titles outrank incidental context, including filename aliases. */
function relevance(item: LinkItem, query: string, terms: string[]): { score: number; entityName: boolean } {
  if (terms.length === 0) return { score: 1, entityName: false }
  const primary = PRIMARY_LINK_KINDS.includes(item.kind)
  // Time-record and library aliases include filenames, not alternate entity names.
  const names = [item.title, ...(primary || item.kind === 'place' ? (item.aliases ?? []) : [])].map(normalizeSearch)
  let score = 0
  if (names.includes(query)) score = 5
  else if (names.some((name) => name.startsWith(query))) score = 4
  else if (names.some((name) => terms.every((term) => name.split(/[\s/.,()]+/).some((word) => word.startsWith(term)))))
    score = 3
  else if (names.some((name) => terms.every((term) => name.includes(term)))) score = 2
  if (score) return { score, entityName: primary }
  const searchable = normalizeSearch(
    [
      ...names,
      ...(item.aliases ?? []),
      item.value,
      item.hint,
      item.people,
      item.summary,
      item.date,
      item.path,
      item.parent?.title,
    ].join(' '),
  )
  return { score: terms.every((term) => searchable.includes(term)) ? 1 : 0, entityName: false }
}

/**
 * Equally good name matches go to whoever Sky ranks highest everywhere else: the interaction score,
 * then the latest contact. Projects have no score, so their saved links decide.
 */
function byInteraction(a: LinkItem, b: LinkItem): number {
  return (
    (b.interactionScore ?? 0) - (a.interactionScore ?? 0) ||
    (b.lastContact ?? '').localeCompare(a.lastContact ?? '') ||
    (b.linkCount ?? 0) - (a.linkCount ?? 0)
  )
}

export function searchLinks(
  items: LinkItem[],
  query: string,
  kinds: string | readonly string[],
  day: string,
  exclude: string,
  /** The notebook owner's name: never suggested, though a search still finds them */
  owner = '',
): LinkItem[] {
  const normalized = normalizeSearch(query)
  const terms = normalized.split(' ').filter(Boolean)
  const selected = new Set((typeof kinds === 'string' ? kinds.split(',') : kinds).filter(Boolean))
  const matches = items
    .filter(
      (item) => item.path !== exclude && (!selected.size || selected.has(item.kind)) && (!day || item.date === day),
    )
    .map((item) => ({ item, ...relevance(item, normalized, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        Number(b.entityName) - Number(a.entityName) ||
        b.score - a.score ||
        (a.entityName ? byInteraction(a.item, b.item) : 0) ||
        (b.item.date ?? '').localeCompare(a.item.date ?? '') ||
        a.item.title.localeCompare(b.item.title) ||
        a.item.path.localeCompare(b.item.path),
    )
    .map(({ item }) => item)
  if (normalized) return matches

  const primaryOnly = selected.size > 0 && [...selected].every((kind) => PRIMARY_LINK_KINDS.includes(kind as LinkKind))
  const me = normalizeSearch(owner)
  const suggestible = (item: LinkItem) =>
    ((item.interactionScore ?? 0) > 0 || (item.linkCount ?? 0) > 0) &&
    !(
      me &&
      item.kind === 'person' &&
      [item.title, ...(item.aliases ?? [])].some((name) => normalizeSearch(name) === me)
    )
  // A score and a link count don't compare, so suggestions take the top of each type in turn.
  const ranked = PRIMARY_LINK_KINDS.map((kind) =>
    matches
      .filter((item) => item.kind === kind && suggestible(item))
      .sort((a, b) => byInteraction(a, b) || a.title.localeCompare(b.title)),
  )
  const suggested: LinkItem[] = []
  for (let rank = 0; ranked.some((list) => rank < list.length); rank++)
    for (const list of ranked) if (rank < list.length) suggested.push(list[rank]!)
  const frequent = suggested.slice(0, primaryOnly ? undefined : 6)
  const promoted = new Set(frequent.map((item) => item.path))
  return [
    ...frequent.map((item) => ({ ...item, frequent: true })),
    ...matches.filter((item) => !promoted.has(item.path)),
  ]
}
