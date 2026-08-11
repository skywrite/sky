/**
 * Utility functions for filtering and matching completion items.
 */

/**
 * Filter items by case-insensitive prefix match.
 *
 * @param items - Array of strings to filter
 * @param prefix - Search prefix to match against
 * @returns Filtered array of items that start with the prefix (case-insensitive)
 *
 * @example
 * filterByPrefix(['Apple', 'Banana', 'Avocado'], 'ap')
 * // Returns: ['Apple', 'Avocado']
 */
export function filterByPrefix(items: string[], prefix: string): string[] {
  if (!prefix) {
    return items
  }

  const lowerPrefix = prefix.toLowerCase()
  return items.filter((item) => item.slice(0, prefix.length).toLowerCase() === lowerPrefix)
}
