import { parseCsvLine } from '#universal/encoding/csv/mod.ts'

const PLAIN_NUMBER_RE = /^-?\d+(\.\d+)?$/

/**
 * CSV text → a Sheets values 2D array (header row included), so pasted table
 * data reaches set_values verbatim instead of being hand-transcribed by the
 * model. Plain numerics become numbers; everything else stays a string —
 * USER_ENTERED input parsing handles formatted values ("$1,200", "12%")
 * on Google's side. Rows are line-based (no embedded newlines in quoted
 * fields — same limit as the repo's CSV parsing generally).
 */
export function csvToValues(csv: string): Array<Array<string | number>> {
  const rows: Array<Array<string | number>> = []
  for (const line of csv.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const fields = parseCsvLine(line)
    rows.push(fields.map((field) => (PLAIN_NUMBER_RE.test(field) ? Number(field) : field)))
  }
  return rows
}
