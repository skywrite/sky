import { mkdtemp, rm } from 'node:fs/promises'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import { availabilityOf } from '../availability.ts'
import { CalendarScheduler } from '../CalendarScheduler.ts'
import type { CalendarSchedulerHost } from '../types.ts'
import type { CalendarEventFields, CalendarEventSnapshot, CalendarUpdateDraft } from '../updateTypes.ts'
import { meetingInterval } from '../validation.ts'

export const UPDATE_NOW = '2030-05-01T12:00:00Z'
export const UPDATE_EVENT: CalendarEventSnapshot = {
  ref: { account: 'organizer@example.com', calendarId: 'organizer@example.com', eventId: 'mock-event' },
  version: '"version-one"',
  fields: {
    title: 'Atlas review',
    date: '2030-05-03',
    time: '15:00',
    timezone: 'America/New_York',
    duration: 30,
    account: 'organizer@example.com',
    guests: [{ name: 'Jane Doe', email: 'jane@example.com' }],
    description: 'Discuss the launch.',
    location: 'Room 2',
  },
  start: '2030-05-03T15:00:00-04:00',
  end: '2030-05-03T15:30:00-04:00',
  iCalUid: 'mock-uid',
  calendarName: 'Work',
  calendarUrl: 'https://example.com/calendar/mock-event',
  conferenceUrl: 'https://zoom.us/j/12345678901?pwd=example',
  recurring: false,
  resourceEmails: [],
  unsupported: [],
}

export const eventForAvailability = (event: CalendarEventSnapshot): CalendarEvent => ({
  id: event.ref.eventId,
  calendarId: event.ref.calendarId,
  iCalUid: event.iCalUid,
  account: event.ref.account,
  title: event.fields.title,
  start: event.start,
  end: event.end,
  allDay: false,
  attendees: [],
  eventType: 'default',
  status: 'confirmed',
})

export async function withUpdateFixture(
  run: (state: {
    host: CalendarSchedulerHost
    state: {
      event: CalendarEventSnapshot
      candidates: CalendarEventSnapshot[]
      warnings: string[]
      parsed: CalendarUpdateDraft
      parses: number
      searches: number
    }
    saved: { event: CalendarEventSnapshot; fields: CalendarEventFields }[]
    scheduler: CalendarScheduler
  }) => Promise<void>,
) {
  const dir = await mkdtemp('/tmp/sky-calendar-update-')
  const state = {
    event: structuredClone(UPDATE_EVENT),
    candidates: [structuredClone(UPDATE_EVENT)],
    warnings: [] as string[],
    parses: 0,
    searches: 0,
    parsed: {
      changes: { time: '16:00' },
      addGuests: [],
      removeGuests: [],
      assumptions: [],
      questions: [],
      unsupported: [],
    } as CalendarUpdateDraft,
  }
  const saved: { event: CalendarEventSnapshot; fields: CalendarEventFields }[] = []
  const host: CalendarSchedulerHost = {
    dir,
    setup: async () => ({
      accounts: [UPDATE_EVENT.ref.account],
      date: '2030-05-01',
      timezone: UPDATE_EVENT.fields.timezone,
    }),
    people: async () => [],
    parse: async () => {
      throw new Error('Updates must not use the creation parser.')
    },
    create: async () => {
      throw new Error('Updates must not create replacement events.')
    },
    availability: async (timing, exclude) =>
      availabilityOf(timing, [{ label: 'Work', events: [eventForAvailability(state.event)] }], [], UPDATE_NOW, exclude),
    updates: {
      locate: async (_request, timezone) => {
        state.searches++
        return { query: 'Atlas', from: '2030-05-03', to: '2030-05-04', timezone }
      },
      find: async () => ({ events: structuredClone(state.candidates), warnings: [...state.warnings] }),
      read: async () => structuredClone(state.event),
      parse: async () => {
        state.parses++
        return structuredClone(state.parsed)
      },
      save: async (event, fields, hooks) => {
        await hooks.beforeSave()
        await hooks.saving()
        saved.push(structuredClone({ event, fields }))
        const interval = meetingInterval(fields)
        state.event = { ...state.event, fields, start: interval.start, end: interval.end, version: '"version-two"' }
        return {
          title: fields.title,
          calendarUrl: event.calendarUrl,
          zoomUrl: event.conferenceUrl ?? '',
          event: event.ref,
        }
      },
    },
  }
  try {
    await run({ host, state, saved, scheduler: new CalendarScheduler(host, { now: () => UPDATE_NOW }) })
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

export async function finishedUpdate(scheduler: CalendarScheduler, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await scheduler.get(id)
    if (job && job.state !== 'creating' && job.state !== 'updating') return job
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('The test update did not finish.')
}
