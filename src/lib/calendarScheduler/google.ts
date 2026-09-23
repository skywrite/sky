import { availabilityOf, type CalendarSourceEvents } from '#lib/calendarScheduler/availability.ts'
import { parseMeeting } from '#lib/calendarScheduler/parse.ts'
import { meetingInterval } from '#lib/calendarScheduler/validation.ts'
import { createCalendarMeeting } from '#lib/google/createCalendarMeeting.ts'
import {
  GoogleClient,
  hasCalendarScope,
  listAccountEmails,
  listEvents,
  loadAccountTokens,
  loadAccountClient,
} from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { readSystemTimezone } from '#lib/sys/mod.ts'
import { calendarNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { currentTimezoneIANA } from '#universal/dates/timezones/mod.ts'
import { createGoogleCalendarUpdates } from './googleUpdates.ts'
import type { CalendarSchedulerHost } from './types.ts'

interface CalendarListPage {
  items?: Array<{ id: string; summary: string; primary?: boolean }>
  nextPageToken?: string
}

/** Provider operations depend on injected contacts and secrets, independent of the web server. */
export function createGoogleCalendarHost(options: {
  dir: string
  secrets: SecretsProvider
  people: CalendarSchedulerHost['people']
}): CalendarSchedulerHost {
  const { dir, secrets, people } = options
  const accounts = async () => {
    const found: string[] = []
    for (const email of await listAccountEmails(secrets)) {
      const tokens = await loadAccountTokens(secrets, email)
      if (tokens && hasCalendarScope(tokens)) found.push(email.toLowerCase())
    }
    return found
  }
  const clientFor = async (email: string) => {
    const client = await loadAccountClient(secrets, email)
    if (!client) throw new Error('Connect Google Calendar in Settings → Connections.')
    return new GoogleClient({ secrets, email, client })
  }
  return {
    dir,
    setup: async () => {
      const timezone = (await readSystemTimezone()) ?? currentTimezoneIANA()
      return { date: calendarNow(timezone).date, timezone, accounts: await accounts() }
    },
    people,
    parse: (query, timezone, signal) => parseMeeting(query, timezone, people, signal),
    updates: createGoogleCalendarUpdates(clientFor, people),
    availability: async (timing, exclude) => {
      meetingInterval(timing)
      const day = new PlainDate(timing.date)
      const sources: CalendarSourceEvents[] = []
      const warnings: string[] = []
      const emails = await accounts()
      if (!emails.length) warnings.push('No Google calendars are connected.')
      // Read every owned calendar, including all-day and solo blocks. Coworkers' shared calendars are not the user's availability.
      await Promise.all(
        emails.map(async (email) => {
          try {
            const client = await clientFor(email)
            let token: string | undefined
            do {
              const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList')
              url.searchParams.set('minAccessRole', 'owner')
              url.searchParams.set('maxResults', '250')
              if (token) url.searchParams.set('pageToken', token)
              const page = await client.getJson<CalendarListPage>(url.toString())
              if (!token && !page.items?.length && !page.nextPageToken)
                warnings.push(`No owned calendars could be found for ${email}.`)
              for (const calendar of page.items ?? []) {
                const label = `${calendar.summary} · ${email}`
                try {
                  const events = await listEvents(client, {
                    calendarId: calendar.id,
                    timeMin: `${day.addDays(-1).ymd}T00:00:00Z`,
                    timeMax: `${day.addDays(2).ymd}T00:00:00Z`,
                    timeZone: timing.timezone,
                  })
                  sources.push({ label, events })
                } catch {
                  warnings.push(`Could not check ${label}.`)
                }
              }
              token = page.nextPageToken
            } while (token)
          } catch {
            warnings.push(`Could not check calendars for ${email}.`)
          }
        }),
      )
      sources.sort((a, b) => a.label.localeCompare(b.label))
      warnings.sort()
      return availabilityOf(timing, sources, warnings, undefined, exclude)
    },
    create: async (fields, hooks) => {
      const client = await clientFor(fields.account)
      const primary = await client.getJson<{ id: string; summary: string }>(
        'https://www.googleapis.com/calendar/v3/calendars/primary',
      )
      return createCalendarMeeting(
        client,
        { ...fields, ...meetingInterval(fields), calendarId: primary.id, calendarName: primary.summary },
        hooks,
      )
    },
  }
}
