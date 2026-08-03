/**
 * Gathers active notebook entities (people, projects, decisions, goals, tags)
 * for injection into AI context prompts so the AI can match informal user
 * phrasing to real entity names.
 *
 * People come from the notebook service's interaction-scored ranking
 * (frequency x recency), then get alias-merged through PeopleStore so the
 * AI sees "Bob Smith (aka Bob)" rather than raw name strings.
 *
 * Tags come from the service's all-time tag scoring (per-tag file count and
 * last-seen date, no time window), trimmed to the most active by
 * recency-weighted score.
 */

import ProjectStore from '#shared/models/Store/ProjectStore/mod.ts'
import DecisionStore from '#shared/models/Store/DecisionStore/mod.ts'
import GoalStore from '#shared/models/Store/GoalStore/mod.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import { PORT_SERVER } from '#shared/config.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PersonEntity {
  /** Canonical name (first entry of the person file's name list) */
  name: string
  /** Other known names from the person file */
  aliases: string[]
  title?: string
  org?: string
}

export interface TagVocabEntry {
  name: string
  /** All-time count of files carrying the tag */
  fileCount: number
  /** Latest YYYY-MM-DD the tag was seen; null when no file carrying it has a date */
  lastSeen: string | null
}

/** A rolled-up prefix group from the vocabulary's long tail. */
export interface TagBranch {
  /** Tag-path prefix (`Atlas`), or the full tag name when tagCount is 1 */
  prefix: string
  /** Number of tags aggregated under the prefix */
  tagCount: number
  /** Sum of the aggregated tags' file counts */
  fileCount: number
  /** Latest lastSeen across the aggregated tags */
  lastSeen: string | null
  /** True for a split branch's leftovers — tags not covered by its listed sub-branches */
  residual?: boolean
}

export interface TagVocabulary {
  /** The most-active tags by recency-weighted score */
  active: TagVocabEntry[]
  /** Everything else, rolled up by prefix; single substantial tags stay as themselves */
  branches: TagBranch[]
  /** One-off tags too minor to list — the model should know the list is not exhaustive */
  unlisted: number
}

export interface EntityContext {
  people: PersonEntity[]
  projects: string[]
  decisions: string[]
  goals: string[]
  tags: TagVocabulary
}

// ---------------------------------------------------------------------------
// Tag vocabulary (all-time, from the service's tag scoring)
// ---------------------------------------------------------------------------

/** Raw row from the service's `tagsWithScores` field, score-descending. */
interface TagScoreRow {
  name: string
  score: number
  lastSeen: string | null
  fileCount: number
}

/**
 * Fetch the all-time tag vocabulary from the running notebook service, which
 * tracks every tag's recency-weighted score, file count, and last-seen date
 * incrementally. Empty on any failure — the prompt simply gets no tag block.
 */
async function fetchTagVocabulary(): Promise<TagScoreRow[]> {
  try {
    const resp = await fetch(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ tagsWithScores { name score lastSeen fileCount } }' }),
    })
    if (!resp.ok) return []
    const json = (await resp.json()) as { data?: { tagsWithScores?: TagScoreRow[] } }
    const rows = json?.data?.tagsWithScores
    if (!Array.isArray(rows)) return []
    return rows.filter((r) => typeof r?.name === 'string')
  } catch {
    return []
  }
}

export interface TagVocabOptions {
  /** How many top-scored tags are listed individually */
  limit: number
  /** Branches with more tags than this split one level deeper */
  splitAt: number
  /** A lone tag below this many files is counted, not listed */
  minLoneFiles: number
}

// Tuned against the real distribution (2,282 tags): ~200 active + ~170 branch
// lines ≈ 4.5k tokens, with only true one-offs left unlisted.
export const TAG_VOCAB_DEFAULTS: TagVocabOptions = { limit: 200, splitAt: 50, minLoneFiles: 3 }

/** Aggregate accumulator for one prefix group. */
interface Group {
  rows: TagScoreRow[]
  fileCount: number
  lastSeen: string | null
}

/** Group rows by their first `depth` tag-path segments. */
function groupByPrefix(rows: TagScoreRow[], depth: number): Map<string, Group> {
  const groups = new Map<string, Group>()
  for (const row of rows) {
    const prefix = row.name.split('/').slice(0, depth).join('/')
    const group = groups.get(prefix) ?? { rows: [], fileCount: 0, lastSeen: null }
    group.rows.push(row)
    group.fileCount += row.fileCount
    if (row.lastSeen && (!group.lastSeen || row.lastSeen > group.lastSeen)) group.lastSeen = row.lastSeen
    groups.set(prefix, group)
  }
  return groups
}

/**
 * Build the vocabulary the prompts will see from the service's scored rows.
 *
 * The top `limit` tags by recency-weighted score are listed individually —
 * the score only decides who makes that list and is then dropped, since
 * fileCount and lastSeen are meaningful to the model in a way the score is
 * not. The rest rolls up into per-prefix branches the model can open with
 * `tagsStartsWith`; oversized branches split one level deeper, keeping their
 * leftovers as a residual line. A lone tag with enough files is listed as
 * itself (dormant-but-substantial is exactly what the recency-weighted top
 * misses); anything smaller is just counted.
 */
export function buildTagVocabulary(rows: TagScoreRow[], opts: TagVocabOptions = TAG_VOCAB_DEFAULTS): TagVocabulary {
  const byScore = [...rows].sort((a, b) => b.score - a.score)
  const active = byScore
    .slice(0, opts.limit)
    .map(({ name, fileCount, lastSeen }) => ({ name, fileCount, lastSeen }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const branches: TagBranch[] = []
  let unlisted = 0

  const emit = (prefix: string, group: Group): void => {
    if (group.rows.length === 1) {
      const [row] = group.rows
      if (row.fileCount >= opts.minLoneFiles) {
        branches.push({ prefix: row.name, tagCount: 1, fileCount: row.fileCount, lastSeen: row.lastSeen })
      } else {
        unlisted += 1
      }
      return
    }
    branches.push({ prefix, tagCount: group.rows.length, fileCount: group.fileCount, lastSeen: group.lastSeen })
  }

  for (const [prefix, group] of groupByPrefix(byScore.slice(opts.limit), 1)) {
    if (group.rows.length <= opts.splitAt) {
      emit(prefix, group)
      continue
    }
    // Oversized branch: list its two-segment sub-branches, pool the rest.
    const residual: Group = { rows: [], fileCount: 0, lastSeen: null }
    for (const [subPrefix, subGroup] of groupByPrefix(group.rows, 2)) {
      if (subGroup.rows.length >= 2) {
        branches.push({
          prefix: subPrefix,
          tagCount: subGroup.rows.length,
          fileCount: subGroup.fileCount,
          lastSeen: subGroup.lastSeen,
        })
      } else if (subGroup.rows[0].fileCount >= opts.minLoneFiles) {
        emit(subPrefix, subGroup)
      } else {
        residual.rows.push(...subGroup.rows)
        residual.fileCount += subGroup.fileCount
        if (subGroup.lastSeen && (!residual.lastSeen || subGroup.lastSeen > residual.lastSeen)) {
          residual.lastSeen = subGroup.lastSeen
        }
      }
    }
    if (residual.rows.length > 0) {
      branches.push({
        prefix,
        tagCount: residual.rows.length,
        fileCount: residual.fileCount,
        lastSeen: residual.lastSeen,
        residual: true,
      })
    }
  }

  // Alphabetical (by codepoint) so hierarchies cluster; the U+FFFF sentinel
  // sorts a residual after the children split out of it.
  const key = (b: TagBranch): string => b.prefix + (b.residual ? '\uffff' : '')
  branches.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))

  return { active, branches, unlisted }
}

// ---------------------------------------------------------------------------
// People (interaction-scored via notebook service)
// ---------------------------------------------------------------------------

const PEOPLE_LIMIT = 50

/**
 * Fetch people ranked by interaction score (frequency x recency) from the
 * running notebook service. Returns [] if the service is unreachable —
 * callers degrade to no people section, matching pre-people behavior.
 */
async function fetchPeopleWithScores(): Promise<Array<{ name: string }>> {
  try {
    const resp = await fetch(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ peopleWithScores { name } }' }),
    })
    if (!resp.ok) return []
    const json = (await resp.json()) as { data?: { peopleWithScores?: Array<{ name?: string }> } }
    return (json?.data?.peopleWithScores ?? []).filter((p): p is { name: string } => typeof p.name === 'string')
  } catch {
    return []
  }
}

/**
 * Merge interaction-scored raw names into canonical people via PeopleStore.
 *
 * Scores are keyed by names as written in who/from/to fields, so "Bob" and
 * "Bob Smith" arrive as separate entries; both resolve to the same person
 * file and collapse into one entry with aliases. Names with no person file
 * pass through as-is. Order (score rank) is preserved.
 */
export function mergeScoredPeople(
  scored: Array<{ name: string }>,
  store: PeopleStore | null,
  limit: number = PEOPLE_LIMIT,
): PersonEntity[] {
  const seenPaths = new Set<string>()
  const seenRaw = new Set<string>()
  const people: PersonEntity[] = []

  for (const { name } of scored) {
    if (people.length >= limit) break

    const found = store?.find(name)
    if (found) {
      if (seenPaths.has(found.path)) continue
      seenPaths.add(found.path)
      const canonical = found.value.name || name
      people.push({
        name: canonical,
        aliases: found.value.names.filter((n) => n !== canonical),
        title: found.value.title,
        org: found.value.org,
      })
    } else {
      const key = normalizeName(name)
      if (!key || seenRaw.has(key)) continue
      seenRaw.add(key)
      people.push({ name, aliases: [] })
    }
  }

  return people
}

/**
 * Gather the most-active people: service ranking + alias merge.
 * Never throws — degrades to [] (no service) or raw names (no people dirs).
 *
 * @param config - Notebook config (needs DIR_PEOPLE, DIR_PEOPLE_OLD)
 */
export async function gatherPeopleEntities(
  config: Record<string, unknown>,
  limit: number = PEOPLE_LIMIT,
): Promise<PersonEntity[]> {
  const scored = await fetchPeopleWithScores()
  if (scored.length === 0) return []

  let store: PeopleStore | null = null
  try {
    store = await PeopleStore.build([config.DIR_PEOPLE as string, config.DIR_PEOPLE_OLD as string])
  } catch {
    store = null
  }

  return mergeScoredPeople(scored, store, limit)
}

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

/**
 * Gather active entity context from the notebook.
 *
 * @param config - Notebook config (needs DIR_PROJECTS, DIR_DECISIONS, DIR_GOALS)
 */
export async function gatherEntityContext(config: Record<string, unknown>): Promise<EntityContext> {
  const [projectStore, decisionStore, goalStore, vocabulary, people] = await Promise.all([
    ProjectStore.build(config.DIR_PROJECTS as string),
    DecisionStore.build(config.DIR_DECISIONS as string),
    GoalStore.build(config.DIR_GOALS as string),
    fetchTagVocabulary(),
    gatherPeopleEntities(config),
  ])

  // Projects — open project names
  const projects = projectStore
    .getOpen()
    .getAll()
    .map((p) => p.name)
    .filter(Boolean)

  // Decisions — pending decision names
  const decisions = decisionStore
    .getPending()
    .getAll()
    .map((d) => d.name)
    .filter(Boolean)

  // Goals — "Area: Outcome"
  const goals = goalStore.getAllGoals().map((g) => `${g.area}: ${g.outcome}`)

  return { people, projects, decisions, goals, tags: buildTagVocabulary(vocabulary) }
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/** Render a person as `Canonical (aka Alias1, Alias2)` — alias part omitted when none. */
function formatPersonName(p: PersonEntity): string {
  return p.aliases.length > 0 ? `${p.name} (aka ${p.aliases.join(', ')})` : p.name
}

/**
 * Format EntityContext as a markdown block for prompt injection.
 * Empty sections are omitted; returns empty string if nothing to show.
 */
export function formatEntityContext(ctx: EntityContext): string {
  const sections: string[] = []

  if (ctx.people.length > 0) {
    sections.push(`### Active People (by recent interaction)\n${ctx.people.map(formatPersonName).join(', ')}`)
  }

  if (ctx.projects.length > 0) {
    sections.push(`### Open Projects\n${ctx.projects.join(', ')}`)
  }

  if (ctx.decisions.length > 0) {
    sections.push(`### Pending Decisions\n${ctx.decisions.join(', ')}`)
  }

  if (ctx.goals.length > 0) {
    const goalLines = ctx.goals.map((g) => `- ${g}`).join('\n')
    sections.push(`### Active Goals\n${goalLines}`)
  }

  const tagBlock = formatTagVocabulary(ctx.tags)
  if (tagBlock) sections.push(tagBlock)

  if (sections.length === 0) return ''

  return `## Active Notebook Entities\n\n${sections.join('\n\n')}`
}

/** `(23 files, last 2026-07)` — the annotation shared by entries and branches. */
function annotate(fileCount: number, lastSeen: string | null, countLabel?: string): string {
  const parts = [countLabel ? `${countLabel}, ${fileCount} files` : `${fileCount} files`]
  if (lastSeen) parts.push(`last ${lastSeen.slice(0, 7)}`)
  return `(${parts.join(', ')})`
}

/**
 * Render the tag vocabulary: the active list, then the rolled-up long tail,
 * then a count of what remains unlisted. Returns empty string when there is
 * nothing to show.
 */
export function formatTagVocabulary(tags: TagVocabulary): string {
  if (tags.active.length === 0 && tags.branches.length === 0) return ''

  const paragraphs: string[] = []

  if (tags.active.length > 0) {
    const entries = tags.active.map((t) => `${t.name} ${annotate(t.fileCount, t.lastSeen)}`)
    paragraphs.push(`Most active: ${entries.join(', ')}`)
  }

  if (tags.branches.length > 0) {
    const entries = tags.branches.map((b) => {
      if (b.tagCount === 1) return `${b.prefix} ${annotate(b.fileCount, b.lastSeen)}`
      const countLabel = b.residual ? `${b.tagCount} other tags` : `${b.tagCount} tags`
      return `${b.prefix}/… ${annotate(b.fileCount, b.lastSeen, countLabel)}`
    })
    paragraphs.push(`Older and rarer (open a branch with tagsStartsWith): ${entries.join(', ')}`)
  }

  if (tags.unlisted > 0) {
    paragraphs.push(`Plus ${tags.unlisted} one-off tags not listed.`)
  }

  return `### Tag Vocabulary\n${paragraphs.join('\n\n')}`
}

/**
 * Format people as a standalone block for the chat system prompt — one line
 * per person with title/org so the answering model knows who "Bob" is.
 * Returns empty string when there are no people.
 */
export function formatPeopleBlock(people: PersonEntity[]): string {
  if (people.length === 0) return ''

  const lines = people.map((p) => {
    const role = [p.title, p.org].filter(Boolean).join(', ')
    return role ? `- ${formatPersonName(p)} — ${role}` : `- ${formatPersonName(p)}`
  })

  return lines.join('\n')
}
