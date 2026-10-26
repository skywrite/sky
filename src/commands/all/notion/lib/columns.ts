import type { NotionValue } from '#lib/notion/mod.ts'

type Row = Record<string, NotionValue>

/** One row's columns, or null when a value is not one Notion takes. A checkbox may come as true or false. */
function rowOf(body: unknown): Row | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const row: Row = {}
  for (const [name, value] of Object.entries(body)) {
    if (value === null || typeof value === 'string' || typeof value === 'number') row[name] = value
    else if (typeof value === 'boolean') row[name] = value ? '__YES__' : '__NO__'
    else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) row[name] = value
    else return null
  }
  return row
}

function parsed(json: string): { body: unknown } | null {
  try {
    return { body: JSON.parse(json) }
  } catch {
    return null
  }
}

/** A row's columns out of JSON: an object of column name to value. A failure is a sentence for the person. */
export function columnsOf(json: string): Row | string {
  const read = parsed(json)
  if (!read) return `The properties are not JSON: ${json.trim().slice(0, 80)}`
  return rowOf(read.body) ?? 'The properties must be an object of column name to value, like {"Status": "Done"}.'
}

/** Rows out of JSON: a list of objects, one per row. A failure is a sentence for the person. */
export function rowsOf(json: string): Row[] | string {
  const read = parsed(json)
  if (!read) return `The rows are not JSON: ${json.trim().slice(0, 80)}`
  if (!Array.isArray(read.body))
    return 'The rows must be a JSON list with one object per row, like [{"Name": "Atlas", "Status": "Done"}].'
  const rows = read.body.map(rowOf)
  const bad = rows.findIndex((row) => row === null)
  if (bad >= 0) return `Row ${bad + 1} must be an object of column name to value, like {"Name": "Atlas"}.`
  return rows as Row[]
}

/** Notion's CREATE TABLE statement for the columns as given; none gives a table with a Name column alone. */
export function schemaOf(columns: string | undefined): string {
  const text = columns?.trim()
  if (!text) return 'CREATE TABLE ("Name" TITLE)'
  if (/^create\s+table\b/i.test(text)) return text
  return `CREATE TABLE (${text.replace(/^\(([\s\S]*)\)$/, '$1').trim()})`
}
