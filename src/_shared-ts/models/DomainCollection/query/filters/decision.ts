/**
 * Decision-related filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if decision is pending (no 'decided' field).
 */
export function matchesPending(doc: Document): boolean {
  const decided = doc.yaml['decided']
  return decided === undefined || decided === null
}

/**
 * Check if decision is decided (has 'decided' field).
 */
export function matchesDecided(doc: Document): boolean {
  const decided = doc.yaml['decided']
  return decided !== undefined && decided !== null
}
