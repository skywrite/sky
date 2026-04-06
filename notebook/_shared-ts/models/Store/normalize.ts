/**
 * Normalize a name for lookup.
 * - Lowercase
 * - Trim whitespace
 * - Collapse multiple spaces to single space
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, ' ')
}
