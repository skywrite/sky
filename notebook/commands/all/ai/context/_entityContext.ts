/**
 * Gathers active notebook entities (projects, decisions, goals, tags) for
 * injection into AI context prompts so the AI can match informal user
 * phrasing to real entity names.
 */

import ProjectStore from '#shared/models/Store/ProjectStore/mod.ts'
import DecisionStore from '#shared/models/Store/DecisionStore/mod.ts'
import GoalStore from '#shared/models/Store/GoalStore/mod.ts'
import type CommandService from '#commands/lib/core/CommandService.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EntityContext {
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

// ---------------------------------------------------------------------------
// Gather
// ---------------------------------------------------------------------------

/**
 * Gather active entity context from the notebook.
 *
 * @param config - Notebook config (needs DIR_PROJECTS, DIR_DECISIONS, DIR_GOALS)
 * @param tasks  - CommandService for running sub-tasks (markdown:sel)
 */
export async function gatherEntityContext(
  config: Record<string, unknown>,
  tasks: CommandService,
): Promise<EntityContext> {
  const [projectStore, decisionStore, goalStore, tagResult] = await Promise.all([
    ProjectStore.build(config.DIR_PROJECTS as string),
    DecisionStore.build(config.DIR_DECISIONS as string),
    GoalStore.build(config.DIR_GOALS as string),
    tasks.run('markdown:sel', { graphql: TAGS_QUERY, json: true }),
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

  // Tags — deduplicated from recent documents
  let recentTags: string[] = []
  if (tagResult.ok && tagResult.data?.data) {
    const data = tagResult.data.data as Record<string, Array<{ tags?: string[] }>>
    const allTags: string[] = []
    for (const collection of Object.values(data)) {
      if (!Array.isArray(collection)) continue
      for (const doc of collection) {
        if (Array.isArray(doc.tags)) {
          allTags.push(...doc.tags)
        }
      }
    }
    recentTags = [...new Set(allTags)].sort()
  }

  return { projects, decisions, goals, recentTags }
}

// ---------------------------------------------------------------------------
// Format
// ---------------------------------------------------------------------------

/**
 * Format EntityContext as a markdown block for prompt injection.
 * Empty sections are omitted; returns empty string if nothing to show.
 */
export function formatEntityContext(ctx: EntityContext): string {
  const sections: string[] = []

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
