/**
 * Tracking record-file helpers — append rows exactly the way a hand edit
 * would: same file, same format, same quoting habits, same carried header.
 * No storage change is hidden here.
 *
 * `storage: weekly` (default) writes the time-tree shards
 * ({timeDir}/{weekDir}/_tracking/{category}/{slug}.csv) with rows keyed by
 * day letter (M T W R F SA SU). `storage: yearly` writes sparse metrics to
 * {dataTrackingDir}/{year}/{slug}.csv with rows keyed by full date. Both use
 * the quoted header style (`"day", "time", "lbs (lbs)", "notes"` — units in
 * parens).
 */

import * as path from 'node:path'
import { exists, outputFile, readTextFile } from '#shared/fs/mod.ts'
import type { TrackingColumn, TrackingDocument } from '#shared/models/Tracking/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

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
  return `"${column.unit ? `${column.name} (${column.unit})` : column.name}"`
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
  const fields = [rowKey(def, date), ...def.columns.map((c) => formatField(c, (values[c.name] ?? '').trim()))]
  while (fields.length > 1 && fields[fields.length - 1] === '') fields.pop()
  return fields.join(', ')
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
  const row = formatRow(def, date, values)

  if (!(await exists(filePath))) {
    await outputFile(filePath, `${formatHeader(def)}\n${row}\n`)
    return { created: true, row }
  }

  const contents = await readTextFile(filePath)
  const sep = contents === '' || contents.endsWith('\n') ? '' : '\n'
  await outputFile(filePath, `${contents}${sep}${row}\n`)
  return { created: false, row }
}
