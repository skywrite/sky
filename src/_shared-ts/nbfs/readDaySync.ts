import { DIR_TIME } from '#config'
import * as path from 'node:path'
import readTextFileSync from '#shared/fs/readTextFileSync.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayFile from './dayFile.ts'
import { dayFile as v2DayFile } from './v2/mod.ts'
import normalizeToPlainDate from './normalizeToPlainDate.ts'

/**
 * Read a day file synchronously and return a Day model.
 *
 * Tries v2 path first (YYYY/W##/MM.DD/day.md), then falls back to v1
 * (YYYY/MM/DD-DD/DD/day.md). This allows the system to work both before
 * and after NBFS v2 migration.
 *
 * @param day - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @param timeDir - Directory containing day files
 * @returns Day model parsed from the markdown file
 */
export default function readDaySync(day: PlainDate | string, timeDir = DIR_TIME): DayDocument {
  const plainDate = normalizeToPlainDate(day)

  // Try v1 path first, fall back to v2
  try {
    const v1Path = path.join(timeDir, dayFile(plainDate))
    return DayDocument.fromMarkdown(readTextFileSync(v1Path))
  } catch {
    const v2Path = path.join(timeDir, v2DayFile(plainDate))
    return DayDocument.fromMarkdown(readTextFileSync(v2Path))
  }
}
