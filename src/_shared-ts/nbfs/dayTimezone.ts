import { DIR_TIME } from '#config'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import fetchNow from './fetchNow.ts'
import readDay from './readDay.ts'

/**
 * Timezone for a specific day, read from its day file's `tz:` field.
 * Falls back to the current notebook timezone when the day file
 * doesn't exist.
 *
 * @param day - PlainDate instance or YMD string (e.g., "2025-03-15")
 * @param timeDir - Directory containing day files
 * @returns IANA timezone identifier (e.g., "America/Chicago")
 */
export default async function dayTimezone(day: PlainDate | string, timeDir = DIR_TIME): Promise<string> {
  try {
    return (await readDay(day, timeDir)).timezone
  } catch {
    return (await fetchNow({ timeDir })).timezone
  }
}
