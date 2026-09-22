import * as path from 'node:path'
import type Document from '#shared/models/Markdown/Document/mod.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { isPathWithinRoot, isPathWithinRoots } from '../markdown-preview/request.ts'
import { type LinkItem, PRIMARY_LINK_KINDS } from './types.ts'

const cache = new WeakMap<MarkdownStore, { version: number; key: string; counts: Map<string, number> }>()

/** Count saved relations once per source and destination, independently of names and aliases. */
export function linkFrequency(
  store: MarkdownStore,
  base: string,
  dirs: string[],
  items: LinkItem[],
): Map<string, number> {
  const targets = items.filter((item) => PRIMARY_LINK_KINDS.includes(item.kind))
  const key = JSON.stringify([base, [...dirs].sort(), targets.map((item) => [item.value, item.path])])
  const cached = cache.get(store)
  if (cached?.version === store.version && cached.key === key) return cached.counts

  const byPath = new Map(targets.map((item) => [path.resolve(base, item.path), item]))
  const projectByValue = new Map(
    targets.filter((item) => item.kind === 'project').map((item) => [item.value.trim().toLowerCase(), item]),
  )
  const resolved = new Map<string, LinkItem | null>()
  const counts = new Map<string, number>()
  const documents = new Map<string, Document>()
  for (const source of [
    store.people,
    store.orgs,
    store.projects,
    store.decisions,
    store.goals,
    store.streaks,
    store.tracking,
    store.ideas,
    store.places,
    store.library,
    store.time,
    store.ai,
  ]) {
    for (const entry of source.getAll().getAllItems()) documents.set(entry.path, entry.doc)
  }
  for (const entry of store.projects.getDocuments().getAllItems()) documents.set(entry.path, entry.doc)

  for (const [file, doc] of documents) {
    if (!isPathWithinRoots(file, dirs)) continue
    const seen = new Set<string>()
    for (const raw of doc.rel) {
      let target = resolved.get(raw)
      if (target === undefined) {
        target = null
        try {
          const ref = store.resolve(raw)
          if ('path' in ref) target = byPath.get(ref.path) ?? null
          // Project folders can be linked before they have an indexed overview.
          else if (ref.type === 'unresolved') target = projectByValue.get(raw.trim().toLowerCase()) ?? null
        } catch {
          // A malformed legacy reference must not stop the whole picker from opening.
        }
        resolved.set(raw, target)
      }
      if (!target || path.resolve(base, target.path) === file || seen.has(target.path)) continue
      if (target.kind === 'project') {
        const absolute = path.resolve(base, target.path)
        const folder = absolute.endsWith('/_project/overview.md') ? path.dirname(path.dirname(absolute)) : absolute
        // ProjectStore injects parent-project membership; it is not a linking choice.
        if (isPathWithinRoot(file, folder)) continue
      }
      seen.add(target.path)
      counts.set(target.path, (counts.get(target.path) ?? 0) + 1)
    }
  }
  cache.set(store, { version: store.version, key, counts })
  return counts
}
