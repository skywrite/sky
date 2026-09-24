/**
 * Meetings for the day's rail: calendar events merged with the day's
 * inline notes and filed records. Local records survive calendar failures.
 * Each record matches at most one calendar event within the check's tolerance.
 */

import * as path from 'node:path'
import { Hono } from 'hono'
import { START_TOLERANCE_MINUTES } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import { fetchDayMeetings } from '#commands/all/google/calendar/lib/dayMeetings.ts'
import {
  calendarEventKey,
  classificationDir,
  setCalendarEventType,
  type CalendarEventType,
  type ClassifiedCalendarEvent,
  type EventClassification,
} from '#lib/calendarClassification/mod.ts'
import type { CalendarEvent } from '#lib/google/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { loadSkyConfig } from '#shared/config/loader.ts'
import type PeopleStore from '#shared/models/Store/PeopleStore/mod.ts'
import { dayDir, fetchNow } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { PersonScore } from '../../scoring/ScoringStore.ts'
import type { Store } from '../../store.ts'
import { createAttendeeNames } from './attendeeNames.ts'
import isDay from './isDay.ts'
import { buildDayRecord, type MeetingRow } from './record.ts'

export type ScheduleState = 'past' | 'now' | 'next'

export interface ScheduledMeeting {
  classification?: EventClassification
  calendarUrl?: string
  title: string
  /** `HH:MM`; empty for an all-day event */
  start: string
  end: string
  allDay: boolean
  /** Familiar names for known contacts; calendar labels or addresses for everyone else */
  who: string[]
  joinUrl: string | null
  state: ScheduleState
  /** The notebook's record of it, relative to the notebook root, when one is filed */
  record: { path: string; title: string; inline?: boolean } | null
}

export interface DaySchedule {
  /** Whether the calendar answered; local records remain available when it did not */
  read: boolean
  errors: string[]
  meetings: ScheduledMeeting[]
  notifications?: ScheduledMeeting[]
  hideNotifications?: boolean
  classificationWarning?: string
}

/** The notebook clock the states are judged by; extended hours legal. */
export interface ScheduleClock {
  date: string
  time: string
}

/** Answers one day's schedule. Never throws. */
export type ScheduleHost = ((day: PlainDate) => Promise<DaySchedule>) & {
  setType?: (day: PlainDate, key: string, type: CalendarEventType | null) => Promise<boolean>
}

/** `HH:MM` (extended hours legal) to minutes. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** The `HH:MM` a record's `when:` starts with, if it has one. */
function recordStart(row: MeetingRow): string | null {
  return row.when?.match(/^(\d{1,2}:\d{2})/)?.[1] ?? null
}

/**
 * Where a meeting stands against the clock. Another day is wholly past or
 * wholly ahead; on the day itself the clock falls before, inside, or after
 * the meeting. A civil comparison on the calendar's own day, as the
 * meeting check makes it.
 */
function stateOf(event: CalendarEvent, day: string, clock: ScheduleClock): ScheduleState {
  if (day < clock.date) return 'past'
  if (day > clock.date) return 'next'
  if (event.allDay) return 'now'
  const now = minutesOf(clock.time)
  if (now >= minutesOf(event.end.slice(11, 16))) return 'past'
  if (now >= minutesOf(event.start.slice(11, 16))) return 'now'
  return 'next'
}

/** The schedule from sources already read. Pure. */
export function scheduleOf(input: {
  day: string
  events: ClassifiedCalendarEvent[]
  notifications?: ClassifiedCalendarEvent[]
  hideNotifications?: boolean
  classificationWarning?: string
  records: MeetingRow[]
  clock: ScheduleClock
  read: boolean
  errors: string[]
  people?: PeopleStore | null
  personScores?: readonly PersonScore[]
}): DaySchedule {
  const attendeeNames = createAttendeeNames(input.people, input.personScores)
  const remaining = new Set(input.records)
  const recordOf = (event: CalendarEvent): ScheduledMeeting['record'] => {
    if (event.allDay) return null
    const start = minutesOf(event.start.slice(11, 16))
    const match = [...remaining]
      .filter((row) => {
        const at = recordStart(row)
        return at !== null && Math.abs(minutesOf(at) - start) <= START_TOLERANCE_MINUTES
      })
      .sort((a, b) => Math.abs(minutesOf(recordStart(a)!) - start) - Math.abs(minutesOf(recordStart(b)!) - start))[0]
    if (!match) return null
    remaining.delete(match)
    return { path: match.path, title: match.title, inline: match.inline }
  }
  const meetings = input.events.map(
    (event): ScheduledMeeting => ({
      classification: event.classification,
      calendarUrl: event.htmlLink,
      title: event.title,
      start: event.allDay ? '' : event.start.slice(11, 16),
      end: event.allDay ? '' : event.end.slice(11, 16),
      allDay: event.allDay,
      who: attendeeNames(event.attendees),
      joinUrl: event.conferenceUrl ?? null,
      state: stateOf(event, input.day, input.clock),
      record: recordOf(event),
    }),
  )
  for (const row of remaining) {
    meetings.push({
      title: row.title,
      start: recordStart(row) ?? '',
      end: '',
      allDay: false,
      who: row.who ? [row.who] : [],
      joinUrl: null,
      state: 'past',
      record: { path: row.path, title: row.title, inline: row.inline },
    })
  }
  meetings.sort(
    (a, b) =>
      (a.allDay ? -1 : a.start ? minutesOf(a.start) : Infinity) -
      (b.allDay ? -1 : b.start ? minutesOf(b.start) : Infinity),
  )
  const notifications = (input.notifications ?? []).map(
    (event): ScheduledMeeting => ({
      title: event.title,
      start: event.allDay ? '' : event.start.slice(11, 16),
      end: event.allDay ? '' : event.end.slice(11, 16),
      allDay: event.allDay,
      who: attendeeNames(event.attendees),
      joinUrl: null,
      state: stateOf(event, input.day, input.clock),
      record: null,
      classification: event.classification,
      calendarUrl: event.htmlLink,
    }),
  )
  return {
    read: input.read,
    errors: input.errors,
    meetings,
    notifications,
    hideNotifications: input.hideNotifications === true,
    classificationWarning: input.classificationWarning,
  }
}

/**
 * The production host: the calendar through the keychain's Google grants,
 * the records from the day's directory, the clock from the notebook.
 * Account errors beside meetings still make a schedule; errors alone do
 * not.
 */
export function createDayScheduleHost(options: {
  timeDir: string
  markdownBaseDir: string
  people?: PeopleStore | null
  scores?: Pick<Store, 'getPeopleWithScores'>
}): ScheduleHost {
  const secrets = new KeychainSecretsProvider()
  const schedule: ScheduleHost = async (day) => {
    const [calendar, record] = await Promise.all([
      fetchDayMeetings(secrets, day, options.timeDir).catch((err: unknown) => ({
        meetings: [] as CalendarEvent[],
        notifications: [] as ClassifiedCalendarEvent[],
        classificationWarning: undefined,
        errors: [err instanceof Error ? err.message : String(err)],
      })),
      buildDayRecord({
        day,
        timeDir: options.timeDir,
        dayDirPath: path.join(options.timeDir, dayDir(day)),
        markdownBaseDir: options.markdownBaseDir,
        ownerNames: [],
      }).catch(() => null),
    ])
    const now = (await fetchNow({ timeDir: options.timeDir })).plainDateTime
    return scheduleOf({
      day: day.ymd,
      events: calendar.meetings,
      notifications: calendar.notifications,
      hideNotifications: loadSkyConfig().calendar?.classifyEvents === true,
      classificationWarning: calendar.classificationWarning,
      records: record?.meetings ?? [],
      clock: { date: now.plainDate.ymd, time: now.time },
      read: calendar.meetings.length > 0 || calendar.notifications.length > 0 || calendar.errors.length === 0,
      errors: calendar.errors,
      people: options.people,
      personScores: options.scores?.getPeopleWithScores(),
    })
  }
  schedule.setType = async (day, key, type) => {
    const current = await fetchDayMeetings(secrets, day, options.timeDir)
    const event = [...current.meetings, ...current.notifications].find((event) => calendarEventKey(event) === key)
    if (!event) return false
    await setCalendarEventType(classificationDir(loadSkyConfig().userDataDir), key, type, event)
    return true
  }
  return schedule
}

/** `GET /:ymd/schedule` — the day's schedule; 404 for anything that is not a day. */
export function createScheduleRoutes(schedule: ScheduleHost): Hono {
  const app = new Hono()
  app.get('/:ymd/schedule', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return c.json(await schedule(new PlainDate(ymd)))
  })
  app.post('/:ymd/schedule/type', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ message: 'Invalid day.' }, 404)
    if (!schedule.setType) return c.json({ message: 'Calendar corrections are unavailable.' }, 503)
    const body = (await c.req.json().catch(() => null)) as { key?: unknown; type?: unknown } | null
    if (
      typeof body?.key !== 'string' ||
      !/^[a-f0-9]{64}$/.test(body.key) ||
      (body.type !== 'meeting' && body.type !== 'notification' && body.type !== null)
    ) {
      return c.json({ message: 'Choose a meeting, a notification, or automatic classification.' }, 400)
    }
    try {
      const saved = await schedule.setType(new PlainDate(ymd), body.key, body.type)
      return saved ? c.json({ ok: true }) : c.json({ message: 'This calendar event is no longer on this day.' }, 404)
    } catch {
      return c.json({ message: 'Could not save the event type. Try again.' }, 500)
    }
  })
  return app
}
