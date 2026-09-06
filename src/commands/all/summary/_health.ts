import * as path from 'node:path'
import { columnName } from '#commands/all/track/lib/csv.ts'
import { readTrackingRange } from '#commands/all/track/lib/read.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

export interface HealthData {
  sleep?: { range: string; duration: string }
  weight?: string
  strength?: { time: string; lbs: string; duration: string; notes: string }[]
  distance?: { time: string; miles: string; duration: string; notes: string }[]
  work?: { duration: string; notes: string }
}

export interface WeekHealthCsv {
  name: string
  /** Absolute path of the source CSV, for provenance records. */
  path: string
  /** Only this week's rows, keyed by full date. */
  csv: string
}

const HEALTH_FILES = ['strength', 'distance', 'sleep', 'weight', 'work'] as const

/** Read the requested week, including both annual files at a year boundary. */
export async function gatherWeekHealthData(weekStart: PlainDate, timeDir: string): Promise<WeekHealthCsv[]> {
  const dirs = { timeDir, dataTrackingDir: path.join(path.dirname(timeDir), 'data', 'tracking') }
  const csvs: WeekHealthCsv[] = []
  for (const name of HEALTH_FILES) {
    const sources = await readTrackingRange(dirs, name, weekStart, weekStart.addDays(6))
    csvs.push(...sources.map(({ path, csv }) => ({ name, path, csv })))
  }
  return csvs
}

export async function gatherHealthData(day: PlainDate, timeDir: string): Promise<HealthData> {
  const dirs = { timeDir, dataTrackingDir: path.join(path.dirname(timeDir), 'data', 'tracking') }
  const data: Record<string, Record<string, string>[]> = {}
  for (const name of HEALTH_FILES) {
    const sources = await readTrackingRange(dirs, name, day, day)
    data[name] = sources.flatMap((source) =>
      source.rows.map((row) =>
        Object.fromEntries(source.header.map((header, i) => [columnName(header), row[i] ?? ''])),
      ),
    )
  }
  const meaningful = (value: string | undefined) => !!value && value !== '-'
  const health: HealthData = {}
  const sleep = data.sleep.findLast((r) => meaningful(r.range))
  if (sleep) health.sleep = { range: sleep.range, duration: sleep.duration ?? '' }
  const weight = data.weight.findLast((r) => meaningful(r.lbs))
  if (weight) health.weight = weight.lbs
  const strength = data.strength.filter((r) => meaningful(r.lbs))
  if (strength.length)
    health.strength = strength.map((r) => ({
      time: r.time ?? '',
      lbs: r.lbs,
      duration: r.duration ?? '',
      notes: r.notes ?? '',
    }))
  const distance = data.distance.filter((r) => meaningful(r.miles))
  if (distance.length)
    health.distance = distance.map((r) => ({
      time: r.time ?? '',
      miles: r.miles,
      duration: r.duration ?? '',
      notes: r.notes ?? '',
    }))
  const work = data.work.findLast((r) => meaningful(r.duration))
  if (work) health.work = { duration: work.duration, notes: work.notes ?? '' }
  return health
}
