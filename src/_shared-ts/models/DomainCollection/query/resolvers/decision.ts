import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesContains, matchesDateGte, matchesDateLte, matchesDecided, matchesPending } from '../filters/mod.ts'
import {
  type ActivityFilter,
  type EntitySpec,
  type InvolvesFilter,
  type NameResolver,
  type TagFilter,
  type TextFilter,
  docBase,
  getField,
  getOptionalStringField,
  getStringField,
  matchesActivityFilter,
  matchesInvolvesFilter,
  matchesTagFilter,
  matchesTextFilter,
  perRow,
} from './shared.ts'

export interface DecisionFilter extends TagFilter, TextFilter, InvolvesFilter, ActivityFilter {
  nameContains?: string
  pending?: boolean
  decided?: boolean
  identifiedGte?: string
  identifiedLte?: string
}

export function matchesDecisionFilter(doc: Document, filter: DecisionFilter, resolveNames?: NameResolver): boolean {
  if (filter.nameContains && !matchesContains(doc, 'name', filter.nameContains)) return false
  if (filter.pending === true && !matchesPending(doc)) return false
  if (filter.decided === true && !matchesDecided(doc)) return false
  // Each bound applies on its own — same one-ended contract as dateGte/dateLte.
  if (filter.identifiedGte && !matchesDateGte(doc, filter.identifiedGte)) return false
  if (filter.identifiedLte && !matchesDateLte(doc, filter.identifiedLte)) return false
  if (!matchesTagFilter(doc, filter)) return false
  if (!matchesInvolvesFilter(doc, filter, resolveNames)) return false
  if (!matchesTextFilter(doc, filter)) return false
  if (!matchesActivityFilter(doc, filter)) return false
  return true
}

export function docToDecision(doc: Document, path: string) {
  const resolved = getField(doc, 'resolved')
  const identified = getField(doc, 'identified')
  const target = getField(doc, 'target')
  return {
    name: getStringField(doc, 'name'),
    summary: getOptionalStringField(doc, 'summary'),
    identified: identified != null ? String(identified) : null,
    target: target != null ? String(target) : null,
    resolved: resolved != null ? String(resolved) : null,
    isPending: !resolved,
    ...docBase(doc, path),
  }
}

export default {
  type: 'decision',
  matches: (doc, filter, path, ctx) => matchesDecisionFilter(doc, filter, ctx.resolveNames),
  mapper: () => perRow(docToDecision),
} satisfies EntitySpec<DecisionFilter, ReturnType<typeof docToDecision>>
