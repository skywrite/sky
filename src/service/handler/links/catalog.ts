import * as path from 'node:path'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { dayDir, isActionPath } from '#shared/nbfs/mod.ts'
import parseTimePath from '#shared/nbfs/parseTimePath.ts'
import { docDate, docTitle } from '../home/docMeta.ts'
import { isPathWithinRoots } from '../markdown-preview/request.ts'
import { vocabularyOf } from '../vocabulary/mod.ts'
import type { LinkItem, LinkKind } from './types.ts'

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

/** The existing index supplies records at every nesting depth; no notebook walk per search. */
export async function linkCatalog(store: MarkdownStore, base: string, dirs: string[]): Promise<LinkItem[]> {
  const vocabulary = await vocabularyOf(store, base)
  return vocabulary.entities
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
}

function normalizeSearch(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
}

/** Names and aliases outrank incidental matches in a record's context, regardless of age. */
function relevance(item: LinkItem, query: string, terms: string[]): number {
  if (terms.length === 0) return 1
  const names = [item.title, ...(item.aliases ?? [])].map(normalizeSearch)
  if (names.includes(query)) return 5
  if (names.some((name) => name.startsWith(query))) return 4
  if (names.some((name) => terms.every((term) => name.split(/[\s/.,()]+/).some((word) => word.startsWith(term)))))
    return 3
  if (names.some((name) => terms.every((term) => name.includes(term)))) return 2
  const searchable = normalizeSearch(
    [...names, item.people, item.summary, item.date, item.path, item.parent?.title].join(' '),
  )
  return terms.every((term) => searchable.includes(term)) ? 1 : 0
}

export function searchLinks(items: LinkItem[], query: string, kind: string, day: string, exclude: string): LinkItem[] {
  const normalized = normalizeSearch(query)
  const terms = normalized.split(' ').filter(Boolean)
  return items
    .filter((item) => item.path !== exclude && (!kind || item.kind === kind) && (!day || item.date === day))
    .map((item) => ({ item, score: relevance(item, normalized, terms) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.item.date ?? '').localeCompare(a.item.date ?? '') ||
        a.item.title.localeCompare(b.item.title) ||
        a.item.path.localeCompare(b.item.path),
    )
    .map(({ item }) => item)
}
