import type { CalendarEventRef, CalendarEventSnapshot, CalendarUpdateHost } from './updateTypes.ts'

/** Calendar scheduling values, separate from notebook meeting documents. */
export interface CalendarContact {
  id: string
  name: string
  hint: string
  emails: string[]
  /** Stored names/nicknames used for exact identity matches, never inferred by the model. */
  aliases?: string[]
  /** Same combined interaction score used by notebook contact completion. */
  interactionScore?: number
}

export interface CalendarGuest {
  name: string
  email: string
}

export interface CalendarRecurrence {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number
  ends: { type: 'never' } | { type: 'on'; date: string } | { type: 'after'; count: number }
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
  /** One native series, anchored to the start date and local time. Omitted for a single event. */
  recurrence?: CalendarRecurrence
  account: string
  guests: CalendarGuest[]
  /** Defaults to no conference for solo events, or Zoom when guests are invited. */
  conference?: 'none' | 'zoom'
  description: string
}

export type CalendarTiming = Pick<CalendarFields, 'date' | 'time' | 'timezone' | 'duration' | 'recurrence'>

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
  browserSignIn?: boolean
}

export interface CalendarBrowserState {
  account: string
  state: 'checking' | 'sign_in_required' | 'opening' | 'waiting' | 'signed_in' | 'failed' | 'busy'
  message?: string
}

export interface CalendarBrowserHost {
  check: (account: string, signal: AbortSignal) => Promise<boolean>
  signIn: (account: string, signal: AbortSignal, opened: () => void) => Promise<void>
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
  scope?: 'first_occurrence'
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
  /** Current attempt behind this stable draft/job ID. A retry must name the failure it reviewed. */
  attemptId?: string
  /** When this attempt finished, as Unix milliseconds; unchanged when its receipt is read again. */
  finishedAt?: number
  /** Only a confirmed failure before Save can be retried. */
  retryable?: boolean
  /** Authoritative reviewed details, including edits made in the approval widget. */
  fields?: CalendarFields
  state: 'creating' | 'created' | 'updating' | 'updated' | 'failed' | 'uncertain'
  operation?: 'update'
  message?: string
  recovery?: 'google_sign_in'
  result?: CreatedCalendarEvent
}

export interface CalendarJobBatch {
  state: 'creating' | 'created' | 'failed' | 'uncertain'
  jobs: CalendarJob[]
}

export interface CalendarApproval {
  summary: string
  /** Derived from saved guests, including guests removed by an update. */
  needsApproval: boolean
  /** Exact saved creation draft, for interactive review in chat. */
  draft?: CalendarPreparedDraft
}

export interface CalendarPreparedDraft {
  id: string
  fields: CalendarFields
  assumptions: string[]
  reviewKey: string
  availability?: CalendarAvailability
  job?: CalendarJob
}

export interface CalendarSchedulerHost {
  dir: string
  setup: () => Promise<CalendarSetup>
  browser?: CalendarBrowserHost
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
  /** When supplied by an editor, changed availability requires another review. */
  reviewKey?: string
}
