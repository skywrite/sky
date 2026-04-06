/**
 * Person involvement filter predicate.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'

/**
 * Resolves a name to all known names for a person.
 * e.g., "JW" → ["James Robert Wheeler", "JW", "Jim Wheeler"]
 */
export type NameResolver = (name: string) => string[]

/**
 * Check if a person is involved in the document.
 * Checks: who, from, to, rel, name fields.
 *
 * When a NameResolver is provided, the input name is expanded to all known
 * aliases for the person (via PeopleStore), so "AJ" matches docs with
 * from: "Alice Johnson".
 *
 * @example matchesInvolves(doc, "Alice Smith")
 * @example matchesInvolves(doc, "AJ", resolveNames)
 */
export function matchesInvolves(doc: Document, name: string, resolveNames?: NameResolver): boolean {
  if (!name) return false

  const namesToCheck = resolveNames ? resolveNames(name) : [name]
  const yaml = doc.yaml

  for (const n of namesToCheck) {
    const nameLower = n.toLowerCase()

    // Check 'who' field (meetings, events)
    if (fieldContainsName(yaml['who'], nameLower)) return true

    // Check 'from' field (messages)
    if (fieldContainsName(yaml['from'], nameLower)) return true

    // Check 'to' field (messages)
    if (fieldContainsName(yaml['to'], nameLower)) return true

    // Check 'rel' field
    for (const r of doc.rel) {
      if (typeof r === 'string' && r.toLowerCase().includes(nameLower)) return true
    }

    // Check 'name' field (people, orgs)
    if (fieldContainsName(yaml['name'], nameLower)) return true
  }

  return false
}

/**
 * Helper to check if a field value contains a name.
 * Handles string, array, and comma-separated values.
 */
function fieldContainsName(value: unknown, nameLower: string): boolean {
  if (typeof value === 'string') {
    // Could be comma-separated
    const parts = value.split(',').map((s) => s.trim().toLowerCase())
    return parts.some((p) => p.includes(nameLower))
  }

  if (Array.isArray(value)) {
    return value.some((v) => typeof v === 'string' && v.toLowerCase().includes(nameLower))
  }

  return false
}
