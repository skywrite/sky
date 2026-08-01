import * as path from 'node:path'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { docDate, docTitle } from './docMeta.ts'

export interface HomeSearchResult {
  relativePath: string
  title: string
  /** Entity type ('person', 'org', …) or 'doc' for plain documents */
  kind: string
  /** YMD when known */
  date?: string
  /** Body excerpt around the first match (documents only) */
  snippet?: string
}

/** Interaction score maps from the service Store (same signal the VS Code completions rank by). */
export interface SearchScoring {
  personScores: Map<string, { score: number }>
  orgScores: Map<string, { score: number }>
}

interface Candidate extends HomeSearchResult {
  score: number
  interactionScore: number
}

const MAX_ENTITY_MATCHES_PER_KIND = 6
const MAX_BODY_CANDIDATES = 400
const SNIPPET_RADIUS = 90

/**
 * Search the notebook: entity names first, then document titles, paths,
 * tags, and bodies. Plain substring matching — every whitespace-separated
 * term must appear somewhere in a candidate for it to rank.
 */
export function searchNotebook(
  store: MarkdownStore,
  markdownBaseDir: string,
  query: string,
  limit = 20,
  today?: PlainDate,
  scoring?: SearchScoring,
): HomeSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const candidates: Candidate[] = []
  const seenPaths = new Set<string>()

  collectEntityMatches(store, markdownBaseDir, terms, scoring, candidates, seenPaths)
  collectDocumentMatches(store, markdownBaseDir, terms, today, candidates, seenPaths)

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.interactionScore !== a.interactionScore) return b.interactionScore - a.interactionScore
    const dateA = a.date ?? ''
    const dateB = b.date ?? ''
    if (dateA !== dateB) return dateB.localeCompare(dateA)
    return a.relativePath.localeCompare(b.relativePath)
  })

  return candidates.slice(0, limit).map(({ score: _score, interactionScore: _interactionScore, ...result }) => result)
}

function collectEntityMatches(
  store: MarkdownStore,
  markdownBaseDir: string,
  terms: string[],
  scoring: SearchScoring | undefined,
  candidates: Candidate[],
  seenPaths: Set<string>,
): void {
  // Goals are excluded: GoalStore is category-based and has no name index.
  const entityStores = [
    store.people,
    store.orgs,
    store.projects,
    store.decisions,
    store.streaks,
    store.ideas,
    store.places,
  ]

  for (const entityStore of entityStores) {
    let matched = 0
    for (const name of entityStore.names) {
      if (matched >= MAX_ENTITY_MATCHES_PER_KIND) break

      const nameLower = name.toLowerCase()
      if (!terms.every((term) => nameLower.includes(term))) continue

      const resolved = store.resolve(name)
      if (!('path' in resolved) || typeof resolved.path !== 'string') continue
      if (seenPaths.has(resolved.path)) continue

      seenPaths.add(resolved.path)
      matched += 1
      const title = displayName(resolved.value, name)
      candidates.push({
        relativePath: path.relative(markdownBaseDir, resolved.path),
        title,
        kind: resolved.type,
        score: 100,
        interactionScore: interactionScoreFor(resolved.type, title, scoring),
      })
    }
  }
}

/** Interaction score for a person/org (recency-decayed frequency); 0 for unscored kinds. */
function interactionScoreFor(kind: string, title: string, scoring: SearchScoring | undefined): number {
  if (!scoring) return 0
  const map = kind === 'person' ? scoring.personScores : kind === 'org' ? scoring.orgScores : undefined
  if (!map) return 0

  const direct = map.get(title)
  if (direct) return direct.score

  const titleLower = title.toLowerCase()
  for (const [name, entry] of map) {
    if (name.toLowerCase() === titleLower) return entry.score
  }
  return 0
}

/** The store's name index is normalized (lowercased) — prefer the document's own name/title. */
function displayName(value: unknown, fallback: string): string {
  if (value && typeof value === 'object') {
    const { name, title } = value as { name?: unknown; title?: unknown }
    if (typeof name === 'string' && name.trim().length > 0) return name
    if (typeof title === 'string' && title.trim().length > 0) return title
  }
  return fallback
}

function collectDocumentMatches(
  store: MarkdownStore,
  markdownBaseDir: string,
  terms: string[],
  today: PlainDate | undefined,
  candidates: Candidate[],
  seenPaths: Set<string>,
): void {
  let bodyCandidates = 0

  for (const filePath of store.time.paths) {
    if (seenPaths.has(filePath)) continue

    const doc = store.time.findByPath(filePath)
    if (!doc) continue

    const relativePath = path.relative(markdownBaseDir, filePath)
    const relativeLower = relativePath.toLowerCase()
    const title = docTitle(doc, filePath)
    const titleLower = title.toLowerCase()
    const tagsLower = Array.from(doc.tags).join(' ').toLowerCase()
    const relsLower = Array.from(doc.rel).join(' ').toLowerCase()

    let score = 0
    let matchedMeta = true
    for (const term of terms) {
      if (titleLower.includes(term)) score += 50
      else if (tagsLower.includes(term)) score += 40
      else if (relsLower.includes(term)) score += 35
      else if (relativeLower.includes(term)) score += 30
      else matchedMeta = false
    }

    let snippet: string | undefined
    if (!matchedMeta) {
      if (bodyCandidates >= MAX_BODY_CANDIDATES) continue

      const bodyLower = doc.markdown.toLowerCase()
      if (!terms.every((term) => titleLower.includes(term) || bodyLower.includes(term))) continue

      bodyCandidates += 1
      score = 10 * terms.length
      snippet = extractSnippet(doc.markdown, bodyLower, terms)
    }

    const date = docDate(doc, filePath)
    if (date && today) score += recencyBoost(date, today)

    seenPaths.add(filePath)
    candidates.push({
      relativePath,
      title,
      kind: 'doc',
      date: date?.ymd,
      snippet,
      score,
      interactionScore: 0,
    })
  }
}

function recencyBoost(date: PlainDate, today: PlainDate): number {
  const ageDays = Math.round((today.toDate().getTime() - date.toDate().getTime()) / 86_400_000)
  if (ageDays < 0) return 0
  if (ageDays <= 7) return 25
  if (ageDays <= 30) return 15
  if (ageDays <= 365) return 5
  return 0
}

function extractSnippet(body: string, bodyLower: string, terms: string[]): string | undefined {
  let firstIndex = -1
  for (const term of terms) {
    const index = bodyLower.indexOf(term)
    if (index >= 0 && (firstIndex === -1 || index < firstIndex)) firstIndex = index
  }
  if (firstIndex === -1) return undefined

  const start = Math.max(0, firstIndex - SNIPPET_RADIUS)
  const end = Math.min(body.length, firstIndex + SNIPPET_RADIUS)
  const raw = body.slice(start, end).replace(/\s+/g, ' ').trim()
  if (raw.length === 0) return undefined

  return (start > 0 ? '…' : '') + raw + (end < body.length ? '…' : '')
}
