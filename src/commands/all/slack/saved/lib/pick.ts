/** Parse a --capture value: "all", or 1-based comma-separated indexes into [0-based]. */
export function parseSelection(value: string, count: number): number[] | 'all' | undefined {
  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'all') return 'all'
  const indexes: number[] = []
  for (const part of trimmed.split(',')) {
    const n = Number.parseInt(part.trim(), 10)
    if (!Number.isInteger(n) || n < 1 || n > count) return undefined
    const zeroBased = n - 1
    if (!indexes.includes(zeroBased)) indexes.push(zeroBased)
  }
  return indexes.length > 0 ? indexes : undefined
}
