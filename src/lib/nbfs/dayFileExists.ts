import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { exists } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Check whether the day file for a date exists at the configured layout's
 * path (nbfs.layout), mirroring readDay.
 *
 * @param day - Date to check
 * @param timeDir - Directory containing day files
 * @returns True when the day file exists
 */
export default async function dayFileExists(day: PlainDate, timeDir = DIR_TIME): Promise<boolean> {
  return exists(path.join(timeDir, dayFile(day)))
}
