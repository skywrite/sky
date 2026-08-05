/**
 * Score-aware person name resolution for query filters.
 *
 * Resolution order for a queried name (e.g. `involves: "Bob"`):
 *
 * 1. Exact alias lookup in PeopleStore — "Bob" is in some person's `name:`
 *    list → that person's full alias set.
 * 2. Token match over all indexed names — "Bob" matches "Bob Smith" by
 *    first-name token (also token prefix for queries of 3+ chars, so "Dan"
 *    finds "Daniel"). A single candidate wins outright; multiple candidates
 *    are ranked by interaction score (when available): a clear winner
 *    (>= 3x the runner-up) resolves alone, close scores union the top two.
 * 3. No candidates / no signal — just the raw name (legacy behavior).
 *
 * The raw queried name is ALWAYS included in the result, so resolution only
 * ever widens matching — a query that matched a document before resolution
 * still matches it after.
 */

import type PersonDocument from '#shared/models/Person/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import type PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import type { NameResolver } from './filters/involves.ts'

// ---------------------------------------------------------------------------
// Options & constants
// ---------------------------------------------------------------------------

export interface NameResolverOptions {
  /**
   * Interaction-score lookup (raw name in, score out). Provided by the
   * notebook service from its ScoringStore; absent on the local path,
   * where multi-candidate matches stay unresolved.
   */
  scoreFor?: (name: string) => number
}

/** Winner must out-score the runner-up by this factor to resolve alone. */
const WIN_MARGIN = 3

/** Minimum query length for token-prefix matching ("Dan" → "Daniel"). */
const PREFIX_MIN_LENGTH = 3

/** Fallback resolutions are memoized per name; filters call once per document. */
const MEMO_TTL_MS = 60_000
const MEMO_MAX = 256

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type PersonEntry = { value: PersonDocument; path: string }

/** All known names for a person (name list + alt handle). */
function namesOf(person: PersonEntry): string[] {
  const names = new Set(person.value.names)
  if (person.value.alt) names.add(person.value.alt)
  return Array.from(names)
}

/**
 * Find people whose indexed names match the query: single-token queries
 * match any name token (exact, or prefix for 3+ chars); multi-word queries
 * match as a prefix of the full name ("jane d" → "jane doe").
 */
function findCandidates(store: PeopleStore, query: string): PersonEntry[] {
  const byPath = new Map<string, PersonEntry>()

  for (const indexed of store.names) {
    const hit = query.includes(' ')
      ? indexed === query || indexed.startsWith(query)
      : indexed.split(' ').some((t) => t === query || (query.length >= PREFIX_MIN_LENGTH && t.startsWith(query)))
    if (!hit) continue

    const person = store.find(indexed)
    if (person && !byPath.has(person.path)) byPath.set(person.path, person)
  }

  return Array.from(byPath.values())
}

/** A person's interaction score: sum over all their names. */
function scoreOf(person: PersonEntry, scoreFor: (name: string) => number): number {
  let total = 0
  for (const n of namesOf(person)) total += scoreFor(n)
  return total
}

/** Resolve a non-alias query via token match + score ranking. Null when unresolvable. */
function resolveByTokenAndScore(
  store: PeopleStore,
  query: string,
  scoreFor: ((name: string) => number) | undefined,
): string[] | null {
  const candidates = findCandidates(store, query)
  if (candidates.length === 0) return null
  if (candidates.length === 1) return namesOf(candidates[0])

  // Multiple candidates need an interaction-score signal to disambiguate
  if (!scoreFor) return null

  const ranked = candidates.map((c) => ({ c, score: scoreOf(c, scoreFor) })).sort((a, b) => b.score - a.score)

  const [first, second] = ranked
  if (first.score <= 0) return null

  if (first.score >= WIN_MARGIN * second.score) return namesOf(first.c)
  return Array.from(new Set([...namesOf(first.c), ...namesOf(second.c)]))
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a NameResolver over a PeopleStore.
 *
 * @example createNameResolver(store.people, { scoreFor })("Bob")
 *          → ["Bob Smith", "Bob"] when Bob Smith is the clear interaction-score winner
 */
export function createNameResolver(store: PeopleStore, options: NameResolverOptions = {}): NameResolver {
  const { scoreFor } = options
  const memo = new Map<string, { names: string[]; at: number }>()

  return (name: string): string[] => {
    // Exact alias hit is authoritative
    const person = store.find(name)
    if (person) {
      const names = new Set(person.value.names)
      if (person.value.alt) names.add(person.value.alt)
      names.add(name)
      return Array.from(names)
    }

    const query = normalizeName(name)
    if (!query) return [name]

    const cached = memo.get(query)
    if (cached && Date.now() - cached.at < MEMO_TTL_MS) return cached.names

    const resolved = resolveByTokenAndScore(store, query, scoreFor)
    // Always keep the raw name so resolution never narrows matching
    const names = resolved ? Array.from(new Set([...resolved, name])) : [name]

    if (memo.size >= MEMO_MAX) memo.clear()
    memo.set(query, { names, at: Date.now() })
    return names
  }
}
