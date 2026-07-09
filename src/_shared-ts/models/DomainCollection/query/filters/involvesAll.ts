/**
 * All-of person involvement filter predicate.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesInvolves, type NameResolver } from './involves.ts'

/**
 * Check if ALL of the given people are involved in the document (AND) —
 * e.g. threads between two specific people. Not expressible by combining
 * single-involves queries: two query blocks give the union, never the
 * intersection.
 *
 * @example matchesInvolvesAll(doc, ["Alice Smith", "Bob Jones"])
 */
export function matchesInvolvesAll(doc: Document, names: string[], resolveNames?: NameResolver): boolean {
  return names.every((name) => matchesInvolves(doc, name, resolveNames))
}
