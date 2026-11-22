/**
 * Decision-related filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if decision is pending (no 'resolved' field).
 * Mirrors DecisionDocument.isPending: pending = not made yet (no resolved date, not in force).
 */
export function matchesPending(doc: Document): boolean {
  const resolved = doc.yaml['resolved']
  return (resolved === undefined || resolved === null) && !matchesInForce(doc)
}

/**
 * Check if decision is in force (the `inForce: true` flag).
 * Mirrors DecisionDocument.inForce.
 */
export function matchesInForce(doc: Document): boolean {
  return doc.yaml['inForce'] === true
}

/**
 * Check if decision is decided/resolved (has 'resolved' field).
 * Mirrors !DecisionDocument.isPending.
 */
export function matchesDecided(doc: Document): boolean {
  const resolved = doc.yaml['resolved']
  return (resolved !== undefined && resolved !== null) || matchesInForce(doc)
}
