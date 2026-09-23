import { classifyDayEvents, type ClassifiedCalendarEvent } from '#lib/calendarClassification/mod.ts'
import {
  GoogleClient,
  hasCalendarScope,
  listAccountEmails,
  listEvents,
  loadAccountTokens,
  loadAccountClient,
  meetingDropReason,
} from '#lib/google/mod.ts'
import type { CalendarEvent } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { readSystemTimezone } from '#lib/sys/mod.ts'
import { dayTimezone } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { currentTimezoneIANA } from '#universal/dates/timezones/mod.ts'

export interface DayMeetings {
  /** The day's saved IANA zone, falling back to the notebook's current zone, then the system zone. */
  timeZone: string
  /** The day's events that count as meetings, oldest first. */
  meetings: ClassifiedCalendarEvent[]
  notifications: ClassifiedCalendarEvent[]
  classificationWarning?: string
  /** The day's events the meeting policy excludes, with the reason. */
  dropped: Array<{ event: CalendarEvent; reason: string }>
  /** Accounts that could not be queried (no grant, missing scope, API failure) — the caller decides severity. */
  errors: string[]
}

/**
 * One civil day's calendar events across every authorized Google account,
 * split by the meeting policy. The API is queried over a UTC window padded a
 * day on both sides with responses rendered in the notebook day's zone, then filtered
 * to the day by string comparison — timezone and DST correctness stay
 * Google's job, and no absolute-time math happens here. Events spanning
 * midnight belong to the day they start. No cross-account dedupe yet: with
 * several accounts, an event shared between them would appear once per
 * account.
 */
export async function fetchDayMeetings(
  secrets: SecretsProvider,
  day: PlainDate,
  timeDir?: string,
): Promise<DayMeetings> {
  // Calendar times must share the records' clock even after the owner travels.
  const timeZone = await dayTimezone(day, timeDir).catch(
    async () => (await readSystemTimezone()) ?? currentTimezoneIANA(),
  )
  const result: DayMeetings = { timeZone, meetings: [], notifications: [], dropped: [], errors: [] }

  const accounts = await listAccountEmails(secrets)
  if (accounts.length === 0) {
    result.errors.push('No Google accounts are authorized yet. Run: sky google:auth')
    return result
  }

  const timeMin = `${day.addDays(-1).ymd}T00:00:00Z`
  const timeMax = `${day.addDays(2).ymd}T00:00:00Z`

  const all: CalendarEvent[] = []
  for (const email of accounts) {
    const tokens = await loadAccountTokens(secrets, email)
    if (!tokens || !hasCalendarScope(tokens)) {
      result.errors.push(`${email}: stored grant lacks calendar access. Run: sky google:auth`)
      continue
    }
    const oauthClient = await loadAccountClient(secrets, email)
    if (!oauthClient) {
      result.errors.push(`${email}: no OAuth client stored for this account. Run: sky google:auth`)
      continue
    }
    const client = new GoogleClient({ secrets, email, client: oauthClient })
    try {
      all.push(...(await listEvents(client, { timeMin, timeMax, timeZone })))
    } catch (err) {
      result.errors.push(`${email}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onDay = all.filter((e) => (e.allDay ? e.start <= day.ymd && day.ymd < e.end : e.start.startsWith(day.ymd)))
  onDay.sort((a, b) => a.start.localeCompare(b.start))

  for (const event of onDay) {
    const reason = meetingDropReason(event)
    if (reason) result.dropped.push({ event, reason })
    else result.meetings.push(event)
  }
  const classified = await classifyDayEvents(result.meetings, secrets)
  result.meetings = classified.meetings
  result.notifications = classified.notifications
  result.classificationWarning = classified.warning
  return result
}

/** `10:00 - 11:00`, or `all-day` for date-only events. */
export function formatEventWhen(event: CalendarEvent): string {
  return event.allDay ? 'all-day' : `${event.start.slice(11, 16)} - ${event.end.slice(11, 16)}`
}

/** The other people in the room, capped so board meetings stay one line. */
export function formatEventWho(event: CalendarEvent, max = 3): string {
  const others = event.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email)
  if (others.length === 0) return ''
  const shown = others.slice(0, max)
  const more = others.length - shown.length
  return `  — ${shown.join(', ')}${more > 0 ? ` +${more}` : ''}`
}
