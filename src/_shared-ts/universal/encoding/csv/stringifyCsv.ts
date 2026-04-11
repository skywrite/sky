/**
 * Convert an array of records into a CSV string.
 *
 * @param records - Array of objects to stringify
 * @param columns - Column names (controls order and header row)
 * @returns CSV string with header row and trailing newline
 *
 * @example
 * ```ts
 * const csv = stringifyCsv(
 *   [{ name: 'Alice', age: '30' }, { name: 'Bob', age: '25' }],
 *   ['name', 'age'],
 * )
 * // "name,age\nAlice,30\nBob,25\n"
 * ```
 */
export function stringifyCsv(records: Record<string, unknown>[], columns: string[]): string {
  const lines: string[] = [columns.join(',')]

  for (const record of records) {
    const row = columns.map((col) => quoteField(record[col]))
    lines.push(row.join(','))
  }

  return lines.join('\n') + '\n'
}

function quoteField(value: unknown): string {
  if (value === undefined || value === null) return ''

  const str = String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}
