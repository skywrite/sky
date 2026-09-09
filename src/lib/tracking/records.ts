import * as path from 'node:path'
import { columnName, quoteCsv, readTrackingCsv, weeklyMonday } from '#commands/all/track/lib/csv.ts'
import { readTrackingRange } from '#commands/all/track/lib/read.ts'
import { appendRecordContents, formatRowForHeader, recordFilePath } from '#commands/all/track/lib/records.ts'
import type { TrackingDocument } from '#shared/models/Tracking/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { fingerprint, readTrackingFile, safeTrackingPath } from './files.ts'
import { TrackingError, type TrackingEntry } from './types.ts'

export interface TrackingDirs {
  root: string
  timeDir: string
  dataTrackingDir: string
  trackingDir: string
  stateDir: string
}

export interface LoadedTrackingFile {
  file: string
  relative: string
  contents: string
  newline: string
  lines: string[]
  header: string[]
  entries: Array<TrackingEntry & { line: number }>
  warnings: string[]
}

export async function loadTrackingFile(dirs: TrackingDirs, file: string): Promise<LoadedTrackingFile | null> {
  const relative = path.relative(dirs.root, file)
  await safeTrackingPath(dirs.root, relative)
  const contents = await readTrackingFile(file)
  if (contents === null || !contents.trim()) return null
  const weekly = file.startsWith(dirs.timeDir + path.sep)
  const monday = weekly ? weeklyMonday(path.relative(dirs.timeDir, file)) : undefined
  const table = readTrackingCsv(contents, monday)
  const lines = contents.split(/\r?\n/)
  const first = lines.findIndex((line) => line.replace(/^\uFEFF/, '').trim())
  const physical = lines.flatMap((line, index) => (index > first && line.trim() ? [index] : []))
  const revision = fingerprint(contents)
  const names = table.header.map(columnName)
  if (new Set(names).size !== names.length)
    throw new TrackingError('This tracking file has ambiguous column names. Correct its header before editing it.')
  const occurrences = new Map<string, number>()
  return {
    file,
    relative,
    contents,
    lines,
    header: table.header,
    newline: contents.includes('\r\n') ? '\r\n' : '\n',
    warnings: table.warnings,
    entries: table.rows.map((row, index) => {
      const raw = lines[physical[index]]
      const occurrence = occurrences.get(raw) ?? 0
      occurrences.set(raw, occurrence + 1)
      return {
        id: fingerprint(`${relative}\0${revision}\0${physical[index]}`),
        key: fingerprint(`${relative}\0${raw}\0${occurrence}`),
        date: row[0],
        values: Object.fromEntries(names.slice(1).map((name, column) => [name, row[column + 1] ?? ''])),
        source: relative,
        line: physical[index],
      }
    }),
  }
}

export async function loadTrackingEntries(
  dirs: TrackingDirs,
  definition: TrackingDocument,
  start: PlainDate,
  end: PlainDate,
): Promise<{ entries: TrackingEntry[]; warnings: string[] }> {
  const sources = await readTrackingRange(dirs, definition.name, start, end, definition.category || 'health')
  const loaded = await Promise.all(sources.map((source) => loadTrackingFile(dirs, source.path)))
  return {
    entries: loaded
      .flatMap(
        (source) =>
          source?.entries
            .filter((entry) => entry.date >= start.ymd && entry.date <= end.ymd)
            .map(({ line: _line, ...entry }) => entry) ?? [],
      )
      .sort((a, b) => a.date.localeCompare(b.date)),
    warnings: loaded.flatMap((source) => source?.warnings ?? []),
  }
}

export async function findTrackingEntry(
  dirs: TrackingDirs,
  definition: TrackingDocument,
  ref: { id: string; date: string },
): Promise<{ source: LoadedTrackingFile; entry: LoadedTrackingFile['entries'][number] }> {
  const date = new PlainDate(ref.date)
  const sources = await readTrackingRange(dirs, definition.name, date, date, definition.category || 'health')
  for (const candidate of sources) {
    const source = await loadTrackingFile(dirs, candidate.path)
    const entry = source?.entries.find((row) => row.id === ref.id && row.date === ref.date)
    if (source && entry) return { source, entry }
  }
  throw new TrackingError('This entry’s file changed. Reload the history before editing it.', 409)
}

export function replaceTrackingRow(
  source: LoadedTrackingFile,
  definition: TrackingDocument,
  line: number,
  date: PlainDate,
  values: Record<string, string> | null,
): string {
  const lines = source.lines.slice()
  if (values === null) lines.splice(line, 1)
  else {
    // Source storage, rather than the current definition, owns a historical row’s day key.
    const rowDefinition = definition.updateYaml({
      storage: source.lines
        .find((row) => row.trim())
        ?.replace(/^\uFEFF/, '')
        .match(/^\s*"?day"?\s*,/i)
        ? 'weekly'
        : 'yearly',
    })
    const header = source.header.slice()
    for (const column of definition.columns) {
      if (!header.slice(1).some((label) => columnName(label) === column.name))
        header.push(column.unit ? `${column.name} (${column.unit})` : column.name)
    }
    if (header.length !== source.header.length) {
      const at = lines.findIndex((row) => row.replace(/^\uFEFF/, '').trim())
      header[0] = rowDefinition.storage === 'weekly' ? 'day' : 'date'
      lines[at] = `${lines[at].startsWith('\uFEFF') ? '\uFEFF' : ''}${header.map(quoteCsv).join(', ')}`
    }
    lines[line] = formatRowForHeader(rowDefinition, date, values, header)
  }
  return lines.join(source.newline)
}

export async function trackingDestination(
  dirs: TrackingDirs,
  definition: TrackingDocument,
  date: PlainDate,
): Promise<string> {
  // An annual file is authoritative even when an old definition still says weekly.
  const yearly = definition.updateYaml({ storage: 'yearly' })
  const annual = recordFilePath(dirs, yearly, date)
  const file =
    definition.storage === 'yearly' || (await readTrackingFile(annual)) !== null
      ? annual
      : recordFilePath(dirs, definition, date)
  return safeTrackingPath(dirs.root, path.relative(dirs.root, file))
}

export function appendTrackingContents(
  dirs: TrackingDirs,
  file: string,
  before: string | null,
  definition: TrackingDocument,
  date: PlainDate,
  values: Record<string, string>,
): string {
  return appendRecordContents(
    before,
    definition.updateYaml({ storage: file.startsWith(dirs.dataTrackingDir + path.sep) ? 'yearly' : 'weekly' }),
    date,
    values,
  )
}
