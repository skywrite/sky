import * as path from 'node:path'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

const MM_DD_REGEX = /^(\d{2})\.(\d{2})$/

/**
 * Parse a PlainDate from a v2 day file path.
 *
 * V2 paths are structured as: time/YYYY/MM/W##/MM.DD/day.md
 * Extracts year from the YYYY segment and month/day from the MM.DD segment.
 *
 * @param filePath - The full path to a day file
 * @returns PlainDate representing the date
 * @throws Error if the path is not a valid v2 day file path
 */
export default function parseDateFromDayPath(filePath: string): PlainDate {
  const parts = filePath.split(path.sep)

  // Find the 'time' directory index
  const timeIndex = parts.indexOf('time')
  if (timeIndex === -1) {
    throw new Error(`Invalid day file path: missing 'time' directory in ${filePath}`)
  }

  // After 'time': YYYY/MM/W##/MM.DD
  const yearStr = parts[timeIndex + 1]
  const mmDdStr = parts[timeIndex + 4]

  if (!yearStr || !mmDdStr) {
    throw new Error(`Invalid day file path: missing date components in ${filePath}`)
  }

  const year = parseInt(yearStr, 10)
  const match = mmDdStr.match(MM_DD_REGEX)

  if (isNaN(year) || !match) {
    throw new Error(`Invalid date components in path ${filePath}: year=${yearStr}, mmdd=${mmDdStr}`)
  }

  const month = parseInt(match[1], 10)
  const day = parseInt(match[2], 10)

  return new PlainDate(year, month, day)
}
