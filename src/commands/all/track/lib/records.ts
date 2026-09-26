/**
 * Tracking record-file helpers — add rows exactly the way a hand edit
 * would: same file, same format, same quoting habits, same carried header,
 * in date order.
 * `storage: weekly` writes the legacy time-tree shards
 * ({timeDir}/{weekDir}/_tracking/{category}/{slug}.csv) with rows keyed by
 * day letter (M T W R F SA SU). `storage: yearly` (default) writes metrics to
 * {dataTrackingDir}/{year}/{slug}.csv with rows keyed by full date. Both use
 * the quoted header style (`"day", "time", "lbs (lbs)", "notes"` — units in
 * parens).
 */

import * as path from 'node:path'
import { readTrackingFile, withTrackingFiles, writeTrackingFile } from '#lib/tracking/files.ts'
import type { TrackingColumn, TrackingDocument } from '#shared/models/Tracking/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { columnName, quoteCsv, readTrackingCsv } from './csv.ts'

/** Monday-first day letters, matching the hand-kept convention (R = Thursday). */
export const DAY_LETTERS = ['M', 'T', 'W', 'R', 'F', 'SA', 'SU'] as const

export function dayLetter(date: PlainDate): string {
  return DAY_LETTERS[date.dayOfWeek - 1]
}

export interface RecordDirs {
  /** Notebook time tree root — weekly-storage shards live under it. */
  timeDir: string
  /** data/tracking root — yearly-storage files live under it. */
  dataTrackingDir: string
}

/** The row's first field: day letter in weekly files, full date in yearly ones. */
function rowKey(def: TrackingDocument, date: PlainDate): string {
  return def.storage === 'yearly' ? date.toString() : dayLetter(date)
}

/** Absolute path of a definition's record file for the period containing `date`. */
export function recordFilePath(dirs: RecordDirs, def: TrackingDocument, date: PlainDate): string {
  if (def.storage === 'yearly') {
    return path.join(dirs.dataTrackingDir, String(date.year), def.csvBasename)
  }
  return path.join(dirs.timeDir, weekDir(date), '_tracking', def.category || 'health', def.csvBasename)
}

function headerCell(column: TrackingColumn): string {
  return quoteCsv(column.unit ? `${column.name} (${column.unit})` : column.name)
}

/** Header line for a new record file, derived from the definition's schema. */
export function formatHeader(def: TrackingDocument): string {
  const first = def.storage === 'yearly' ? '"date"' : '"day"'
  return [first, ...def.columns.map(headerCell)].join(', ')
}

// Hand rows quote prose-ish values and leave numbers, times, and day letters bare.
const QUOTED_TYPES: ReadonlySet<string> = new Set(['range', 'word', 'text'])

function formatField(column: TrackingColumn, value: string): string {
  if (value === '') return ''
  // A bare cell ends at the next comma, whatever its column type says.
  return QUOTED_TYPES.has(column.type) || /[,"]/.test(value) ? quoteCsv(value) : value
}

/**
 * One record row: day letter (weekly) or full date (yearly), then the
 * definition's columns in order. Trailing empty fields are dropped —
 * hand-kept rows are ragged the same way.
 */
export function formatRow(def: TrackingDocument, date: PlainDate, values: Record<string, string>): string {
  return formatRowWithColumns(def, date, values, def.columns)
}

function formatRowWithColumns(
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
  columns: TrackingColumn[],
): string {
  const fields = [rowKey(def, date), ...columns.map((c) => formatField(c, (values[c.name] ?? '').trim()))]
  while (fields.length > 1 && fields[fields.length - 1] === '') fields.pop()
  return fields.join(', ')
}

/** Header names own the positions, including records from an older definition. */
export function formatRowForHeader(
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
  header: string[],
): string {
  return formatRowWithColumns(
    def,
    date,
    values,
    header.slice(1).map((label) => {
      const name = columnName(label)
      return def.columns.find((column) => column.name === name) ?? { name, type: 'text' }
    }),
  )
}

/** A row's place in date order: the full date, or the day letter's weekday number. */
function orderKey(def: TrackingDocument, key: string): string {
  return def.storage === 'yearly' ? key : String(DAY_LETTERS.findIndex((d) => d === key.toUpperCase()))
}

function lineKey(line: string): string {
  return line.split(',')[0].trim().replace(/^"|"$/g, '')
}

/** File contents with the row in date order, plus the row as written. */
function insertRecord(
  contents: string | null,
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
): { contents: string; row: string } {
  const newline = contents?.includes('\r\n') ? '\r\n' : '\n'
  if (!contents?.trim()) {
    const row = formatRow(def, date, values)
    return { contents: `${contents ?? ''}${formatHeader(def)}${newline}${row}${newline}`, row }
  }
  const table = readTrackingCsv(contents, def.storage === 'weekly' ? date.addDays(1 - date.dayOfWeek) : undefined)
  const header = table.header.slice()
  const names = header.slice(1).map(columnName)
  if (new Set(names).size !== names.length) throw new Error('Tracking record columns have ambiguous names.')
  for (const column of def.columns) {
    if (!names.includes(column.name)) {
      header.push(column.unit ? `${column.name} (${column.unit})` : column.name)
      names.push(column.name)
    }
  }
  const lines = contents.split(/\r?\n/)
  const at = lines.findIndex((line) => line.replace(/^\uFEFF/, '').trim())
  // Adding a field only extends the header; every historical row remains verbatim.
  const oldHeader = readTrackingCsv(
    lines[at].replace(/^\uFEFF/, '') + newline,
    def.storage === 'weekly' ? date : undefined,
  ).header
  if (header.length !== oldHeader.length) {
    header[0] = def.storage === 'weekly' ? 'day' : 'date'
    lines[at] = `${lines[at].startsWith('\uFEFF') ? '\uFEFF' : ''}${header.map(quoteCsv).join(', ')}`
    contents = lines.join(newline)
  }
  const row = formatRowForHeader(def, date, values, header)
  // A late entry for an earlier day goes above the later days; same-day rows keep arrival order.
  const own = orderKey(def, rowKey(def, date))
  let insertAt = lines.length
  for (let i = lines.length - 1; i > at; i--) {
    if (!lines[i].trim()) continue
    if (orderKey(def, lineKey(lines[i])) <= own) break
    insertAt = i
  }
  if (insertAt < lines.length) {
    lines.splice(insertAt, 0, row)
    return { contents: lines.join(newline), row }
  }
  const separator = contents.endsWith('\n') ? '' : newline
  return { contents: `${contents}${separator}${row}${newline}`, row }
}

export function appendRecordContents(
  contents: string | null,
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
): string {
  return insertRecord(contents, def, date, values).contents
}

/**
 * Whether the file already carries a row for this date. Tolerates both
 * quoting eras (`M, …` and `"M",…`); header lines never match a key.
 */
export function hasEntryForDate(def: TrackingDocument, contents: string, date: PlainDate): boolean {
  const rowStart = new RegExp(`^\\s*"?${rowKey(def, date)}"?\\s*,`)
  return contents.split('\n').some((line) => rowStart.test(line))
}

/**
 * Add a row for `date` in date order, creating the period's file with its
 * header when new. Returns the written row and whether the file was created.
 */
export async function appendRecord(
  filePath: string,
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
): Promise<{ created: boolean; row: string }> {
  return withTrackingFiles([filePath], async () => {
    const contents = await readTrackingFile(filePath)
    const next = insertRecord(contents, def, date, values)
    await writeTrackingFile(filePath, next.contents)
    return { created: contents === null, row: next.row }
  })
}
