/**
 * Body/markdown content filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Check if body (markdown content) contains text.
 *
 * @example matchesBodyContains(doc, "partnership")
 */
export function matchesBodyContains(doc: Document, text: string): boolean {
  if (!text) return false
  return doc.markdown.toLowerCase().includes(text.toLowerCase())
}

/**
 * Check if body matches a regex pattern.
 *
 * @example matchesBodyMatches(doc, "quarterly.*review")
 */
export function matchesBodyMatches(doc: Document, pattern: string): boolean {
  if (!pattern) return false
  const regex = new RegExp(pattern, 'i')
  return regex.test(doc.markdown)
}
