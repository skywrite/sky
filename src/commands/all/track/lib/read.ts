import * as path from 'node:path'
import { exists, readTextFile } from '#shared/fs/mod.ts'
import { ALL_LAYOUTS } from '#shared/nbfs/layout/registry.ts'
import { PlainDate, Week } from '#universal/dates/nbdt/mod.ts'
import { readTrackingCsv, weeklyMonday, writeTrackingCsv, type TrackingCsv } from './csv.ts'
import type { RecordDirs } from './records.ts'

export interface TrackingSource extends TrackingCsv {
  path: string
  csv: string
}

/** Annual files are authoritative for their year; legacy weeks remain readable. */
export async function readTrackingRange(
  dirs: RecordDirs,
  name: string,
  start: PlainDate,
  end: PlainDate,
  category = 'health',
): Promise<TrackingSource[]> {
  const sources: TrackingSource[] = []
  const annualYears = new Set<number>()
  async function add(file: string, monday?: PlainDate): Promise<void> {
    const table = readTrackingCsv(await readTextFile(file), monday)
    const rows = table.rows.filter(
      (row) => row[0] >= start.ymd && row[0] <= end.ymd && (!monday || !annualYears.has(Number(row[0].slice(0, 4)))),
    )
    if (rows.length) sources.push({ ...table, rows, path: file, csv: writeTrackingCsv(table.header, rows) })
  }
  for (let year = start.year; year <= end.year; year++) {
    const file = path.join(dirs.dataTrackingDir, String(year), `${name}.csv`)
    if (await exists(file)) {
      annualYears.add(year)
      await add(file)
    }
  }
  if (annualYears.size === end.year - start.year + 1) return sources
  const candidates = new Set<string>()
  for (let monday = Week.of(start).start; PlainDate.compare(monday, end) <= 0; monday = monday.addDays(7)) {
    for (const day of Week.of(monday).days) {
      for (const layout of ALL_LAYOUTS)
        candidates.add(path.join(layout.weekDir(day), '_tracking', category, `${name}.csv`))
    }
  }
  for (const rel of candidates) {
    const file = path.join(dirs.timeDir, rel)
    if (await exists(file)) await add(file, weeklyMonday(rel))
  }
  return sources
}
