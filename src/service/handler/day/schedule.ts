/**
 * The day's schedule for the rail: the calendar's meetings for one day,
 * each judged against the notebook clock — past, now, or next — and, for
 * every one, whether the notebook filed a record of it. The record match
 * is the meeting check's own rule: a notebook meeting starting within its
 * tolerance of the calendar's start counts as the record.
 *
 * Read-only, and it never throws: a calendar that will not answer comes
 * back as `read: false` with its reasons, so the rail can say so.
 */

import * as path from 'node:path'
import { Hono } from 'hono'
import { START_TOLERANCE_MINUTES } from '#commands/all/day/meeting/lib/meetingCheck.ts'
import { fetchDayMeetings } from '#commands/all/google/calendar/lib/dayMeetings.ts'
import type { CalendarEvent } from '#lib/google/mod.ts'
import { KeychainSecretsProvider } from '#lib/secrets/KeychainSecretsProvider.ts'
import { dayDir, fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import isDay from './isDay.ts'
import { buildDayRecord, type MeetingRow } from './record.ts'

export type ScheduleState = 'past' | 'now' | 'next'

export interface ScheduledMeeting {
  title: string
  /** `HH:MM`; empty for an all-day event */
  start: string
  end: string
  allDay: boolean
  /** The other people in the room, names or addresses */
  who: string[]
  joinUrl: string | null
  state: ScheduleState
  /** The notebook's record of it, relative to the notebook root, when one is filed */
  record: { path: string; title: string } | null
}

export interface DaySchedule {
  /** Whether the calendar answered; false leaves `meetings` empty and `errors` saying why */
  read: boolean
  errors: string[]
  meetings: ScheduledMeeting[]
}

/** The notebook clock the states are judged by; extended hours legal. */
export interface ScheduleClock {
  date: string
  time: string
}

/** Answers one day's schedule. Never throws. */
export type ScheduleHost = (day: PlainDate) => Promise<DaySchedule>

/** `HH:MM` (extended hours legal) to minutes. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** The `HH:MM` a record's `when:` starts with, if it has one. */
function recordStart(row: MeetingRow): string | null {
  return row.when?.match(/^(\d{1,2}:\d{2})/)?.[1] ?? null
}

function recordOf(event: CalendarEvent, records: MeetingRow[]): ScheduledMeeting['record'] {
  if (event.allDay) return null
  const start = minutesOf(event.start.slice(11, 16))
  const match = records.find((row) => {
    const at = recordStart(row)
    return at !== null && Math.abs(minutesOf(at) - start) <= START_TOLERANCE_MINUTES
  })
  return match ? { path: match.path, title: match.title } : null
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
  events: CalendarEvent[]
  records: MeetingRow[]
  clock: ScheduleClock
  read: boolean
  errors: string[]
}): DaySchedule {
  if (!input.read) return { read: false, errors: input.errors, meetings: [] }
  const meetings = input.events.map(
    (event): ScheduledMeeting => ({
      title: event.title,
      start: event.allDay ? '' : event.start.slice(11, 16),
      end: event.allDay ? '' : event.end.slice(11, 16),
      allDay: event.allDay,
      who: event.attendees.filter((a) => !a.self).map((a) => a.name ?? a.email),
      joinUrl: event.conferenceUrl ?? null,
      state: stateOf(event, input.day, input.clock),
      record: recordOf(event, input.records),
    }),
  )
  return { read: true, errors: input.errors, meetings }
}

/**
 * The production host: the calendar through the keychain's Google grants,
 * the records from the day's directory, the clock from the notebook.
 * Account errors beside meetings still make a schedule; errors alone do
 * not.
 */
export function createDayScheduleHost(options: { timeDir: string; markdownBaseDir: string }): ScheduleHost {
  const secrets = new KeychainSecretsProvider()
  return async (day) => {
    const [calendar, record] = await Promise.all([
      fetchDayMeetings(secrets, day).catch((err: unknown) => ({
        meetings: [] as CalendarEvent[],
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
    const now = fetchNowSync().plainDateTime
    return scheduleOf({
      day: day.ymd,
      events: calendar.meetings,
      records: record?.meetings ?? [],
      clock: { date: now.plainDate.ymd, time: now.time },
      read: calendar.meetings.length > 0 || calendar.errors.length === 0,
      errors: calendar.errors,
    })
  }
}

/** `GET /:ymd/schedule` — the day's schedule; 404 for anything that is not a day. */
export function createScheduleRoutes(schedule: ScheduleHost): Hono {
  const app = new Hono()
  app.get('/:ymd/schedule', async (c) => {
    const ymd = c.req.param('ymd')
    if (!isDay(ymd)) return c.json({ error: `not a day: ${ymd}` }, 404)
    return c.json(await schedule(new PlainDate(ymd)))
  })
  return app
}
