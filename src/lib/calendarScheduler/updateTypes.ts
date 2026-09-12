import type { CalendarAvailability, CalendarFields, CalendarInvitee, CalendarSchedulerHost } from './types.ts'

export interface CalendarEventRef {
  account: string
  calendarId: string
  eventId: string
}

export interface CalendarEventFields extends Omit<CalendarFields, 'conference'> {
  location: string
}

/** A provider read, including the version the person reviewed. */
export interface CalendarEventSnapshot {
  ref: CalendarEventRef
  version: string
  fields: CalendarEventFields
  start: string
  end: string
  iCalUid?: string
  calendarName: string
  calendarUrl: string
  conferenceUrl?: string
  recurring: boolean
  resourceEmails: string[]
  unsupported: string[]
}

export interface CalendarEventSearch {
  query: string
  from: string
  to: string
  timezone: string
}

export interface CalendarUpdateRequest {
  request: string
  account?: string
  timezone?: string
  event?: CalendarEventRef
}

export interface CalendarUpdateDraft {
  changes: Partial<Omit<CalendarEventFields, 'account' | 'guests'>>
  addGuests: CalendarInvitee[]
  removeGuests: CalendarInvitee[]
  assumptions: string[]
  questions: string[]
  unsupported: string[]
}

export interface CalendarUpdatePreparation {
  status: 'ready' | 'needs_input' | 'unsupported'
  draftId?: string
  event?: CalendarEventSnapshot
  candidates: CalendarEventSnapshot[]
  fields?: CalendarEventFields
  addGuests: CalendarInvitee[]
  removeGuests: CalendarInvitee[]
  assumptions: string[]
  questions: string[]
  requestQuestions: string[]
  unsupported: string[]
  warnings: string[]
  availability?: CalendarAvailability
}

export interface CalendarUpdateReview {
  event: CalendarEventRef
  version: string
  fields: CalendarEventFields
  assumptions?: string[]
}

export interface CalendarUpdateHost {
  locate: (request: string, timezone: string, signal?: AbortSignal) => Promise<CalendarEventSearch>
  find: (
    search: CalendarEventSearch,
    accounts: string[],
  ) => Promise<{
    events: CalendarEventSnapshot[]
    warnings: string[]
  }>
  read: (ref: CalendarEventRef) => Promise<CalendarEventSnapshot>
  parse: (
    request: string,
    event: CalendarEventSnapshot,
    timezone: string,
    signal?: AbortSignal,
  ) => Promise<CalendarUpdateDraft>
  save: (
    event: CalendarEventSnapshot,
    fields: CalendarEventFields,
    hooks: Parameters<CalendarSchedulerHost['create']>[1],
  ) => ReturnType<CalendarSchedulerHost['create']>
}
