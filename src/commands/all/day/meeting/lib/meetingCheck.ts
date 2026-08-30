/**
 * A day's calendar meetings checked against the notebook's meeting
 * records — the check behind day:meeting:check, shared with the chat and
 * voice hosts that carry it into a model's context.
 *
 * The notebook side is the service's meetings query, never a file walk. A
 * notebook meeting starting within START_TOLERANCE_MINUTES of a calendar
 * meeting counts as its record; extra notebook meetings — ad-hoc calls
 * that never hit the calendar — are fine and ignored. Fetching never
 * throws: an unreachable calendar or service lands in the result as an
 * error and an unread side, because a check must never hold the notebook,
 * or a conversation, hostage.
 */

import * as path from 'node:path'
import { fetchDayMeetings, formatEventWhen, formatEventWho } from '#commands/all/google/calendar/lib/dayMeetings.ts'
import type { CalendarEvent } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { PORT_SERVER } from '#shared/config.ts'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { type PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import hasEndOrLength from './hasEndOrLength.ts'

const GRAPHQL_URL = `http://localhost:${PORT_SERVER}/graphql`

/** A recording that started a few minutes late is still the same meeting. */
export const START_TOLERANCE_MINUTES = 15

/** Attendees named per meeting before the rest collapse to a count. */
const NAMED_ATTENDEES = 8

export interface NotebookMeeting {
  who: string
  medium: string
  when: { datetime: string; end: string | null } | null
}

/** A calendar meeting and the notebook meeting that records it, if one does. */
export interface CheckedMeeting {
  event: CalendarEvent
  record: NotebookMeeting | null
}

/** A meeting or event record whose `when:` states no end time or length. */
export interface Endless {
  start: string
  label: string
  kind: 'meeting' | 'event'
}

export interface MeetingCheck {
  /** The day checked, YYYY-MM-DD */
  day: string
  /** IANA zone the calendar day was evaluated in; null when the calendar never answered */
  timeZone: string | null
  /** Whether the calendar answered — false leaves `meetings` empty and `errors` saying why */
  calendarRead: boolean
  /** Whether the service answered — false leaves every `record` null */
  notebookRead: boolean
  /** The calendar's meetings in start order, each with its record */
  meetings: CheckedMeeting[]
  /** Records missing an end time, in start order — notebook-only, so present whatever the calendar did */
  endless: Endless[]
  errors: string[]
}

/** The three sources, each already fetched or failed. */
export interface MeetingCheckSources {
  calendar: { timeZone: string | null; meetings: CalendarEvent[]; errors: string[] }
  /** The notebook's meetings, or null when the service could not answer */
  notebook: NotebookMeeting[] | null
  /** Start-only records from the day's actions/events/ */
  events: Endless[]
}

/** `HH:MM` (extended hours legal) to minutes; the sign belongs to the hour bucket. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function recordOf(event: CalendarEvent, notebook: NotebookMeeting[]): NotebookMeeting | null {
  const start = minutesOf(event.start.slice(11, 16))
  return (
    notebook.find(
      (m) => m.when && Math.abs(minutesOf(m.when.datetime.slice(11, 16)) - start) <= START_TOLERANCE_MINUTES,
    ) ?? null
  )
}

/** Match the sources for one day. Pure: every read has already happened. */
export function compareDayMeetings(day: string, sources: MeetingCheckSources): MeetingCheck {
  const { calendar, notebook, events } = sources
  // Account errors alongside meetings still make a check; errors alone do not.
  const calendarRead = calendar.meetings.length > 0 || calendar.errors.length === 0
  const meetings: CheckedMeeting[] = calendarRead
    ? calendar.meetings.map((event) => ({ event, record: notebook ? recordOf(event, notebook) : null }))
    : []

  const endless: Endless[] = []
  for (const m of notebook ?? []) {
    if (m.when && !m.when.end) {
      endless.push({ start: m.when.datetime.slice(11, 16), label: `${m.medium}: ${m.who}`, kind: 'meeting' })
    }
  }
  endless.push(...events)
  endless.sort((a, b) => a.start.localeCompare(b.start))

  return {
    day,
    timeZone: calendar.timeZone,
    calendarRead,
    notebookRead: notebook !== null,
    meetings,
    endless,
    errors: calendar.errors,
  }
}

/** The check for one day, every source read. Never throws. */
export async function checkDayMeetings(
  secrets: SecretsProvider,
  day: PlainDate,
  timeDir: string,
): Promise<MeetingCheck> {
  const [calendar, notebook, events] = await Promise.all([
    // Even a keychain failure below the calendar fetch degrades to an error line.
    fetchDayMeetings(secrets, day).catch((err: unknown) => ({
      timeZone: null,
      meetings: [],
      errors: [err instanceof Error ? err.message : String(err)],
    })),
    fetchNotebookMeetings(day.ymd),
    fetchEndlessEvents(timeDir, day),
  ])
  return compareDayMeetings(day.ymd, { calendar, notebook, events })
}

/** The day's meetings from the local service, or null when it can't answer. */
async function fetchNotebookMeetings(ymd: string): Promise<NotebookMeeting[] | null> {
  const query = `{ meetings(where: { date: "${ymd}" }) { who medium when { datetime end } } }`
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: { meetings?: NotebookMeeting[] }; errors?: unknown[] }
    if (body.errors && body.errors.length > 0) return null
    return body.data?.meetings ?? []
  } catch {
    return null
  }
}

/**
 * Start-only records from the day's actions/events/ — calendar-sourced
 * events aren't queryable on the service yet, and this is a frontmatter
 * completeness read of one bounded directory, not record matching (which
 * stays on GraphQL). Any failure reads as "no events".
 */
async function fetchEndlessEvents(timeDir: string, day: PlainDate): Promise<Endless[]> {
  const eventsDir = path.join(timeDir, dayDir(day), 'actions', 'events')
  const endless: Endless[] = []
  try {
    for await (const entry of readDir(eventsDir)) {
      if (!entry.name.endsWith('.md')) continue
      const content = await readTextFile(path.join(eventsDir, entry.name))
      const when = content.match(/^when:[ \t]*(.+)$/m)?.[1]?.trim()
      if (!when || hasEndOrLength(when)) continue
      const what = content.match(/^what:[ \t]*(.+)$/m)?.[1]?.trim()
      endless.push({ start: when.slice(11, 16), label: what || entry.name.replace(/\.md$/, ''), kind: 'event' })
    }
  } catch {
    // No events directory, or unreadable — nothing to nudge about.
  }
  return endless
}

// ---------------------------------------------------------------------------
// The check as a model reads it
// ---------------------------------------------------------------------------

/** The notebook clock a render judges "past" and "upcoming" by; extended hours legal. */
export interface CheckClock {
  date: string
  time: string
}

type Status = 'logged' | 'not logged' | 'in progress' | 'upcoming' | 'unchecked'

/** Where a meeting stands against the clock: signed minutes to its start and to its end. */
interface Distance {
  toStart: number
  toEnd: number
}

/**
 * Wall-clock minutes from the notebook clock to a calendar timestamp. The
 * calendar renders its times in the system zone and the notebook clock
 * reads in the notebook's, so this is a civil difference, never absolute
 * time — the same footing the record match stands on. A 25:30 clock
 * normalizes to 01:30 the next day inside `until`.
 */
function minutesUntil(clock: PlainDateTime, rfc3339: string): number {
  return clock.until(new PlainDateTime({ date: rfc3339.slice(0, 10), time: rfc3339.slice(11, 16) })).total('minutes')
}

function distanceOf(event: CalendarEvent, clock: PlainDateTime): Distance {
  return { toStart: minutesUntil(clock, event.start), toEnd: minutesUntil(clock, event.end) }
}

function statusOf(meeting: CheckedMeeting, distance: Distance, notebookRead: boolean): Status {
  if (meeting.record) return 'logged'
  if (distance.toStart > 0) return 'upcoming'
  if (distance.toEnd > 0) return 'in progress'
  return notebookRead ? 'not logged' : 'unchecked'
}

/**
 * A span in whole words at the scale that matters: minutes under an hour,
 * hours and minutes under a day, days and hours beyond.
 */
function spanWords(minutes: number): string {
  const total = Math.round(Math.abs(minutes))
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const mins = total % 60
  if (days > 0) return hours > 0 ? `${unit(days, 'day')} ${unit(hours, 'hour')}` : unit(days, 'day')
  if (hours > 0) return mins > 0 ? `${unit(hours, 'hour')} ${unit(mins, 'minute')}` : unit(hours, 'hour')
  return unit(mins, 'minute')
}

/** How far away a meeting is: its start ahead, its span around the clock, or its end behind. */
function distanceWords({ toStart, toEnd }: Distance): string {
  if (toStart > 0) return `in ${spanWords(toStart)}`
  if (toEnd > 0) {
    const started = toStart === 0 ? 'started just now' : `started ${spanWords(toStart)} ago`
    return `${started}, ends in ${spanWords(toEnd)}`
  }
  return toEnd === 0 ? 'ended just now' : `ended ${spanWords(toEnd)} ago`
}

/** One meeting's line: the absolute time paired with its distance, the people, then the status. */
function describe(meeting: CheckedMeeting, status: Status, distance: Distance): string {
  const { event, record } = meeting
  const head =
    `${formatEventWhen(event)} (${distanceWords(distance)})  ${event.title || '(untitled)'}` +
    formatEventWho(event, NAMED_ATTENDEES)
  switch (status) {
    case 'logged':
      return `${head}  — logged (${record?.medium}: ${record?.who})`
    case 'not logged':
      return `${head}  — not logged: the notebook has no record of it`
    case 'unchecked':
      return head
    default:
      return `${head}  — ${status}`
  }
}

/**
 * The check as a model reads it: one line per calendar meeting and whether
 * the notebook records it, judged against the clock — a meeting that has
 * not started is upcoming, not unlogged. The chat context and the voice
 * persona carry this same text, so it is plain enough for the ear.
 */
export function renderMeetingCheck(check: MeetingCheck, now: CheckClock): string {
  const zone = check.timeZone ? ` (${check.timeZone})` : ''
  const asOf = `as of ${now.date} ${now.time}`
  const lines: string[] = []

  if (!check.calendarRead) {
    lines.push(`The calendar for ${check.day} could not be checked ${asOf}: ${check.errors.join('; ')}`)
  } else if (check.meetings.length === 0) {
    lines.push(`No meetings on the calendar for ${check.day}${zone}, ${asOf}.`)
  } else {
    const clock = new PlainDateTime({ date: now.date, time: now.time })
    const distances = check.meetings.map((m) => distanceOf(m.event, clock))
    const statuses = check.meetings.map((m, i) => statusOf(m, distances[i], check.notebookRead))
    const counts = (['logged', 'not logged', 'in progress', 'upcoming'] as const)
      .map((s) => [statuses.filter((x) => x === s).length, s] as const)
      .filter(([n]) => n > 0)
      .map(([n, s]) => `${n} ${s}`)
    const total = check.meetings.length === 1 ? '1 meeting' : `${check.meetings.length} meetings`
    const tally = check.notebookRead
      ? `: ${counts.join(', ')}.`
      : '. The notebook could not be queried, so which of them are logged is unknown.'
    lines.push(
      `Calendar for ${check.day}${zone}, checked against the notebook's meeting records ${asOf} — ${total}${tally}`,
    )
    lines.push('')
    check.meetings.forEach((m, i) => lines.push(`- ${describe(m, statuses[i], distances[i])}`))
    lines.push('')
    lines.push(
      `A notebook meeting starting within ${START_TOLERANCE_MINUTES} minutes of a calendar meeting counts as its record. ` +
        'A meeting that is not logged is one the notebook knows nothing about: say so when it comes up, and never invent what happened in it.',
    )
  }

  if (check.endless.length > 0) {
    const items = check.endless.map((e) => `${e.start} ${e.label}${e.kind === 'event' ? ' (event)' : ''}`)
    lines.push('')
    lines.push(`Records stating no end time — the when: needs "- HH:MM" or a length: ${items.join('; ')}.`)
  }

  return lines.join('\n')
}

/** The block a host hands its model for one day: the check, rendered against the notebook clock. */
export async function renderDayCalendar(
  secrets: SecretsProvider,
  day: PlainDate,
  timeDir: string,
  now: CheckClock,
): Promise<string> {
  return renderMeetingCheck(await checkDayMeetings(secrets, day, timeDir), now)
}
