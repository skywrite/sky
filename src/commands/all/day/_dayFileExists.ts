import * as path from 'node:path'
import { DIR_TIME } from '#config'
import { exists } from '#shared/fs/mod.ts'
import { dayFile } from '#shared/nbfs/mod.ts'
import { dayFile as v2DayFile } from '#shared/nbfs/v2/mod.ts'
import type { PlainDate } from '#universal/dates/nbdt/mod.ts'

/**
 * Check whether the day file for a date exists, in either notebook layout —
 * v1.1 first, then the deferred v2 migration layout, mirroring readDay.
 *
 * @param day - Date to check
 * @param timeDir - Directory containing day files
 * @returns True when the day file exists in either layout
 */
export default async function dayFileExists(day: PlainDate, timeDir = DIR_TIME): Promise<boolean> {
  if (await exists(path.join(timeDir, dayFile(day)))) return true
  return exists(path.join(timeDir, v2DayFile(day)))
}
