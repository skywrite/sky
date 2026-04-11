/**
 * Generic field-matching filter predicates.
 */

import type { Document } from '#shared/models/Markdown/mod.ts'
import { matchesTagPrefix } from './tags.ts'

/**
 * Check if a field exactly equals a value.
 *
 * @example matchesExact(doc, "medium", "Zoom")
 * @example matchesExact(doc, "year", 2025)
 */
export function matchesExact(doc: Document, field: string, value: unknown): boolean {
  const fieldValue = doc.yaml[field]

  // Handle number comparison (year, month, etc.)
  if (typeof value === 'number') {
    return fieldValue === value || fieldValue === String(value)
  }

  // Handle string comparison
  if (typeof value === 'string') {
    return fieldValue === value || String(fieldValue) === value
  }

  // Handle boolean
  if (typeof value === 'boolean') {
    return fieldValue === value || fieldValue === String(value)
  }

  return fieldValue === value
}

/**
 * Check if an array field contains a value.
 * Works with arrays, comma-separated strings, and ImmutableSet.
 *
 * @example matchesContains(doc, "who", "Alice Smith")
 * @example matchesContains(doc, "tags", "Finance")
 */
export function matchesContains(doc: Document, field: string, value: string): boolean {
  if (!value) return false

  // Special handling for tags
  if (field === 'tags') {
    return doc.tags.has(value)
  }

  // Special handling for rel
  if (field === 'rel') {
    return doc.rel.has(value)
  }

  const fieldValue = doc.yaml[field]
  if (fieldValue == null) return false
  const valueLower = value.toLowerCase()

  if (typeof fieldValue === 'string') {
    // Could be comma-separated
    const parts = fieldValue.split(',').map((s) => s.trim().toLowerCase())
    return parts.some((p) => p === valueLower || p.includes(valueLower))
  }

  if (Array.isArray(fieldValue)) {
    return fieldValue.some(
      (v) => typeof v === 'string' && (v.toLowerCase() === valueLower || v.toLowerCase().includes(valueLower)),
    )
  }

  return false
}

/**
 * Check if a field starts with a prefix.
 *
 * @example matchesPrefix(doc, "tags", "Acme/")
 */
export function matchesPrefix(doc: Document, field: string, prefix: string): boolean {
  // Special handling for tags
  if (field === 'tags') {
    return matchesTagPrefix(doc, prefix)
  }

  const fieldValue = doc.yaml[field]

  if (typeof fieldValue === 'string') {
    return fieldValue.startsWith(prefix)
  }

  if (Array.isArray(fieldValue)) {
    return fieldValue.some((v) => typeof v === 'string' && v.startsWith(prefix))
  }

  return false
}

/**
 * Check if a field ends with a suffix.
 *
 * @example matchesSuffix(doc, "name", "Smith")
 */
export function matchesSuffix(doc: Document, field: string, suffix: string): boolean {
  const fieldValue = doc.yaml[field]

  if (typeof fieldValue === 'string') {
    return fieldValue.endsWith(suffix)
  }

  if (Array.isArray(fieldValue)) {
    return fieldValue.some((v) => typeof v === 'string' && v.endsWith(suffix))
  }

  return false
}

/**
 * Check if a field contains a substring.
 *
 * @example matchesSubstring(doc, "summary", "partnership")
 */
export function matchesSubstring(doc: Document, field: string, substring: string): boolean {
  if (!substring) return false
  const fieldValue = doc.yaml[field]
  if (fieldValue == null) return false
  const substringLower = substring.toLowerCase()

  if (typeof fieldValue === 'string') {
    return fieldValue.toLowerCase().includes(substringLower)
  }

  if (Array.isArray(fieldValue)) {
    return fieldValue.some((v) => typeof v === 'string' && v.toLowerCase().includes(substringLower))
  }

  return false
}

/**
 * Check if a field is null/undefined/missing.
 *
 * @example matchesNull(doc, "org") // person without org
 * @example matchesNull(doc, "decided") // pending decision
 */
export function matchesNull(doc: Document, field: string): boolean {
  const value = doc.yaml[field]
  return value === undefined || value === null
}
