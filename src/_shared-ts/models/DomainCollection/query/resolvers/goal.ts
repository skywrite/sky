import GoalDocument, { goalNameFromPath, goalStatusFromPath } from '#shared/models/Goal/mod.ts'
import type { Document } from '#shared/models/Markdown/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type InvolvesFilter,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  matchesActivityFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface GoalFilter extends TagFilter, TextFilter, InvolvesFilter, ActivityFilter {
  name?: string
  nameContains?: string
  titleContains?: string
  status?: string
}

/**
 * Constructed rather than cast, like streaks: outside fromStore (mock stores,
 * fromDocuments-built collections) a path-detected goal is a plain Document,
 * and the title needs real GoalDocument behavior.
 */
function toGoalDocument(doc: Document): GoalDocument {
  return doc instanceof GoalDocument ? doc : new GoalDocument(doc.yaml, doc.markdown, doc.yamlError)
}

const contains = (value: string, part: string) => value.toLowerCase().includes(part.toLowerCase())

/** Name and status are path-derived for goals, like streaks: the file says neither. */
export function matchesGoalFilter(
  doc: Document,
  filter: GoalFilter,
  path: string,
  resolveNames?: NameResolver,
): boolean {
  const name = goalNameFromPath(path)
  if (filter.name && name.toLowerCase() !== filter.name.toLowerCase()) return false
  if (filter.nameContains && !contains(name, filter.nameContains)) return false
  if (filter.titleContains && !contains(toGoalDocument(doc).title, filter.titleContains)) return false
  if (filter.status && goalStatusFromPath(path) !== filter.status) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

export function docToGoal(doc: Document, path: string) {
  const goal = toGoalDocument(doc)
  return {
    name: goalNameFromPath(path),
    title: goal.title,
    status: goalStatusFromPath(path),
    category: goal.category,
    ...docBase(doc, path),
  }
}

export default {
  type: 'goal',
  matches: (doc, filter, path, ctx) => matchesGoalFilter(doc, filter, path, ctx.resolveNames),
  mapper: () => perRow(docToGoal),
} satisfies EntitySpec<GoalFilter, ReturnType<typeof docToGoal>>
