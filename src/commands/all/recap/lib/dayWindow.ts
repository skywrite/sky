import { DIR_TIME } from '#config'
import { dayTimezone, readDay } from '#shared/nbfs/mod.ts'
import { PlainDate, ZonedDateTime } from '#universal/dates/nbdt/mod.ts'

export interface DayWindow {
  /** Instant the day's activity begins: its day:start, or the fallback boundary. */
  start: Date
  /** Instant it ends: the next day's start, or now while the day is still open. */
  end: Date
  /** IANA timezone the day's wall clocks render in. */
  timezone: string
}

// When a day file is missing its started: time, assume the notebook day began
// at 04:00 local — hours before that belong to the previous day as extended
// hours (25:30-style), mirroring how fetchNow attributes the current time.
const FALLBACK_START = '04:00'

function toInstant(zdt: ZonedDateTime): Date {
  const utc = zdt.toUTC()
  const [h, m] = utc.time.split(':')
  return new Date(`${utc.date}T${h.padStart(2, '0')}:${m.padStart(2, '0')}:00Z`)
}

async function startedInstant(day: PlainDate, timeDir: string): Promise<Date | null> {
  try {
    const started = (await readDay(day, timeDir)).started
    return started ? toInstant(started) : null
  } catch {
    return null
  }
}

async function fallbackInstant(day: PlainDate, timeDir: string): Promise<Date> {
  const tz = await dayTimezone(day, timeDir)
  return toInstant(new ZonedDateTime(`${day.ymd} ${FALLBACK_START}`, tz))
}

/**
 * The instant window a notebook day owns: day:start to day:start.
 *
 * The boundary is day-file-driven, not midnight — an event at 00:45 belongs
 * to the day that was still open (as 24:45), exactly as fetchNow attributes
 * the current time. A day whose successor hasn't started yet is still open,
 * so its window ends now.
 */
export default async function dayWindow(day: PlainDate, timeDir = DIR_TIME): Promise<DayWindow> {
  const timezone = await dayTimezone(day, timeDir)
  const start = (await startedInstant(day, timeDir)) ?? (await fallbackInstant(day, timeDir))

  const next = day.addDays(1)
  let end = await startedInstant(next, timeDir)
  if (!end) {
    end = PlainDate.compare(next, new PlainDate()) >= 0 ? new Date() : await fallbackInstant(next, timeDir)
  }

  return { start, end, timezone }
}
