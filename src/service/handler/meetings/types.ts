/** Shared wire types for the meeting composer. Parsing and preview never create an event. */
export interface MeetingPerson {
  id: string
  name: string
  hint: string
  emails: string[]
}

export interface MeetingGuest {
  name: string
  email: string
}

export interface MeetingInvitee {
  query: string
  candidates: MeetingPerson[]
  /** A chosen contact can still need an email before it becomes an invitation. */
  personId?: string
  selected: MeetingGuest | null
}

export interface MeetingFields {
  title: string
  date: string
  time: string
  timezone: string
  duration: number
  account: string
  guests: MeetingGuest[]
  description: string
}

export type MeetingTiming = Pick<MeetingFields, 'date' | 'time' | 'timezone' | 'duration'>

export interface MeetingDraft {
  fields: MeetingFields
  invitees: MeetingInvitee[]
  assumptions: string[]
  questions: string[]
  unsupported: string[]
}

export interface MeetingSetup {
  date: string
  timezone: string
  accounts: string[]
}

export interface MeetingDayEvent {
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

export interface MeetingAvailability {
  date: string
  timezone: string
  events: MeetingDayEvent[]
  warnings: string[]
  calendars: string[]
  alternatives: string[]
  /** Acknowledges the exact conflicts and incomplete calendars visible in the review. */
  reviewKey: string
}

export interface CreatedMeeting {
  title: string
  calendarUrl: string
  zoomUrl: string
}

export interface MeetingJob {
  id: string
  state: 'creating' | 'created' | 'failed' | 'uncertain'
  message?: string
  result?: CreatedMeeting
}

export interface MeetingsHost {
  dir: string
  setup: () => Promise<MeetingSetup>
  people: (query: string) => Promise<MeetingPerson[]>
  parse: (query: string, timezone: string, signal?: AbortSignal) => Promise<MeetingDraft>
  availability: (timing: MeetingTiming) => Promise<MeetingAvailability>
  create: (
    fields: MeetingFields,
    hooks: { beforeSave: () => Promise<void>; saving: () => Promise<void> },
  ) => Promise<CreatedMeeting>
}
