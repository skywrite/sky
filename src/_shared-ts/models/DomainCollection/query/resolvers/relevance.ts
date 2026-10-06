/**
 * `orderBy: RELEVANCE` — a text search returns its best matches, not its newest.
 *
 * A root with a text filter answered newest-first and cut at `limit` returns
 * the ten most recent mentions whatever they say; over 30 days of chats that
 * dropped 229k matched documents before anything judged them. This orders the
 * matches by recency with a lift for strong hits, replayed on a month of the
 * notebook's own questions (2026-10-05): about one document in ten changes,
 * nearly always an older one whose title or summary carries the term.
 *
 *   score = 2^(−age / 30)  +  0.65 · (1 − Π (1 − eₜ))     over the five strongest phrases
 *   eₜ = rₜ                                       hit in the title, summary, tags or links
 *   eₜ = 0.25 · rₜ · min(1, cₜ / (2 · T / 1000))   body occurrences cₜ per 1k tokens, T ≥ 200
 *   rₜ = ln(N / dfₜ) / ln N                       N documents of the type, dfₜ of them matching
 *
 * Recency is the backbone: a header hit on a rare term lifts a document about
 * six weeks, a dense body match about a week, a passing mention almost nothing.
 * Ties go to the newer document. A document with no date (an entity card)
 * has no recency term and orders by its lift alone.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { getDateForDocument } from './shared.ts'

export type OrderBy = 'DATE' | 'RELEVANCE'

export const RELEVANCE = {
  /** Days for the recency term to halve. */
  halfLifeDays: 30,
  /** What a full-strength hit can add, in recency units — about six weeks of age. */
  lift: 0.65,
  /** Body occurrences per 1k tokens that earn full body credit. */
  fullCreditDensity: 2,
  /** The body channel's share of a header hit's strength. */
  bodyWeight: 0.25,
  /** A document measures as at least this long. */
  minDocTokens: 200,
  /** Phrases beyond the strongest few add nothing. */
  maxPhrases: 5,
} as const

const TEXT_FILTER = /^(?:body|summary|name|title)Contains$/
const MS_PER_DAY = 86_400_000

/** The text filters' phrases in a `where`, lowercased — what the search was for. */
export function searchPhrases(where: unknown): string[] {
  if (typeof where !== 'object' || where === null) return []
  const out: string[] = []
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (TEXT_FILTER.test(key) && typeof value === 'string' && value.trim()) out.push(value.trim().toLowerCase())
  }
  return [...new Set(out)]
}

/** Title words from the filename, routing segments (`Sender-to-channel`) dropped — the chat scorer's rule. */
function titleWords(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')
  return base
    .split('_')
    .filter((seg) => !seg.includes('-to-'))
    .join(' ')
    .replace(/-/g, ' ')
}

function headerText(doc: Document, path: string): string {
  const yaml = doc.yaml
  return [
    titleWords(path),
    String(yaml['summary'] ?? ''),
    String(yaml['title'] ?? ''),
    String(doc.tags),
    [...doc.rel].join(' '),
  ]
    .join(' ')
    .toLowerCase()
}

function occurrences(text: string, phrase: string, cap = 64): number {
  let count = 0
  let at = 0
  while (count < cap) {
    const i = text.indexOf(phrase, at)
    if (i === -1) break
    count++
    at = i + phrase.length
  }
  return count
}

/**
 * How strongly a document matches the phrases, 0 to 1: the strongest evidence
 * per phrase, combined noisy-or over the strongest few. `rarity` is the
 * phrases' shared rarity across the type (the filter's own match count over
 * the type's size), since a text filter matches every returned document.
 */
export function relevanceOf(doc: Document, path: string, phrases: readonly string[], rarity: number): number {
  if (phrases.length === 0 || rarity <= 0) return 0
  const header = headerText(doc, path)
  const body = doc.markdown.toLowerCase()
  const tokens = Math.max(Math.ceil(body.length / 4), RELEVANCE.minDocTokens)
  const evidences: number[] = []
  for (const phrase of phrases) {
    let e = header.includes(phrase) ? rarity : 0
    const count = occurrences(body, phrase)
    if (count > 0) {
      const density = (count / tokens) * 1000
      e = Math.max(e, Math.min(density / RELEVANCE.fullCreditDensity, 1) * rarity * RELEVANCE.bodyWeight)
    }
    if (e > 0) evidences.push(e)
  }
  let miss = 1
  for (const e of evidences.sort((a, b) => b - a).slice(0, RELEVANCE.maxPhrases)) miss *= 1 - e
  return 1 - miss
}

/** log(N/df)/log N: 1 for a phrase matching one document of the type, 0 for one matching all. */
export function rarityOf(matched: number, total: number): number {
  if (matched <= 0 || total <= 1) return 0
  return Math.max(0, Math.log(total / matched) / Math.log(total))
}

/** 2^(−age/halfLife); 0 for an undated document. */
export function recencyOf(doc: Document, path: string, todayMs: number): number {
  const date = getDateForDocument(doc, path)
  if (!date) return 0
  let ageDays: number
  try {
    ageDays = Math.max(0, Math.floor((todayMs - PlainDate.fromString(date).toDate().getTime()) / MS_PER_DAY))
  } catch {
    return 0
  }
  return 2 ** (-ageDays / RELEVANCE.halfLifeDays)
}

/**
 * Order matches by recency with the relevance lift, newest first on ties.
 * `total` is the size of the type the filter ran over; `matched` is
 * `entries.length` by construction — the filter's own result.
 */
export function sortByRelevance<E extends { doc: Document; path: string }>(
  entries: E[],
  where: unknown,
  total: number,
  todayMs = PlainDate.today().toDate().getTime(),
): E[] {
  const phrases = searchPhrases(where)
  const rarity = rarityOf(entries.length, total)
  const scored = entries.map((entry) => ({
    entry,
    score:
      recencyOf(entry.doc, entry.path, todayMs) + RELEVANCE.lift * relevanceOf(entry.doc, entry.path, phrases, rarity),
    date: getDateForDocument(entry.doc, entry.path) ?? '',
  }))
  scored.sort((a, b) => (a.score !== b.score ? b.score - a.score : b.date.localeCompare(a.date)))
  return scored.map((s) => s.entry)
}
