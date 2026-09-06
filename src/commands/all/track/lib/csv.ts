import * as path from 'node:path'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/registry.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { DAY_LETTERS } from './records.ts'

export interface TrackingCsv {
  header: string[]
  rows: string[][]
  warnings: string[]
}

/** Tracking's historical contract is one entry per physical line. */
function fields(line: string, repair: boolean): { values: string[]; repaired: boolean } {
  const values: string[] = []
  let i = 0
  let repaired = false
  while (i <= line.length) {
    while (line[i] === ' ' || line[i] === '\t') i++
    let value = ''
    if (line[i] === '"') {
      i++
      let closed = false
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"'
            i += 2
          } else {
            i++
            closed = true
            break
          }
        } else value += line[i++]
      }
      if (!closed) {
        if (!repair) throw new Error('Unclosed CSV quote')
        repaired = true
      }
      while (line[i] === ' ' || line[i] === '\t') i++
      if (i < line.length && line[i] !== ',') throw new Error('Unexpected text after a CSV quote')
    } else {
      while (i < line.length && line[i] !== ',') value += line[i++]
      value = value.trim()
    }
    values.push(value)
    if (i >= line.length) break
    i++
  }
  return { values, repaired }
}

export function weeklyMonday(relativePath: string): PlainDate {
  const [weekPath] = relativePath.split(`${path.sep}_tracking${path.sep}`)
  for (const layout of ALL_LAYOUTS) {
    const span = layout.parseTimePath(path.join('/time', weekPath, 'week.md'))
    if (span?.kind === 'week') return Week.of(span.start).start
  }
  throw new Error(`Cannot determine the week: ${relativePath}`)
}

/** Parse without dropping ragged fields, duplicate rows, or placeholder values. */
export function readTrackingCsv(contents: string, monday?: PlainDate): TrackingCsv {
  const lines = contents.replace(/^\uFEFF/, '').split(/\r?\n/)
  const headerLine = lines.findIndex((line) => line.trim())
  if (headerLine < 0) return { header: [], rows: [], warnings: [] }
  const header = fields(lines[headerLine], false).values
  const expectedKey = monday ? 'day' : 'date'
  if (header[0]?.toLowerCase() !== expectedKey) throw new Error(`Expected a ${expectedKey} column`)
  if (header.some((h) => !h) || new Set(header).size !== header.length) {
    throw new Error('Empty or duplicate CSV column names')
  }
  header[0] = 'date'
  const rows: string[][] = []
  const warnings: string[] = []
  const originalWidth = header.length
  for (let i = headerLine + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const parsed = fields(lines[i], !!monday)
    const row = parsed.values
    if (monday) {
      const offset = DAY_LETTERS.findIndex((d) => d === row[0].toUpperCase())
      if (offset < 0) throw new Error(`Unrecognized day at line ${i + 1}`)
      row[0] = monday.addDays(offset).ymd
    } else {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row[0])) throw new Error(`Invalid date at line ${i + 1}`)
      new PlainDate(row[0])
    }
    if (parsed.repaired) warnings.push(`Line ${i + 1}: closed a missing final quote`)
    if (row.length > originalWidth) warnings.push(`Line ${i + 1}: preserved fields beyond the header`)
    while (header.length < row.length) {
      const name = `extra_${header.length - originalWidth + 1}`
      if (header.includes(name)) throw new Error(`Overflow column collides with ${name}`)
      header.push(name)
    }
    rows.push(row)
  }
  return { header, rows, warnings }
}

export function quoteCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function writeTrackingCsv(header: string[], rows: string[][]): string {
  return [header.map(quoteCsv).join(', '), ...rows.map((row) => row.map(quoteCsv).join(', '))].join('\n') + '\n'
}

export function columnName(header: string): string {
  return header.replace(/\s+\([^()]*\)$/, '')
}
