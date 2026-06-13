/**
 * Gathers active notebook entities (people, projects, decisions, goals, tags)
 * for injection into AI context prompts so the AI can match informal user
 * phrasing to real entity names.
 *
 * People come from the notebook service's interaction-scored ranking
 * (frequency x recency), then get alias-merged through PeopleStore so the
 * AI sees "Bob Smith (aka Bob)" rather than raw name strings.
 */

import ProjectStore from '#shared/models/Store/ProjectStore/mod.ts'
import DecisionStore from '#shared/models/Store/DecisionStore/mod.ts'
import GoalStore from '#shared/models/Store/GoalStore/mod.ts'
import PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { normalizeName } from '#shared/models/Store/normalize.ts'
import { PORT_SERVER } from '#shared/config.ts'
import type CommandService from '#commands/lib/core/CommandService.ts'

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

export interface EntityContext {
  people: PersonEntity[]
  projects: string[]
  decisions: string[]
  goals: string[]
  recentTags: string[]
}

// ---------------------------------------------------------------------------
// Tag query (recent 6 months)
// ---------------------------------------------------------------------------

const TAGS_QUERY = `{
  meetings(where: {recent: "6mo"}, limit: 2000) { tags }
  messages(where: {recent: "6mo"}, limit: 2000) { tags }
  journals(where: {recent: "6mo"}, limit: 2000) { tags }
}`

/** Tag arrays grouped by document type, as returned by either the service or markdown:sel. */
type TagCollections = Record<string, Array<{ tags?: string[] }>>

/**
 * Fetch recent-document tags from the running notebook service.
 *
 * The service answers from its in-memory store (~0.2s); running the same
 * query locally rebuilds the full ~20k-file MarkdownStore from scratch
 * (~20s). Returns null when unreachable so the caller can fall back to a
 * local build.
 */
async function fetchTagsFromServer(): Promise<TagCollections | null> {
  try {
    const resp = await fetch(`http://localhost:${PORT_SERVER}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TAGS_QUERY }),
    })
    if (!resp.ok) return null
    const json = (await resp.json()) as { data?: TagCollections }
    return json?.data ?? null
  } catch {
    return null
  }
}

/** Flatten tag arrays across document types into a sorted, deduplicated list. */
export function dedupeTags(data: TagCollections): string[] {
  const allTags: string[] = []
  for (const collection of Object.values(data)) {
    if (!Array.isArray(collection)) continue
    for (const doc of collection) {
      if (Array.isArray(doc.tags)) allTags.push(...doc.tags)
    }
  }
  return [...new Set(allTags)].sort()
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
 * @param tasks  - CommandService for the local tags fallback when the service is down
 */
export async function gatherEntityContext(
  config: Record<string, unknown>,
  tasks: CommandService,
): Promise<EntityContext> {
  const [projectStore, decisionStore, goalStore, serverTags, people] = await Promise.all([
    ProjectStore.build(config.DIR_PROJECTS as string),
    DecisionStore.build(config.DIR_DECISIONS as string),
    GoalStore.build(config.DIR_GOALS as string),
    fetchTagsFromServer(),
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

  // Tags — prefer the running service; fall back to a local build only when
  // it's down (the slow path that used to run on every call).
  let tagData = serverTags
  if (!tagData) {
    const tagResult = await tasks.run('markdown:sel', { graphql: TAGS_QUERY, json: true })
    if (tagResult.ok && tagResult.data?.data) {
      tagData = tagResult.data.data as TagCollections
    }
  }
  const recentTags = tagData ? dedupeTags(tagData) : []

  return { people, projects, decisions, goals, recentTags }
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

  if (ctx.recentTags.length > 0) {
    sections.push(`### Recent Tags (last 6 months)\n${ctx.recentTags.join(', ')}`)
  }

  if (sections.length === 0) return ''

  return `## Active Notebook Entities\n\n${sections.join('\n\n')}`
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
