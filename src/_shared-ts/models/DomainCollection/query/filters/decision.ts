/**
 * Decision-related filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if decision is pending (no 'decided' field).
 * Mirrors DecisionDocument.isPending: pending = not made yet (no decided date, not in force).
 */
export function matchesPending(doc: Document): boolean {
  const decided = doc.yaml['decided']
  return (decided === undefined || decided === null) && !matchesInForce(doc)
}

/**
 * Check if decision is in force (the `inForce: true` flag).
 * Mirrors DecisionDocument.inForce.
 */
export function matchesInForce(doc: Document): boolean {
  return doc.yaml['inForce'] === true
}

/**
 * Check if decision is decided (has a 'decided' field, or is in force).
 * Mirrors !DecisionDocument.isPending.
 */
export function matchesDecided(doc: Document): boolean {
  const decided = doc.yaml['decided']
  return (decided !== undefined && decided !== null) || matchesInForce(doc)
}

/**
 * Check if the decision was made on or after `start` (YYYY-MM-DD), by the day its 'decided' date names.
 * A pending decision has none and never matches.
 */
export function matchesDecidedGte(doc: Document, start: string): boolean {
  const decided = doc.yaml['decided']
  const day = typeof decided === 'string' ? /^\d{4}-\d{2}-\d{2}/.exec(decided.trim())?.[0] : undefined
  return day !== undefined && day >= start
}
