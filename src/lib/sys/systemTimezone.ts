import { readlink } from 'node:fs/promises'
import delay from '#universal/async/delay.ts'
import { isValidTimezoneIANA } from '#universal/dates/timezones/mod.ts'

export const LOCALTIME_PATH = '/etc/localtime'

// The relink window on wake (macOS swaps the symlink while re-applying
// auto-timezone) clears well within a second; three spaced attempts outlast
// it without stalling callers noticeably (~500ms worst case).
const DEFAULT_ATTEMPTS = 3
const DEFAULT_RETRY_DELAY_MS = 250

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
 * re-applying auto-timezone on wake. That failure is transient, so anything
 * short of a valid zone retries a few spaced attempts before returning null
 * — callers then fall back loudly instead of guessing.
 */
export async function readSystemTimezone(
  localtimePath: string = LOCALTIME_PATH,
  {
    attempts = DEFAULT_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  }: {
    attempts?: number
    retryDelayMs?: number
  } = {},
): Promise<string | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      const zone = timezoneFromZoneinfoPath(await readlink(localtimePath))
      if (zone) return zone
    } catch {
      // unreadable this attempt — retry below
    }
    if (attempt >= attempts) return null
    await delay(retryDelayMs)
  }
}
