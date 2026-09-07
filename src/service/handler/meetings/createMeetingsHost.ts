import * as path from 'node:path'
import { createCalendarZoomMeeting } from '#commands/all/google/calendar/lib/createMeeting.ts'
import {
  GoogleClient,
  hasCalendarScope,
  listAccountEmails,
  listEvents,
  loadAccountTokens,
  loadOAuthClient,
} from '#lib/google/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { readSystemTimezone } from '#lib/sys/mod.ts'
import type * as ConfigModule from '#shared/config.ts'
import type MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { calendarNow, PlainDate } from '#universal/dates/nbdt/mod.ts'
import { currentTimezoneIANA } from '#universal/dates/timezones/mod.ts'
import type { Store } from '../../store.ts'
import { availabilityOf, type CalendarSourceEvents } from './availability.ts'
import { parseMeeting } from './parse.ts'
import { meetingPeople } from './people.ts'
import type { MeetingsHost } from './types.ts'
import { meetingInterval } from './validation.ts'

interface CalendarListPage {
  items?: Array<{ id: string; summary: string; primary?: boolean }>
  nextPageToken?: string
}

export function createMeetingsHost(
  config: typeof ConfigModule,
  store: () => MarkdownStore | null,
  scores: Pick<Store, 'getPeopleWithScores'>,
): MeetingsHost {
  const secrets = new KeychainSecretsProvider()
  const accounts = async () => {
    const found: string[] = []
    for (const email of await listAccountEmails(secrets)) {
      const tokens = await loadAccountTokens(secrets, email)
      if (tokens && hasCalendarScope(tokens)) found.push(email.toLowerCase())
    }
    return found
  }
  const clientFor = async (email: string) => {
    const client = await loadOAuthClient(secrets)
    if (!client) throw new Error('Connect Google Calendar in Settings → Connections.')
    return new GoogleClient({ secrets, email, client })
  }
  const people = async (query: string) => meetingPeople(store(), query, scores.getPeopleWithScores())
  return {
    dir: path.join(config.DIR_USER_DATA, 'meetings'),
    setup: async () => {
      const timezone = (await readSystemTimezone()) ?? currentTimezoneIANA()
      return { date: calendarNow(timezone).date, timezone, accounts: await accounts() }
    },
    people,
    parse: (query, timezone, signal) => parseMeeting(query, timezone, people, signal),
    availability: async (timing) => {
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
      return availabilityOf(timing, sources, warnings)
    },
    create: async (fields, hooks) => {
      const client = await clientFor(fields.account)
      const primary = await client.getJson<{ id: string; summary: string }>(
        'https://www.googleapis.com/calendar/v3/calendars/primary',
      )
      return createCalendarZoomMeeting(
        client,
        { ...fields, ...meetingInterval(fields), calendarId: primary.id, calendarName: primary.summary },
        hooks,
      )
    },
  }
}
