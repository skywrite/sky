/**
 * Any-of person involvement filter predicate.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesInvolves, type NameResolver } from './involves.ts'

/**
 * Check if ANY of the given people is involved in the document (OR).
 *
 * @example matchesInvolvesAny(doc, ["Alice Smith", "Bob Jones"])
 */
export function matchesInvolvesAny(doc: Document, names: string[], resolveNames?: NameResolver): boolean {
  return names.some((name) => matchesInvolves(doc, name, resolveNames))
}
