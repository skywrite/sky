import * as path from 'node:path'
import { readTextFile } from '#shared/fs/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parseCsv } from '#universal/encoding/csv/mod.ts'

const DAYS_OF_WEEK = ['SU', 'M', 'T', 'W', 'R', 'F', 'SA']

export interface HealthData {
  sleep?: { range: string; duration: string }
  weight?: string
  strength?: { time: string; lbs: string; duration: string; notes: string }[]
  distance?: { time: string; miles: string; duration: string; notes: string }[]
  work?: { duration: string; notes: string }
}

function getDayAbbrev(date: PlainDate): string {
  return DAYS_OF_WEEK[date.toDate().getDay()]
}

export interface WeekHealthData {
  strength?: string
  distance?: string
  sleep?: string
  weight?: string
  work?: string
}

// Map day abbreviations to day offset from Monday (week start)
const DAY_ABBREV_TO_OFFSET: Record<string, number> = {
  M: 0,
  T: 1,
  W: 2,
  R: 3,
  F: 4,
  SA: 5,
  SU: 6,
}

/**
 * Transform CSV content to replace day abbreviations (M, T, W, etc.) with YMD dates.
 */
function transformDayColumn(csvContent: string, weekStart: PlainDate): string {
  const lines = csvContent.split('\n')
  if (lines.length === 0) return csvContent

  // Find the day column index from header
  const headerLine = lines[0]
  const headerFields = headerLine.split(',').map((f) => f.trim().replace(/^"|"$/g, ''))
  const dayIndex = headerFields.findIndex((h) => h.toLowerCase() === 'day')

  if (dayIndex === -1) return csvContent // No day column

  // Transform each line
  const transformed = lines.map((line, lineIndex) => {
    if (lineIndex === 0) return line // Keep header as-is

    const fields = line.split(',')
    if (fields.length <= dayIndex) return line

    const dayAbbrev = fields[dayIndex].trim().replace(/^"|"$/g, '')
    const offset = DAY_ABBREV_TO_OFFSET[dayAbbrev]

    if (offset !== undefined) {
      const date = weekStart.addDays(offset)
      fields[dayIndex] = date.ymd
    }

    return fields.join(',')
  })

  return transformed.join('\n')
}

/**
 * Read raw CSV files for a week's health data.
 * Returns the full CSV content for each file that exists.
 * Day abbreviations (M, T, W, etc.) are converted to YMD dates.
 */
export async function gatherWeekHealthData(weekStart: PlainDate, timeDir: string): Promise<WeekHealthData> {
  const weekDirPath = path.join(timeDir, weekDir(weekStart), '_tracking', 'health')
  const data: WeekHealthData = {}

  const files = ['strength', 'distance', 'sleep', 'weight', 'work'] as const

  for (const file of files) {
    try {
      const content = await readTextFile(path.join(weekDirPath, `${file}.csv`))
      if (content.trim()) {
        data[file] = transformDayColumn(content.trim(), weekStart)
      }
    } catch {
      // File doesn't exist
    }
  }

  return data
}

export async function gatherHealthData(day: PlainDate, timeDir: string): Promise<HealthData> {
  const weekDirPath = path.join(timeDir, weekDir(day), '_tracking', 'health')
  const dayAbbrev = getDayAbbrev(day)
  const healthData: HealthData = {}

  // Sleep
  try {
    const sleepCsv = await readTextFile(path.join(weekDirPath, 'sleep.csv'))
    const { records } = parseCsv(sleepCsv)
    const dayRecord = records.find((r) => r.day === dayAbbrev)
    if (dayRecord && dayRecord.range && dayRecord.range !== '-') {
      healthData.sleep = {
        range: dayRecord.range,
        duration: dayRecord['duration (hrs)'] || dayRecord.duration || '',
      }
    }
  } catch {
    // No sleep data
  }

  // Weight
  try {
    const weightCsv = await readTextFile(path.join(weekDirPath, 'weight.csv'))
    const { records } = parseCsv(weightCsv)
    const dayRecord = records.find((r) => r.day === dayAbbrev)
    if (dayRecord && dayRecord.lbs && dayRecord.lbs !== '-') {
      healthData.weight = dayRecord.lbs
    }
  } catch {
    // No weight data
  }

  // Strength
  try {
    const strengthCsv = await readTextFile(path.join(weekDirPath, 'strength.csv'))
    const { records } = parseCsv(strengthCsv)
    const dayRecords = records.filter((r) => r.day === dayAbbrev && r.lbs && r.lbs !== '-')
    if (dayRecords.length > 0) {
      healthData.strength = dayRecords.map((r) => ({
        time: r.time || '',
        lbs: r.lbs || '',
        duration: r['duration (mins)'] || r.duration || '',
        notes: r.notes || '',
      }))
    }
  } catch {
    // No strength data
  }

  // Distance
  try {
    const distanceCsv = await readTextFile(path.join(weekDirPath, 'distance.csv'))
    const { records } = parseCsv(distanceCsv)
    const dayRecords = records.filter((r) => r.day === dayAbbrev && r.miles && r.miles !== '-')
    if (dayRecords.length > 0) {
      healthData.distance = dayRecords.map((r) => ({
        time: r.time || '',
        miles: r.miles || '',
        duration: r['duration (mins)'] || r.duration || '',
        notes: r.notes || '',
      }))
    }
  } catch {
    // No distance data
  }

  // Work
  try {
    const workCsv = await readTextFile(path.join(weekDirPath, 'work.csv'))
    const { records } = parseCsv(workCsv)
    const dayRecord = records.find((r) => r.day === dayAbbrev)
    if (dayRecord && dayRecord['duration (hrs)'] && dayRecord['duration (hrs)'] !== '-') {
      healthData.work = {
        duration: dayRecord['duration (hrs)'],
        notes: dayRecord.notes || '',
      }
    }
  } catch {
    // No work data
  }

  return healthData
}
