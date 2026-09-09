/**
 * Tracking record-file helpers — append rows exactly the way a hand edit
 * would: same file, same format, same quoting habits, same carried header.
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
  return QUOTED_TYPES.has(column.type) ? `"${value.replaceAll('"', '""')}"` : value
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

export function appendRecordContents(
  contents: string | null,
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
): string {
  const newline = contents?.includes('\r\n') ? '\r\n' : '\n'
  if (!contents?.trim())
    return `${contents ?? ''}${formatHeader(def)}${newline}${formatRow(def, date, values)}${newline}`
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
  const separator = contents.endsWith('\n') ? '' : newline
  return `${contents}${separator}${formatRowForHeader(def, date, values, header)}${newline}`
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
 * Append a row for `date`, creating the period's file with its header when
 * new. Returns the written row and whether the file was created.
 */
export async function appendRecord(
  filePath: string,
  def: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
): Promise<{ created: boolean; row: string }> {
  return withTrackingFiles([filePath], async () => {
    const contents = await readTrackingFile(filePath)
    const next = appendRecordContents(contents, def, date, values)
    await writeTrackingFile(filePath, next)
    return { created: contents === null, row: next.trimEnd().split(/\r?\n/).at(-1)! }
  })
}
