import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesExact } from '../filters/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type InvolvesFilter,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getOptionalStringField,
  getStringField,
  matchesActivityFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface GoalFilter extends TagFilter, TextFilter, InvolvesFilter, ActivityFilter {
  nameContains?: string
  status?: string
}

export function matchesGoalFilter(doc: Document, filter: GoalFilter, resolveNames?: NameResolver): boolean {
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.status && !matchesExact(doc, 'status', filter.status)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

export function docToGoal(doc: Document, path: string) {
  return {
    name: getStringField(doc, 'name'),
    status: getOptionalStringField(doc, 'status'),
    ...docBase(doc, path),
  }
}

export default {
  type: 'goal',
  matches: (doc, filter, path, ctx) => matchesGoalFilter(doc, filter, ctx.resolveNames),
  mapper: () => perRow(docToGoal),
} satisfies EntitySpec<GoalFilter, ReturnType<typeof docToGoal>>
