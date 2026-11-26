import type {
  CalendarAvailability,
  CalendarBrowserState,
  CalendarDraft,
  CalendarSetup,
} from '#lib/calendarScheduler/types.ts'

export type MeetingBlockerTarget =
  | 'prompt'
  | 'unsupported'
  | 'account'
  | 'connections'
  | 'title'
  | 'invitee'
  | 'date'
  | 'time'
  | 'timezone'
  | 'browser'
  | 'retry-parse'
  | 'retry-check'

export interface MeetingBlocker {
  message: string
  /** Optional control to jump to or retry action when clicked. */
  target?: MeetingBlockerTarget
  /** True while waiting on an in-flight request rather than user input. */
  pending?: boolean
}

export function defaultMeetingAccount(setup: CalendarSetup | null): string {
  if (!setup) return ''
  if (setup.defaultAccount && setup.accounts.includes(setup.defaultAccount)) return setup.defaultAccount
  return setup.accounts.length === 1 ? setup.accounts[0]! : ''
}

/**
 * The single reason the Create button is currently disabled, or null when ready.
 * Conflicts and incomplete calendar warnings never return a blocker.
 */
export function createBlocker(input: {
  draft: CalendarDraft | null
  setup: CalendarSetup | null
  setupError: string
  available: CalendarAvailability | null
  checking: boolean
  checkError: string
  parsing: boolean
  parseError: string
  stale: boolean
  unresolved: number
  connection: { enabled: boolean; ready: boolean; state: CalendarBrowserState | null }
}): MeetingBlocker | null {
  const {
    draft,
    setup,
    setupError,
    available,
    checking,
    checkError,
    parsing,
    parseError,
    stale,
    unresolved,
    connection,
  } = input
  if (!draft) return null
  const { fields } = draft
  if (stale && parseError) return { message: 'Couldn’t update details — retry to continue', target: 'retry-parse' }
  if (parsing || stale) return { message: 'Updating details…', pending: true }
  if (draft.unsupported.length > 0)
    return { message: 'Adjust the unsupported requirement above', target: 'unsupported' }
  if (!fields.account) {
    if (!setup) {
      return setupError
        ? { message: 'Could not load Google accounts', target: 'prompt' }
        : { message: 'Loading Google accounts…', pending: true }
    }
    if (!setup.accounts.length) {
      return { message: 'Connect a Google account in Settings → Connections', target: 'connections' }
    }
    return { message: 'Choose a From account to schedule', target: 'account' }
  }
  if (!fields.title.trim()) return { message: 'Add a meeting title', target: 'title' }
  if (unresolved > 0) {
    return {
      message: unresolved === 1 ? 'Choose an email for 1 invitee' : `Choose emails for ${unresolved} invitees`,
      target: 'invitee',
    }
  }
  if (checking || !available) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.date)) return { message: 'Choose a date', target: 'date' }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.time)) return { message: 'Choose a time', target: 'time' }
    if (!fields.timezone) return { message: 'Choose a timezone', target: 'timezone' }
    if (checkError) return { message: 'Couldn’t check calendars — retry check', target: 'retry-check' }
    return { message: 'Checking your calendars…', pending: true }
  }
  if (!connection.ready) {
    const state = connection.state?.state
    if (!state || state === 'checking' || state === 'busy')
      return { message: `Checking Google sign-in for ${fields.account}…`, pending: true }
    if (state === 'opening' || state === 'waiting')
      return { message: `Finish signing in as ${fields.account}`, target: 'browser' }
    return { message: `Sign in to Google as ${fields.account} to schedule`, target: 'browser' }
  }
  return null
}
