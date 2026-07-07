import { readlink } from 'node:fs/promises'
import { isValidTimezoneIANA } from '#universal/dates/timezones/mod.ts'

export const LOCALTIME_PATH = '/etc/localtime'

/**
 * Extract an IANA zone name from a zoneinfo symlink target,
 * e.g. '/var/db/timezone/zoneinfo/America/Chicago' → 'America/Chicago'.
 * Returns null when the target doesn't point into a zoneinfo database
 * or the extracted name isn't a timezone the runtime accepts.
 */
export function timezoneFromZoneinfoPath(target: string): string | null {
  const zone = target.match(/\/zoneinfo\/(.+)$/)?.[1]
  if (!zone) return null
  return isValidTimezoneIANA(zone) ? zone : null
}

/**
 * Read the OS timezone from the /etc/localtime symlink (macOS and most Linux).
 *
 * Intl detection reads the same symlink (via ICU) but silently reports UTC
 * when the read fails — e.g. the moment macOS re-links the file while
 * re-applying auto-timezone on wake. This returns null instead, so callers
 * can retry or fall back loudly.
 */
export async function readSystemTimezone(localtimePath: string = LOCALTIME_PATH): Promise<string | null> {
  try {
    return timezoneFromZoneinfoPath(await readlink(localtimePath))
  } catch {
    return null
  }
}
