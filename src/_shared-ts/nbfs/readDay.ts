import * as path from 'node:path'
import { DIR_TIME } from '#config'
import readTextFile from '#shared/fs/readTextFile.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayFile from './dayFile.ts'
import normalizeToPlainDate from './normalizeToPlainDate.ts'
import { dayFile as v2DayFile } from './v2/mod.ts'

/**
 * Read a day file and return a Day model.
 *
 * Tries the v1.1 path (YYYY/MM/DD-DD/MM-DD/day.md) first, then falls
 * back to the v2 path (kept alongside the deferred v2 migration tooling).
 *
 * @param day - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @param timeDir - Directory containing day files
 * @returns Day model parsed from the markdown file
 */
export default async function readDay(day: PlainDate | string, timeDir = DIR_TIME): Promise<DayDocument> {
  const plainDate = normalizeToPlainDate(day)

  try {
    const v11Path = path.join(timeDir, dayFile(plainDate))
    return DayDocument.fromMarkdown(await readTextFile(v11Path))
  } catch {
    const v2Path = path.join(timeDir, v2DayFile(plainDate))
    return DayDocument.fromMarkdown(await readTextFile(v2Path))
  }
}
