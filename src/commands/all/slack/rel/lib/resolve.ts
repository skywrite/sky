import * as path from 'node:path'
import * as stringSimilarity from 'string-similarity'
import { DIR_DECISIONS, DIR_ORGS, DIR_PEOPLE, DIR_PEOPLE_OLD, DIR_PLACES, DIR_PROJECTS } from '#config'
import { walkToArray } from '#shared/fs/mod.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'

export type EntityKind = 'person' | 'org' | 'project'

export type EntityCandidate = {
  /** The string written into rel: — spaced person/org name, or projects/<Name> */
  ref: string
  kind: EntityKind
  /** Lowercased, separator-normalized matching form */
  norm: string
  /** projects only: status bucket the project dir lives under (open, completed, ...) */
  projectStatus?: string
  /** person exists only under people-old — matched reluctantly */
  archivedPerson?: boolean
}

export type EntityIndex = {
  candidates: EntityCandidate[]
  /** MarkdownStore.canResolve — the single authority on whether a ref is live */
  canResolve: (raw: string) => boolean
}

export type ResolveOptions = {
  index: EntityIndex
  /** Interaction scores keyed by normalized entity name; absent = no prior */
  scores?: Map<string, number>
  /** Project status buckets eligible for resolution; absent = all */
  projectStatuses?: string[]
}

// Conservative bars: a wrong entity pollutes person/project pages, an abstain
// costs one hand edit. Archived people demand a visibly better string match.
const FUZZY_MIN = 0.82
const FUZZY_MIN_ARCHIVED = 0.9
const FUZZY_MARGIN = 0.04
const SCORE_DOMINANCE = 3

export function normalizeEntityName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_]+/g, ' ')
    .trim()
}

/**
 * Enumerate entity candidates from file paths (relative to the notebook base).
 * Pure so conventions are testable; `buildEntityIndex` validates every ref
 * through MarkdownStore.canResolve afterwards, so a wrongly-derived candidate
 * is dropped rather than ever written.
 */
export function candidatesFromPaths(relPaths: string[]): EntityCandidate[] {
  const byNorm = new Map<string, EntityCandidate>()

  const add = (candidate: EntityCandidate) => {
    const key = `${candidate.kind}:${candidate.norm}`
    const existing = byNorm.get(key)
    // A person in both people/ and people-old/ counts as current
    if (existing) {
      if (existing.archivedPerson && !candidate.archivedPerson) byNorm.set(key, candidate)
      return
    }
    byNorm.set(key, candidate)
  }

  for (const relPath of relPaths) {
    const parts = relPath.split('/')
    const family = parts[0]
    const stem = parts[parts.length - 1].replace(/\.md$/, '')

    if ((family === 'people' || family === 'people-old' || family === 'orgs') && relPath.endsWith('.md')) {
      if (!stem || stem.startsWith('_') || stem.startsWith('.')) continue
      const spaced = stem.replace(/-/g, ' ')
      add({
        ref: spaced,
        kind: family === 'orgs' ? 'org' : 'person',
        norm: normalizeEntityName(stem),
        ...(family === 'people-old' ? { archivedPerson: true } : {}),
      })
      continue
    }

    if (family === 'projects' && parts.length >= 3) {
      // projects/<status>/<name>/... with an optional year level: projects/<status>/<yyyy>/<name>/...
      const status = parts[1]
      if (status.endsWith('.md') || status.startsWith('_')) continue
      const nameIdx = /^\d{4}$/.test(parts[2]) ? 3 : 2
      const name = parts[nameIdx]?.replace(/\.md$/, '')
      if (!name || name.startsWith('_')) continue
      add({
        ref: `projects/${name}`,
        kind: 'project',
        norm: normalizeEntityName(name),
        projectStatus: status,
      })
    }
  }

  return Array.from(byNorm.values())
}

/** Build the candidate roster + resolution oracle over the entity dirs (time/ excluded — fast). */
export async function buildEntityIndex(): Promise<EntityIndex> {
  const store = await MarkdownStore.build({
    peopleDirs: [DIR_PEOPLE, DIR_PEOPLE_OLD],
    orgDirs: [DIR_ORGS],
    projectsDir: DIR_PROJECTS,
    decisionsDir: DIR_DECISIONS,
    placesDir: DIR_PLACES,
    timeDirs: [],
  })
  const canResolve = (raw: string) => store.canResolve(raw)

  const relPaths: string[] = []
  for (const [dir, family] of [
    [DIR_PEOPLE, 'people'],
    [DIR_PEOPLE_OLD, 'people-old'],
    [DIR_ORGS, 'orgs'],
    [DIR_PROJECTS, 'projects'],
  ] as const) {
    for (const entry of await walkToArray(dir, { exts: ['.md'] })) {
      relPaths.push(path.join(family, path.relative(dir, entry.path)))
    }
  }

  // Keep only candidates whose written form the store actually resolves; for
  // bare names prefer the spaced form but fall back to the hyphenated stem.
  const candidates: EntityCandidate[] = []
  for (const candidate of candidatesFromPaths(relPaths)) {
    if (canResolve(candidate.ref)) {
      candidates.push(candidate)
      continue
    }
    const hyphenated = candidate.ref.replace(/ /g, '-')
    if (candidate.kind !== 'project' && canResolve(hyphenated)) {
      candidates.push({ ...candidate, ref: hyphenated })
    }
  }

  return { candidates, canResolve }
}

/**
 * Resolve one extracted mention to a canonical entity ref, or abstain.
 * Ladder: exact normalized match → unique first-name match → fuzzy with
 * uniqueness margin. Interaction scores break near-ties; without a dominant
 * score an ambiguous mention abstains rather than guesses.
 */
export function resolveMention(name: string, kind: EntityKind, opts: ResolveOptions): string | undefined {
  const target = normalizeEntityName(name)
  if (!target) return undefined

  const pool = opts.index.candidates.filter(
    (c) =>
      c.kind === kind &&
      (c.kind !== 'project' || !opts.projectStatuses || opts.projectStatuses.includes(c.projectStatus ?? '')),
  )
  if (pool.length === 0) return undefined

  const exact = pool.filter((c) => c.norm === target)
  if (exact.length > 0) return disambiguate(exact, opts.scores)?.ref

  // Single-token mention ("michael") against first names, people only
  if (kind === 'person' && !target.includes(' ')) {
    const firstName = pool.filter((c) => c.norm.split(' ')[0] === target)
    if (firstName.length > 0) return disambiguate(firstName, opts.scores)?.ref
  }

  // Partial project names ("Atlas" → projects/Atlas-Rollout): every
  // mention token present in the candidate name, unique winner only
  if (kind === 'project') {
    const targetTokens = target.split(' ')
    const subset = pool.filter((c) => {
      const candidateTokens = new Set(c.norm.split(' '))
      return targetTokens.every((t) => candidateTokens.has(t))
    })
    if (subset.length > 0) return disambiguate(subset, opts.scores)?.ref
  }

  const rated = pool
    .map((c) => ({ c, rating: stringSimilarity.compareTwoStrings(target, c.norm) }))
    .sort((a, b) => b.rating - a.rating)
  const best = rated[0]
  const bar = best.c.archivedPerson ? FUZZY_MIN_ARCHIVED : FUZZY_MIN
  if (best.rating < bar) return undefined
  const contenders = rated.filter((r) => r.rating >= best.rating - FUZZY_MARGIN)
  return disambiguate(
    contenders.map((r) => r.c),
    opts.scores,
  )?.ref
}

export type SubjectLists = { people: string[]; orgs: string[]; projects: string[] }

/**
 * Resolve extracted subjects to canonical refs, deduped by normalized form.
 * A project's short name is often extracted as an org ("Beacon") — when org
 * resolution fails, the same mention retries as a project.
 */
export function resolveSubjects(
  subjects: SubjectLists,
  index: EntityIndex,
  scores: Map<string, number> | undefined,
  opts: { projectStatuses?: string[] } = {},
): { refs: string[]; dropped: number } {
  const attempts: [string, EntityKind][] = [
    ...subjects.people.map((n): [string, EntityKind] => [n, 'person']),
    ...subjects.orgs.map((n): [string, EntityKind] => [n, 'org']),
    ...subjects.projects.map((n): [string, EntityKind] => [n, 'project']),
  ]
  const refs: string[] = []
  let dropped = 0
  for (const [name, kind] of attempts) {
    const base = { index, scores, projectStatuses: opts.projectStatuses }
    const ref = resolveMention(name, kind, base) ?? (kind === 'org' ? resolveMention(name, 'project', base) : undefined)
    if (!ref) {
      dropped++
      continue
    }
    if (!refs.some((r) => normalizeEntityName(r) === normalizeEntityName(ref))) refs.push(ref)
  }
  return { refs, dropped }
}

/** Unique candidate wins; ties resolve only under a dominant interaction score. */
function disambiguate(candidates: EntityCandidate[], scores?: Map<string, number>): EntityCandidate | undefined {
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]
  if (!scores) return undefined
  const ranked = candidates.map((c) => ({ c, score: scores.get(c.norm) ?? 0 })).sort((a, b) => b.score - a.score)
  const [top, second] = ranked
  if (top.score > 0 && top.score >= SCORE_DOMINANCE * Math.max(second.score, Number.EPSILON)) return top.c
  return undefined
}
