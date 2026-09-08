import { mkdtemp, rm } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { availabilityOf } from '#lib/calendarScheduler/availability.ts'
import { CalendarJobs } from '#lib/calendarScheduler/jobs.ts'
import { reviewMeetingDate } from '#lib/calendarScheduler/parse.ts'
import { contactEmails, resolveInvitee } from '#lib/calendarScheduler/people.ts'
import type { CalendarFields, CalendarJob, CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import { assert, test } from '#test'
import { calendarInterval, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { createMeetingRoutes } from './mod.ts'

const FIELDS: CalendarFields = {
  title: 'Atlas review',
  date: '2030-05-03',
  time: '15:00',
  timezone: 'America/New_York',
  duration: 30,
  account: 'organizer@example.com',
  guests: [{ name: 'Jane Doe', email: 'jane@example.com' }],
  description: '',
}
const EMPTY = availabilityOf(FIELDS, [{ label: 'Work', events: [] }], [], '2030-05-01T00:00:00Z')
const RESULT = {
  title: FIELDS.title,
  calendarUrl: 'https://calendar.google.com/calendar/event?eid=example',
  zoomUrl: 'https://example.com/meeting',
}
const event = (id: string, start: string, end: string, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id,
  account: FIELDS.account,
  title: id,
  start,
  end,
  allDay: false,
  attendees: [],
  eventType: 'default',
  status: 'confirmed',
  ...extra,
})

test('meeting date review accepts weekends and checks only the weekday explicitly extracted by AI', () => {
  assert({
    given: 'a Sunday meeting, a matching written weekday, and a missing date',
    should: 'keep explicit dates without a weekend question and preserve real missing-detail questions',
    actual: [
      reviewMeetingDate('2030-05-05', null, []),
      reviewMeetingDate('2030-05-05', 'Sunday', []),
      reviewMeetingDate(null, null, ['Which day?']),
    ],
    expected: [
      { date: '2030-05-05', questions: [] },
      { date: '2030-05-05', questions: [] },
      { date: '', questions: ['Which day?'] },
    ],
  })
  assert({
    given: 'an AI-extracted date and written weekday that disagree',
    should: 'require a date choice even if the model failed to notice the calendar mismatch',
    actual: reviewMeetingDate('2030-05-04', 'Friday', []),
    expected: {
      date: '',
      questions: ['2030-05-04 is Saturday, but you requested Friday. Choose the date you want.'],
    },
  })
})

test('meeting availability includes busy solo and overnight events, ignores free and declined entries, and deduplicates calendars', () => {
  const events = [
    event('ends-at-start', '2030-05-03T14:00:00-04:00', '2030-05-03T15:00:00-04:00'),
    event('overlap', '2030-05-03T15:15:00-04:00', '2030-05-03T16:00:00-04:00', { iCalUid: 'shared' }),
    event('free', '2030-05-03T15:00:00-04:00', '2030-05-03T16:00:00-04:00', { transparency: 'transparent' }),
    event('declined', '2030-05-03T15:00:00-04:00', '2030-05-03T16:00:00-04:00', { selfResponse: 'declined' }),
    event('overnight', '2030-05-02T23:00:00-04:00', '2030-05-03T00:30:00-04:00'),
  ]
  const preview = availabilityOf(
    FIELDS,
    [
      { label: 'Work', events },
      { label: 'Personal', events: [events[1]!] },
    ],
    [],
    '2030-05-01T00:00:00Z',
  )
  assert({
    given: 'overlapping personal calendars',
    should: 'show four distinct events and only the real overlap as a conflict',
    actual: [
      preview.events.length,
      preview.events.filter((item) => item.conflict).map((item) => item.title),
      preview.alternatives,
    ],
    expected: [4, ['overlap'], ['16:00', '16:15', '13:30']],
  })
  const allDay = availabilityOf(
    FIELDS,
    [{ label: 'Work', events: [event('away', '2030-05-02', '2030-05-04', { allDay: true })] }],
    [],
    '2030-05-01T00:00:00Z',
  )
  assert({
    given: 'a busy all-day event spanning the selected day',
    should: 'flag the conflict and offer no free time on that day',
    actual: [allDay.events[0]?.conflict, allDay.alternatives],
    expected: [true, []],
  })
})

test('calendar scheduling rejects ambiguous and missing hours, and duration crosses DST as elapsed time', () => {
  const spring = calendarInterval(new PlainDateTime('2026-03-08 01:30'), 'America/New_York', 60)
  const invalid = ['2026-03-08 02:30', '2026-11-01 01:30'].map((time) => {
    try {
      calendarInterval(new PlainDateTime(time), 'America/New_York', 30)
      return false
    } catch {
      return true
    }
  })
  assert({
    given: 'spring and autumn clock changes',
    should: 'keep a real hour as a real hour and require a different time for a missing or repeated hour',
    actual: [spring.start, spring.end, spring.endMilliseconds - spring.startMilliseconds, invalid],
    expected: ['2026-03-08T01:30:00-05:00', '2026-03-08T03:30:00-04:00', 3600000, [true, true]],
  })
})

test('availability warnings are not a clear calendar and guest fields do not change the review key', () => {
  const timing = { date: FIELDS.date, time: FIELDS.time, timezone: FIELDS.timezone, duration: FIELDS.duration }
  const same = availabilityOf(timing, [{ label: 'Work', events: [] }], [], '2030-05-01T00:00:00Z')
  const failed = availabilityOf(timing, [], ['Could not check Work.'], '2030-05-01T00:00:00Z')
  assert({
    given: 'the same time with guest fields, or an unavailable calendar',
    should: 'retain the time review key but make an incomplete check a different review',
    actual: [same.reviewKey === EMPTY.reviewKey, failed.reviewKey !== EMPTY.reviewKey, failed.warnings.length],
    expected: [true, true, 1],
  })
})

test('invitees resolve only explicit contact email addresses and leave ambiguous choices visible', () => {
  const jane = { id: 'jane', name: 'Jane Doe', hint: 'Atlas', emails: ['jane@example.com'] }
  const other = { ...jane, id: 'other', name: 'Jane Smith', emails: ['jane.smith@example.com'] }
  assert({
    given: 'namesakes, multiple emails, and an explicit address',
    should: 'never invent an address or silently choose between candidates',
    actual: [
      contactEmails({ business: ['jane@example.com', 'JANE@example.com'], personal: 'Not an email' }),
      resolveInvitee('Jane', [jane, other]).selected,
      resolveInvitee('Jane Doe', [{ ...jane, emails: ['work@example.com', 'home@example.com'] }]).selected,
      resolveInvitee('Jane Doe', [jane, other]).selected,
      resolveInvitee('new@example.com', []).selected,
    ],
    expected: [
      ['jane@example.com'],
      null,
      null,
      { name: 'Jane Doe', email: 'jane@example.com' },
      { name: 'new@example.com', email: 'new@example.com' },
    ],
  })
})

async function fixture(run: (host: CalendarSchedulerHost) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'sky-meeting-jobs-'))
  try {
    await run({
      dir,
      setup: async () => ({ accounts: [FIELDS.account], date: '2030-05-01', timezone: FIELDS.timezone }),
      people: async () => [],
      parse: async () => ({ fields: FIELDS, invitees: [], assumptions: [], questions: [], unsupported: [] }),
      availability: async () => EMPTY,
      create: async (_fields, hooks) => {
        await hooks.beforeSave()
        await hooks.saving()
        return RESULT
      },
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function finished(jobs: CalendarJobs, id: string): Promise<CalendarJob> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await jobs.get(id)
    if (job && job.state !== 'creating') return job
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Test job did not finish')
}

test('a repeated meeting request sends once, survives a restart, and cannot acquire another draft', async () =>
  fixture(async (host) => {
    let sends = 0
    const create = host.create
    host.create = async (...args) => {
      sends++
      return create(...args)
    }
    const jobs = new CalendarJobs(host)
    const id = crypto.randomUUID()
    await Promise.all([jobs.start(id, FIELDS, EMPTY.reviewKey), jobs.start(id, FIELDS, EMPTY.reviewKey)])
    const final = await finished(jobs, id)
    const restarted = new CalendarJobs(host)
    await restarted.start(id, FIELDS, EMPTY.reviewKey)
    let refused = false
    try {
      await restarted.start(id, { ...FIELDS, title: 'Different meeting' }, EMPTY.reviewKey)
    } catch {
      refused = true
    }
    assert({
      given: 'concurrent requests, a restart and a reused id with different content',
      should: 'send once and retain the original result',
      actual: [sends, final.state, (await restarted.get(id))?.state, refused],
      expected: [1, 'created', 'created', true],
    })
  }))

test('calendar changes before Save stop creation; a failure after Save cannot resend', async () =>
  fixture(async (host) => {
    let sends = 0
    const jobs = new CalendarJobs(host)
    host.availability = async () => ({ ...EMPTY, reviewKey: 'changed' })
    host.create = async () => {
      sends++
      return RESULT
    }
    const changed = crypto.randomUUID()
    await jobs.start(changed, FIELDS, EMPTY.reviewKey)
    assert({
      given: 'a newly conflicting calendar',
      should: 'stop before touching the browser',
      actual: [(await finished(jobs, changed)).state, sends],
      expected: ['failed', 0],
    })
    host.availability = async () => EMPTY
    host.create = async (_fields, hooks) => {
      await hooks.saving()
      sends++
      throw new Error('connection dropped')
    }
    const uncertain = crypto.randomUUID()
    await jobs.start(uncertain, FIELDS, EMPTY.reviewKey)
    const final = await finished(jobs, uncertain)
    const restarted = new CalendarJobs(host)
    await restarted.start(uncertain, FIELDS, EMPTY.reviewKey)
    assert({
      given: 'an unconfirmed save followed by a retry after restart',
      should: 'preserve uncertainty and never send again',
      actual: [final.state, sends, (await restarted.get(uncertain))?.state],
      expected: ['uncertain', 1, 'uncertain'],
    })
  }))

test('meeting routes keep parse and preview read-only and refuse cross-site creation', async () =>
  fixture(async (host) => {
    let sends = 0
    host.create = async () => {
      sends++
      return RESULT
    }
    const app = createMeetingRoutes(host)
    const post = (route: string, body: unknown, origin?: string) =>
      app.request(`http://localhost${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      })
    const parse = await post('/parse', { query: 'Meet Jane on Friday', timezone: FIELDS.timezone })
    const preview = await post('/preview', FIELDS)
    const invalid = await post('/create', {
      id: crypto.randomUUID(),
      fields: { ...FIELDS, guests: [{ name: 'Jane', email: 'not-an-email' }] },
      reviewKey: EMPTY.reviewKey,
    })
    const crossSite = await post(
      '/create',
      { id: crypto.randomUUID(), fields: FIELDS, reviewKey: EMPTY.reviewKey },
      'https://example.com',
    )
    assert({
      given: 'interpretation, preview, invalid guests and a cross-site request',
      should: 'perform no external writes',
      actual: [parse.status, preview.status, invalid.status, crossSite.status, sends],
      expected: [200, 200, 400, 403, 0],
    })
  }))
