import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { assert, test } from '#test'
import { availabilityOf } from './availability.ts'
import { CalendarScheduler } from './CalendarScheduler.ts'
import type { CalendarFields, CalendarSchedulerHost } from './types.ts'

const FIELDS: CalendarFields = {
  title: 'Atlas kickoff',
  date: '2030-05-03',
  time: '15:00',
  timezone: 'America/New_York',
  duration: 30,
  account: 'organizer@example.com',
  guests: [{ name: 'Jane Doe', email: 'jane@example.com' }],
  description: 'Discuss the launch.',
}
const NOW = '2030-05-01T12:00:00Z'

async function fixture(run: (host: CalendarSchedulerHost, sent: CalendarFields[]) => Promise<void>) {
  const dir = await mkdtemp('/tmp/sky-calendar-scheduler-')
  const sent: CalendarFields[] = []
  try {
    await run(
      {
        dir,
        setup: async () => ({ accounts: [FIELDS.account], date: '2030-05-01', timezone: FIELDS.timezone }),
        people: async () => [],
        parse: async () => ({
          fields: structuredClone(FIELDS),
          invitees: [{ query: 'Jane Doe', candidates: [], selected: { ...FIELDS.guests[0]! } }],
          assumptions: ['Assuming 30 minutes.'],
          questions: [],
          unsupported: [],
        }),
        availability: async (timing) => availabilityOf(timing, [{ label: 'Work', events: [] }], [], NOW),
        create: async (fields, hooks) => {
          await hooks.beforeSave()
          await hooks.saving()
          sent.push(structuredClone(fields))
          return {
            title: fields.title,
            calendarUrl: 'https://example.com/calendar',
            zoomUrl: 'https://example.com/zoom',
          }
        },
      },
      sent,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const schedulerFor = (host: CalendarSchedulerHost) => new CalendarScheduler(host, { now: () => NOW })

async function finished(scheduler: CalendarScheduler, id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const job = await scheduler.get(id)
    if (job && job.state !== 'creating') return job
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('Calendar test job did not finish.')
}

test('a prepared calendar invitation survives restart and sends the reviewed fields exactly once', async () =>
  fixture(async (host, sent) => {
    const scheduler = schedulerFor(host)
    const prepared = await scheduler.prepare({ request: 'Meet Jane tomorrow at 3pm' })
    assert({
      given: 'a complete natural-language request',
      should: 'prepare a persistent draft without creating an event',
      actual: [prepared.status, !!prepared.draftId, prepared.fields, sent.length],
      expected: ['ready', true, FIELDS, 0],
    })
    prepared.fields.time = '17:00'
    host.parse = async () => {
      throw new Error('Sending must not reinterpret the request.')
    }
    let holds = 0
    let releases = 0
    const restarted = new CalendarScheduler(host, {
      now: () => NOW,
      hold: () => {
        holds++
        return () => {
          releases++
        }
      },
    })
    const id = prepared.draftId!
    await Promise.all([restarted.send(id), restarted.send(id)])
    const result = await finished(restarted, id)
    const later = new CalendarScheduler(host, { now: () => '2031-05-01T12:00:00Z' })
    const retried = await later.send(id)
    assert({
      given: 'concurrent sends, a modified returned object, and a retry after the event has passed',
      should: 'send the saved invitation once and retain its receipt without parsing again',
      actual: [sent, result.state, retried.state, holds, releases],
      expected: [[FIELDS], 'created', 'created', 1, 1],
    })
  }))

test('calendar preparation returns unresolved contacts and accounts without a sendable draft', async () =>
  fixture(async (host, sent) => {
    const parse = host.parse
    host.setup = async () => ({
      accounts: ['work@example.com', 'personal@example.com'],
      date: '2030-05-01',
      timezone: FIELDS.timezone,
    })
    host.parse = async (...args) => ({
      ...(await parse(...args)),
      invitees: [
        {
          query: 'Jane',
          selected: null,
          candidates: [
            { id: 'jane', name: 'Jane Doe', hint: 'Atlas', emails: ['jane@example.com', 'jane.work@example.com'] },
          ],
        },
      ],
    })
    const prepared = await schedulerFor(host).prepare({ request: 'Meet Jane at 3pm' })
    assert({
      given: 'multiple organizer accounts and a guest with two email addresses',
      should: 'return the choices without guessing or saving a draft',
      actual: [
        prepared.status,
        prepared.draftId,
        prepared.fields.guests,
        prepared.questions.length,
        prepared.accounts,
        await readdir(host.dir),
        sent,
      ],
      expected: ['needs_input', undefined, [], 2, ['work@example.com', 'personal@example.com'], [], []],
    })
  }))

test('calendar preparation respects account overrides and the default timezone supplied to interpretation', async () =>
  fixture(async (host) => {
    const parse = host.parse
    let timezone = ''
    host.setup = async () => ({
      accounts: ['work@example.com', 'personal@example.com'],
      date: '2030-05-01',
      timezone: FIELDS.timezone,
    })
    host.parse = async (...args) => {
      timezone = args[1]
      return parse(...args)
    }
    const prepared = await schedulerFor(host).prepare({
      request: 'Meet Jane at 3pm New York time',
      account: 'WORK',
      timezone: 'Europe/Paris',
    })
    assert({
      given: 'an account fragment, default zone and explicit zone in the interpreted request',
      should: 'select the unique account and retain the explicit time zone from the request',
      actual: [prepared.status, prepared.fields.account, timezone, prepared.fields.timezone],
      expected: ['ready', 'work@example.com', 'Europe/Paris', 'America/New_York'],
    })
  }))

test('missing times, past times, unsupported recurrence and organizer-only guests cannot produce a sendable draft', async () =>
  fixture(async (host, sent) => {
    const parse = host.parse
    const statuses: string[] = []
    const ids: (string | undefined)[] = []
    for (const change of ['missing-time', 'past-time', 'recurrence', 'organizer-only']) {
      host.parse = async (...args) => {
        const draft = await parse(...args)
        if (change === 'missing-time') draft.fields.time = ''
        if (change === 'past-time') draft.fields.date = '2030-04-01'
        if (change === 'recurrence') draft.unsupported = ['Repeating meetings are unsupported.']
        if (change === 'organizer-only') draft.invitees[0]!.selected = { name: 'Organizer', email: FIELDS.account }
        return draft
      }
      const prepared = await schedulerFor(host).prepare({ request: 'A meeting request' })
      statuses.push(prepared.status)
      ids.push(prepared.draftId)
    }
    assert({
      given: 'requests that cannot yet become invitations',
      should: 'return questions or unsupported requirements without granting send IDs',
      actual: [statuses, ids.every((id) => id === undefined), sent.length],
      expected: [['needs_input', 'needs_input', 'unsupported', 'needs_input'], true, 0],
    })
  }))

test('sending a calendar draft rechecks conflicts, and a new preparation can review the changed calendar', async () =>
  fixture(async (host, sent) => {
    const scheduler = schedulerFor(host)
    const first = await scheduler.prepare({ request: 'Meet Jane tomorrow at 3pm' })
    host.availability = async (timing) => availabilityOf(timing, [], ['Could not check Work.'], NOW)
    await scheduler.send(first.draftId!)
    const rejected = await finished(scheduler, first.draftId!)
    const second = await scheduler.prepare({ request: 'Meet Jane tomorrow at 3pm' })
    assert({
      given: 'a calendar check that became incomplete after review',
      should: 'stop the old draft and include the new warning in a fresh review',
      actual: [
        rejected.state,
        sent.length,
        second.status,
        second.availability?.warnings,
        first.draftId !== second.draftId,
      ],
      expected: ['failed', 0, 'ready', ['Could not check Work.'], true],
    })
    await scheduler.send(second.draftId!)
    assert({
      given: 'the same warning accepted by sending the freshly prepared draft',
      should: 'allow the reviewed invitation to proceed',
      actual: [(await finished(scheduler, second.draftId!)).state, sent.length],
      expected: ['created', 1],
    })
  }))

test('a calendar draft with an uncertain save is never sent again', async () =>
  fixture(async (host, sent) => {
    host.create = async (fields, hooks) => {
      await hooks.saving()
      sent.push(fields)
      throw new Error('Lost the Calendar response after Save.')
    }
    const scheduler = schedulerFor(host)
    const prepared = await scheduler.prepare({ request: 'Meet Jane tomorrow at 3pm' })
    await scheduler.send(prepared.draftId!)
    const job = await finished(scheduler, prepared.draftId!)
    const retried = await schedulerFor(host).send(prepared.draftId!)
    assert({
      given: 'a failed readback after the invitation may have been saved',
      should: 'keep the uncertain receipt through retry and restart',
      actual: [job.state, retried.state, sent.length],
      expected: ['uncertain', 'uncertain', 1],
    })
  }))
