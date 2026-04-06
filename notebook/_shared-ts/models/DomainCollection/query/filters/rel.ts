/**
 * Relationship (rel) field filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if rel field contains a specific reference.
 * Useful for finding documents that reference a project, decision, etc.
 *
 * @example matchesRelContains(doc, "projects/Acme-Pay-GTM")
 * @example matchesRelContains(doc, "decisions/Hire-CTO")
 */
export function matchesRelContains(doc: Document, ref: string): boolean {
  if (!ref) return false
  const refLower = ref.toLowerCase()

  for (const r of doc.rel) {
    if (typeof r === 'string' && r.toLowerCase().includes(refLower)) return true
  }

  return false
}

/**
 * Check if rel field contains a reference with a specific prefix.
 * Useful for finding all documents that reference any project, decision, etc.
 *
 * @example matchesRelPrefix(doc, "projects/") // any project reference
 * @example matchesRelPrefix(doc, "decisions/") // any decision reference
 */
export function matchesRelPrefix(doc: Document, prefix: string): boolean {
  if (!prefix) return false

  for (const r of doc.rel) {
    if (typeof r === 'string' && r.startsWith(prefix)) return true
  }

  return false
}
