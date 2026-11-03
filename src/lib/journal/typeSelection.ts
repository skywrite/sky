/** A recorded journal may introduce a type; keep it one tag and reuse established spellings. */
export function selectedJournalTypes(values: unknown, known: string[]): string[] {
  if (!Array.isArray(values)) throw new Error('Choose the journal types to create.')
  const key = (name: string) => name.replaceAll(' ', '-').toLowerCase()
  const established = new Map(known.map((name) => [key(name), name]))
  const selected = new Map<string, string>()
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim())
      throw new Error('Enter a type for each selected journal, or uncheck it.')
    if (/[;\r\n/\\]/.test(value))
      throw new Error(`Journal type “${value}” cannot include slashes, semicolons, or line breaks.`)
    const name = value.trim().replace(/[\t ]+/g, ' ')
    const canonical = established.get(key(name)) ?? name
    if (!selected.has(key(canonical))) selected.set(key(canonical), canonical)
  }
  return [...selected.values()]
}
