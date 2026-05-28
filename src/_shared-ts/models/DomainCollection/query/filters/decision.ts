/**
 * Decision-related filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if decision is pending (no 'resolved' field).
 * Mirrors DecisionDocument.isPending: pending = !resolved.
 */
export function matchesPending(doc: Document): boolean {
  const resolved = doc.yaml['resolved']
  return resolved === undefined || resolved === null
}

/**
 * Check if decision is decided/resolved (has 'resolved' field).
 * Mirrors !DecisionDocument.isPending.
 */
export function matchesDecided(doc: Document): boolean {
  const resolved = doc.yaml['resolved']
  return resolved !== undefined && resolved !== null
}
