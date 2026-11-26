import type { CalendarAvailability, CalendarDraft, CalendarSetup } from '#lib/calendarScheduler/types.ts'
import { assert, test } from '#test'
import { createBlocker, defaultMeetingAccount } from './createBlocker.ts'

const DRAFT: CalendarDraft = {
  fields: {
    title: 'Atlas review',
    date: '2030-05-03',
    time: '15:00',
    timezone: 'America/New_York',
    duration: 30,
    account: 'work@example.com',
    guests: [],
    description: '',
  },
  invitees: [{ query: 'Jane', candidates: [], selected: { name: 'Jane Doe', email: 'jane@example.com' } }],
  assumptions: [],
  questions: [],
  unsupported: [],
}

const SETUP: CalendarSetup = {
  date: '2030-05-01',
  timezone: 'America/New_York',
  accounts: ['work@example.com', 'personal@example.com'],
  defaultAccount: 'work@example.com',
}

const AVAILABLE_WITH_CONFLICT: CalendarAvailability = {
  date: '2030-05-03',
  timezone: 'America/New_York',
  calendars: ['Work'],
  warnings: ['Could not check Personal.'],
  alternatives: ['16:00'],
  reviewKey: 'a'.repeat(64),
  events: [
    {
      id: 'busy',
      title: 'Hold',
      start: '2030-05-03T15:00:00-04:00',
      end: '2030-05-03T16:00:00-04:00',
      allDay: false,
      calendar: 'Work',
      busy: true,
      conflict: true,
    },
  ],
}

const baseInput = (): Parameters<typeof createBlocker>[0] => ({
  draft: structuredClone(DRAFT),
  setup: SETUP,
  setupError: '',
  available: AVAILABLE_WITH_CONFLICT,
  checking: false,
  checkError: '',
  parsing: false,
  parseError: '',
  stale: false,
  unresolved: 0,
  connection: { enabled: false, ready: true, state: null },
})

test('defaultMeetingAccount prefers a valid defaultAccount and falls back to a sole account', () => {
  assert({
    given: 'null setup, single account without default, multiple accounts with and without default, and stale default',
    should: 'choose only an unambiguous default account',
    actual: [
      defaultMeetingAccount(null),
      defaultMeetingAccount({ ...SETUP, accounts: ['only@example.com'], defaultAccount: undefined }),
      defaultMeetingAccount(SETUP),
      defaultMeetingAccount({ ...SETUP, defaultAccount: undefined }),
      defaultMeetingAccount({ ...SETUP, defaultAccount: 'removed@example.com' }),
    ],
    expected: ['', 'only@example.com', 'work@example.com', '', ''],
  })
})

test('createBlocker never blocks on conflicts or incomplete calendar warnings', () => {
  assert({
    given: 'a complete draft with overlapping events and incomplete calendar warnings',
    should: 'return no blocker so scheduling stays enabled',
    actual: createBlocker(baseInput()),
    expected: null,
  })
})

test('createBlocker explains every disabled condition with an actionable target or pending state', () => {
  const noAccount = baseInput()
  noAccount.draft!.fields.account = ''

  const noConnectedAccounts = baseInput()
  noConnectedAccounts.draft!.fields.account = ''
  noConnectedAccounts.setup = { ...SETUP, accounts: [], defaultAccount: undefined }

  const loadingAccounts = baseInput()
  loadingAccounts.draft!.fields.account = ''
  loadingAccounts.setup = null

  const failedAccounts = baseInput()
  failedAccounts.draft!.fields.account = ''
  failedAccounts.setup = null
  failedAccounts.setupError = 'Service unavailable'

  const noTitle = baseInput()
  noTitle.draft!.fields.title = '   '

  const unresolvedOne = baseInput()
  unresolvedOne.unresolved = 1

  const unresolvedTwo = baseInput()
  unresolvedTwo.unresolved = 2

  const noTime = baseInput()
  noTime.draft!.fields.time = ''
  noTime.available = null

  const failedPreview = baseInput()
  failedPreview.available = null
  failedPreview.checkError = 'Timeout'

  const checkingPreview = baseInput()
  checkingPreview.checking = true

  const signInNeeded = baseInput()
  signInNeeded.connection = {
    enabled: true,
    ready: false,
    state: { account: 'work@example.com', state: 'sign_in_required' },
  }

  const signInChecking = baseInput()
  signInChecking.connection = {
    enabled: true,
    ready: false,
    state: { account: 'work@example.com', state: 'checking' },
  }

  const signInWaiting = baseInput()
  signInWaiting.connection = {
    enabled: true,
    ready: false,
    state: { account: 'work@example.com', state: 'waiting' },
  }

  const parseFailed = baseInput()
  parseFailed.stale = true
  parseFailed.parseError = 'Temporarily unavailable.'

  const unsupported = baseInput()
  unsupported.draft!.unsupported = ['Every Monday and Wednesday is not supported.']

  assert({
    given: 'each individual reason Create is disabled',
    should: 'report a clear message and jump/retry target',
    actual: [
      createBlocker(noAccount),
      createBlocker(noConnectedAccounts),
      createBlocker(loadingAccounts),
      createBlocker(failedAccounts),
      createBlocker(noTitle),
      createBlocker(unresolvedOne),
      createBlocker(unresolvedTwo),
      createBlocker(noTime),
      createBlocker(failedPreview),
      createBlocker(checkingPreview),
      createBlocker(signInNeeded),
      createBlocker(signInChecking),
      createBlocker(signInWaiting),
      createBlocker(parseFailed),
      createBlocker(unsupported),
    ],
    expected: [
      { message: 'Choose a From account to schedule', target: 'account' },
      { message: 'Connect a Google account in Settings → Connections', target: 'connections' },
      { message: 'Loading Google accounts…', pending: true },
      { message: 'Could not load Google accounts', target: 'prompt' },
      { message: 'Add a meeting title', target: 'title' },
      { message: 'Choose an email for 1 invitee', target: 'invitee' },
      { message: 'Choose emails for 2 invitees', target: 'invitee' },
      { message: 'Choose a time', target: 'time' },
      { message: 'Couldn’t check calendars — retry check', target: 'retry-check' },
      { message: 'Checking your calendars…', pending: true },
      { message: 'Sign in to Google as work@example.com to schedule', target: 'browser' },
      { message: 'Checking Google sign-in for work@example.com…', pending: true },
      { message: 'Finish signing in as work@example.com', target: 'browser' },
      { message: 'Couldn’t update details — retry to continue', target: 'retry-parse' },
      { message: 'Adjust the unsupported requirement above', target: 'unsupported' },
    ],
  })
})
