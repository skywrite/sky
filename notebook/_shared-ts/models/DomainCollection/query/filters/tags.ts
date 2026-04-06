/**
 * Tag-related filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if any tag starts with the given prefix.
 *
 * @example matchesTagPrefix(doc, "Acme/") // matches "Acme/M&A", "Acme/Legal"
 */
export function matchesTagPrefix(doc: Document, prefix: string): boolean {
  for (const tag of doc.tags) {
    if (tag.startsWith(prefix)) return true
  }
  return false
}

/**
 * Check if tags contain the exact tag.
 *
 * @example matchesTagContains(doc, "Finance") // matches if "Finance" is in tags
 */
export function matchesTagContains(doc: Document, tag: string): boolean {
  return doc.tags.has(tag)
}

/**
 * Check if tags contain ANY of the given tags (OR).
 *
 * @example matchesTagContainsAny(doc, ["Finance", "Legal"]) // true if either tag present
 */
export function matchesTagContainsAny(doc: Document, tags: string[]): boolean {
  for (const tag of tags) {
    if (doc.tags.has(tag)) return true
  }
  return false
}

/**
 * Check if tags contain ALL of the given tags (AND).
 *
 * @example matchesTagContainsAll(doc, ["Finance", "Legal"]) // true only if both present
 */
export function matchesTagContainsAll(doc: Document, tags: string[]): boolean {
  for (const tag of tags) {
    if (!doc.tags.has(tag)) return false
  }
  return true
}
