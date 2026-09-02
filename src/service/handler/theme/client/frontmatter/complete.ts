/**
 * The panel's completions and name resolution, from the service: small requests, answered from a
 * cache when the same question was asked within the last few seconds — a burst of typing, not
 * the page's life, so what the notebook learns reaches the panel.
 */

export type EntityType = 'person' | 'org' | 'project' | 'place' | 'library' | 'day'

export interface Completion {
  value: string
  label?: string
  type: EntityType | 'tag' | 'value' | 'key'
  path?: string
  hint?: string
  count?: number
}

export type CompletionKind = 'people' | 'orgs' | 'projects' | 'places' | 'library' | 'rel' | 'tags' | 'values' | 'keys'

export interface Resolved {
  type: EntityType
  path: string
}

const CACHE_LIMIT = 300
/** How long an answer stands in for asking again */
const CACHE_MS = 10_000

interface Cached<T> {
  at: number
  value: T
}

const completions = new Map<string, Cached<Promise<Completion[]>>>()
const resolutions = new Map<string, Cached<Resolved | null>>()

function recall<T>(cache: Map<string, Cached<T>>, key: string): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key)
    return undefined
  }
  return hit.value
}

function remember<T>(cache: Map<string, Cached<T>>, key: string, value: T) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), value })
}

export async function fetchCompletions(
  kind: CompletionKind,
  query: string,
  options: { key?: string; dir?: string; limit?: number } = {},
): Promise<Completion[]> {
  const params = new URLSearchParams({ kind, q: query })
  if (options.key) params.set('key', options.key)
  if (options.dir) params.set('dir', options.dir)
  if (options.limit) params.set('limit', String(options.limit))
  const url = `/docs/_api/complete?${params.toString()}`
  const cached = recall(completions, url)
  if (cached) return cached
  const request = fetch(url)
    .then(async (r) => {
      if (!r.ok) return []
      const body = (await r.json()) as { items?: Completion[] }
      return body.items ?? []
    })
    .catch(() => [])
  remember(completions, url, request)
  return request
}

/** Where each name points; names the notebook does not know resolve to null. */
export async function resolveNames(names: string[], file: string): Promise<Record<string, Resolved | null>> {
  const out: Record<string, Resolved | null> = {}
  const missing: string[] = []
  for (const name of names) {
    const known = recall(resolutions, name)
    if (known !== undefined) out[name] = known
    else missing.push(name)
  }
  if (missing.length > 0) {
    try {
      const r = await fetch('/docs/_api/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names: missing, path: file }),
      })
      const body = r.ok ? ((await r.json()) as { resolved?: Record<string, Resolved | null> }) : {}
      for (const name of missing) {
        const value = body.resolved?.[name] ?? null
        remember(resolutions, name, value)
        out[name] = value
      }
    } catch {
      for (const name of missing) out[name] = null
    }
  }
  return out
}

/** The time zones this browser knows, for the `tz` picker. */
export function timeZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
}

export interface Backlink {
  path: string
  type: EntityType
  label: string
  date?: string
  via: string
}

/** What points at a document, newest first, with the total beyond the limit. */
export async function fetchBacklinks(path: string, limit = 50): Promise<{ items: Backlink[]; total: number }> {
  try {
    const r = await fetch(`/docs/_api/backlinks?path=${encodeURIComponent(path)}&limit=${limit}`)
    if (!r.ok) return { items: [], total: 0 }
    const body = (await r.json()) as { items?: Backlink[]; total?: number }
    return { items: body.items ?? [], total: body.total ?? 0 }
  } catch {
    return { items: [], total: 0 }
  }
}

/**
 * Whether an earlier answer still serves a search: it answered this search, or one this search
 * extends or shortens. A wider question's answer — everyone by score, for the empty search —
 * would pass for the first letters' matches, so it does not.
 */
export function serves(answered: string, search: string): boolean {
  if (answered === search) return true
  if (answered.length === 0 || search.length === 0) return false
  return search.startsWith(answered) || answered.startsWith(search)
}
