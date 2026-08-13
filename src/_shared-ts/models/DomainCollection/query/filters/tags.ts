/**
 * Tag-related filter predicates.
 *
 * Matching folds case. Storage does not — `doc.tags` keeps whatever the YAML
 * wrote, so display and round-trips stay case-preserving. Only comparison
 * lowercases, matching what body/involves/rel/field already do; tags were the
 * lone case-sensitive filter here. Casing drifts in practice (`Acme` vs
 * `ACME`), and a case miss returned `[]` — indistinguishable from "no data".
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/** A document's tags, lowercased for comparison. */
function lowerTags(doc: Document): Set<string> {
  const lowered = new Set<string>()
  for (const tag of doc.tags) lowered.add(tag.toLowerCase())
  return lowered
}

/**
 * Check if any tag is in the given namespace, ignoring case.
 *
 * A namespace root belongs to its own namespace: the bare tag `Acme` answers
 * a query for `Acme/`. That falls out of comparing against `tag + '/'` — the
 * appended separator can only add a match where the prefix is exactly the tag
 * plus one `/`, so `Acme/M&A` still matches and `Acmes` still does not.
 * Without it, a doc marked only with the root is invisible to every query for
 * its own namespace.
 *
 * @example matchesTagPrefix(doc, "Acme/") // matches "Acme/M&A", "acme/legal", "Acme"
 */
export function matchesTagPrefix(doc: Document, prefix: string): boolean {
  const prefixLower = prefix.toLowerCase()
  for (const tag of doc.tags) {
    if (`${tag.toLowerCase()}/`.startsWith(prefixLower)) return true
  }
  return false
}

/**
 * Check if tags contain the given tag, ignoring case.
 *
 * @example matchesTagContains(doc, "Finance") // matches "Finance", "finance", "FINANCE"
 */
export function matchesTagContains(doc: Document, tag: string): boolean {
  return lowerTags(doc).has(tag.toLowerCase())
}

/**
 * Check if tags contain ANY of the given tags (OR), ignoring case.
 *
 * @example matchesTagContainsAny(doc, ["Finance", "Legal"]) // true if either tag present
 */
export function matchesTagContainsAny(doc: Document, tags: string[]): boolean {
  const docTags = lowerTags(doc)
  for (const tag of tags) {
    if (docTags.has(tag.toLowerCase())) return true
  }
  return false
}

/**
 * Check if tags contain ALL of the given tags (AND), ignoring case.
 *
 * @example matchesTagContainsAll(doc, ["Finance", "Legal"]) // true only if both present
 */
export function matchesTagContainsAll(doc: Document, tags: string[]): boolean {
  const docTags = lowerTags(doc)
  for (const tag of tags) {
    if (!docTags.has(tag.toLowerCase())) return false
  }
  return true
}
