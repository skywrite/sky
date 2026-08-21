import * as path from 'node:path'
import { DIR_TIME } from '#config'
import readTextFile from '#shared/fs/readTextFile.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import dayFile from './dayFile.ts'
import normalizeToPlainDate from './normalizeToPlainDate.ts'

/**
 * Read a day file and return a Day model.
 *
 * Reads the configured layout's path (nbfs.layout) - a tree in a different
 * layout is a migration to run (nbfs:migrate), not a fallback to guess.
 *
 * @param day - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @param timeDir - Directory containing day files
 * @returns Day model parsed from the markdown file
 */
export default async function readDay(day: PlainDate | string, timeDir = DIR_TIME): Promise<DayDocument> {
  const plainDate = normalizeToPlainDate(day)
  const filePath = path.join(timeDir, dayFile(plainDate))
  return DayDocument.fromMarkdown(await readTextFile(filePath))
}
