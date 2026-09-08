import type { CalendarEventRef, CalendarEventSnapshot, CalendarUpdateHost } from './updateTypes.ts'

/** Calendar scheduling values, separate from notebook meeting documents. */
export interface CalendarContact {
  id: string
  name: string
  hint: string
  emails: string[]
}

export interface CalendarGuest {
  name: string
  email: string
}

export interface CalendarInvitee {
  query: string
  candidates: CalendarContact[]
  /** A chosen contact can still need an email before it becomes an invitation. */
  personId?: string
  selected: CalendarGuest | null
}

export interface CalendarFields {
  title: string
  date: string
  time: string
  timezone: string
  duration: number
  account: string
  guests: CalendarGuest[]
  description: string
}

export type CalendarTiming = Pick<CalendarFields, 'date' | 'time' | 'timezone' | 'duration'>

export interface CalendarDraft {
  fields: CalendarFields
  invitees: CalendarInvitee[]
  assumptions: string[]
  questions: string[]
  unsupported: string[]
}

export interface CalendarSetup {
  date: string
  timezone: string
  accounts: string[]
}

export interface CalendarDayEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  calendar: string
  busy: boolean
  conflict: boolean
  url?: string
}

export interface CalendarAvailability {
  date: string
  timezone: string
  events: CalendarDayEvent[]
  warnings: string[]
  calendars: string[]
  alternatives: string[]
  /** Acknowledges the exact conflicts and incomplete calendars visible in the review. */
  reviewKey: string
}

export interface CreatedCalendarEvent {
  title: string
  calendarUrl: string
  zoomUrl: string
  conferenceUrl?: string
  event?: CalendarEventRef
}

export interface CalendarJob {
  id: string
  state: 'creating' | 'created' | 'updating' | 'updated' | 'failed' | 'uncertain'
  operation?: 'update'
  message?: string
  result?: CreatedCalendarEvent
}

export interface CalendarSchedulerHost {
  dir: string
  setup: () => Promise<CalendarSetup>
  people: (query: string) => Promise<CalendarContact[]>
  parse: (query: string, timezone: string, signal?: AbortSignal) => Promise<CalendarDraft>
  availability: (timing: CalendarTiming, exclude?: CalendarEventSnapshot) => Promise<CalendarAvailability>
  updates?: CalendarUpdateHost
  create: (
    fields: CalendarFields,
    hooks: { beforeSave: () => Promise<void>; saving: () => Promise<void> },
  ) => Promise<CreatedCalendarEvent>
}

export interface CalendarRequest {
  request: string
  account?: string
  timezone?: string
}

export interface CalendarPreparation extends CalendarDraft {
  status: 'ready' | 'needs_input' | 'unsupported'
  draftId?: string
  accounts: string[]
  availability?: CalendarAvailability
  /** Questions about the request itself; contact and account choices have their own pickers. */
  requestQuestions: string[]
}

export interface CalendarReview {
  fields: CalendarFields
  assumptions?: string[]
}
