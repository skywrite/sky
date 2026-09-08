import { readFile, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { assert, test } from '#test'
import { calendarLocal } from '#universal/dates/nbdt/mod.ts'
import { availabilityOf } from './availability.ts'
import { CalendarScheduler } from './CalendarScheduler.ts'
import { calendarEventSnapshot } from './googleUpdates.ts'
import {
  UPDATE_EVENT,
  UPDATE_NOW,
  eventForAvailability,
  finishedUpdate,
  withUpdateFixture,
} from './test/updateFixture.ts'

test('rescheduling persists an exact update and concurrent sends never create a replacement event', async () =>
  withUpdateFixture(async ({ host, state, saved, scheduler }) => {
    const prepared = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm', event: UPDATE_EVENT.ref })
    assert({
      given: 'a time-only update',
      should: 'retain all other event fields without saving',
      actual: [prepared.status, prepared.fields, saved.length, state.searches],
      expected: ['ready', { ...UPDATE_EVENT.fields, time: '16:00' }, 0, 0],
    })
    prepared.fields!.title = 'Not part of the saved draft'
    const restarted = new CalendarScheduler(host, { now: () => UPDATE_NOW })
    await Promise.all([restarted.update(prepared.draftId!), restarted.update(prepared.draftId!)])
    const result = await finishedUpdate(restarted, prepared.draftId!)
    const later = new CalendarScheduler(host, { now: () => '2031-05-01T00:00:00Z' })
    const retry = await later.update(prepared.draftId!)
    assert({
      given: 'concurrent saves, restart and a retry after the event time',
      should: 'apply the persisted change once to the exact event and return its receipt',
      actual: [result.state, retry.state, saved, state.parses],
      expected: ['updated', 'updated', [{ event: UPDATE_EVENT, fields: { ...UPDATE_EVENT.fields, time: '16:00' } }], 1],
    })
  }))

test('ambiguous or incomplete event searches return candidates without choosing an event', async () =>
  withUpdateFixture(async ({ state, saved, scheduler }) => {
    state.candidates.push({ ...structuredClone(UPDATE_EVENT), ref: { ...UPDATE_EVENT.ref, eventId: 'other-event' } })
    const ambiguous = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm' })
    state.candidates.pop()
    state.warnings.push('Could not search Personal.')
    const incomplete = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm' })
    state.candidates = []
    const missing = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm' })
    assert({
      given: 'multiple matches, an incomplete search, and no matches',
      should: 'require explicit selection or clarification before interpreting changes',
      actual: [
        ambiguous.candidates.length,
        ambiguous.draftId,
        incomplete.status,
        incomplete.event,
        missing.requestQuestions.length,
        saved.length,
        state.parses,
      ],
      expected: [2, undefined, 'needs_input', undefined, 1, 0, 0],
    })
  }))

test('event changes and newly incomplete calendars stop a reviewed update before save', async () => {
  for (const change of ['version', 'availability'])
    await withUpdateFixture(async ({ host, state, saved, scheduler }) => {
      const prepared = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm', event: UPDATE_EVENT.ref })
      if (change === 'version') state.event.version = '"changed-by-another-editor"'
      else host.availability = async (timing) => availabilityOf(timing, [], ['Could not check Work.'], UPDATE_NOW)
      await scheduler.update(prepared.draftId!)
      assert({
        given: `a changed ${change} after review`,
        should: 'stop before the external save',
        actual: [(await finishedUpdate(scheduler, prepared.draftId!)).state, saved.length],
        expected: ['failed', 0],
      })
    })
})

test('lost update responses and interrupted saves never replay the write', async () =>
  withUpdateFixture(async ({ host, saved, scheduler }) => {
    host.updates!.save = async (event, fields, hooks) => {
      await hooks.saving()
      saved.push({ event, fields })
      throw new Error('Lost the response after Save.')
    }
    const prepared = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm', event: UPDATE_EVENT.ref })
    await scheduler.update(prepared.draftId!)
    const result = await finishedUpdate(scheduler, prepared.draftId!)
    const file = path.join(host.dir, `${prepared.draftId}.json`)
    const persisted = JSON.parse(await readFile(file, 'utf8'))
    await writeFile(file, JSON.stringify({ ...persisted, state: 'updating', owner: 'previous-process' }))
    const retry = await new CalendarScheduler(host).update(prepared.draftId!)
    assert({
      given: 'a response lost after saving and a restarted process',
      should: 'report uncertainty without a second write',
      actual: [result.state, retry.state, retry.operation, saved.length],
      expected: ['uncertain', 'uncertain', 'update', 1],
    })
  }))

test('reviewing explicit guest and metadata changes retains the version and rejects stale reviews', async () =>
  withUpdateFixture(async ({ state, saved, scheduler }) => {
    state.parsed = {
      ...state.parsed,
      changes: { title: 'Atlas planning', description: '', location: 'Room 3' },
      addGuests: [
        {
          query: 'Jordan',
          selected: null,
          candidates: [
            { id: 'jordan', name: 'Jordan Davis', hint: '', emails: ['jordan@example.com', 'jordan.work@example.com'] },
          ],
        },
      ],
    }
    const prepared = await scheduler.prepareUpdate({
      request: 'Rename Atlas and invite Jordan',
      event: UPDATE_EVENT.ref,
    })
    const fields = {
      ...prepared.fields!,
      guests: [...prepared.fields!.guests, { name: 'Jordan Davis', email: 'jordan.work@example.com' }],
    }
    const reviewed = await scheduler.reviewUpdate({ event: UPDATE_EVENT.ref, version: UPDATE_EVENT.version, fields })
    state.event.version = '"changed"'
    const stale = await scheduler.reviewUpdate({ event: UPDATE_EVENT.ref, version: UPDATE_EVENT.version, fields }).then(
      () => false,
      () => true,
    )
    assert({
      given: 'an unresolved contact then an exact email selection',
      should: 'review those exact fields without another parse and refuse stale versions',
      actual: [prepared.status, prepared.draftId, reviewed.status, reviewed.fields, state.parses, stale, saved.length],
      expected: ['needs_input', undefined, 'ready', fields, 1, true, 0],
    })
  }))

test('solo events allow metadata edits while invalid times, empty changes and unsupported events cannot be saved', async () =>
  withUpdateFixture(async ({ state, scheduler }) => {
    state.event.fields.guests = []
    state.parsed.changes = { title: 'Solo focus' }
    const solo = await scheduler.prepareUpdate({ request: 'Rename this event', event: UPDATE_EVENT.ref })
    const statuses: string[] = []
    for (const changes of [{ date: '2030-04-01' }, { date: '2030-03-10', time: '02:30' }, {}]) {
      state.parsed.changes = changes
      statuses.push((await scheduler.prepareUpdate({ request: 'Change the event', event: UPDATE_EVENT.ref })).status)
    }
    state.event.unsupported = ['Only the organizer can change this event.']
    const denied = await scheduler.prepareUpdate({ request: 'Move this event', event: UPDATE_EVENT.ref })
    assert({
      given: 'a solo event, invalid reschedules, no change, or no edit access',
      should: 'allow valid edits without requiring an invitation guest',
      actual: [solo.status, solo.fields?.guests, statuses, denied.status, denied.draftId],
      expected: ['ready', [], ['needs_input', 'needs_input', 'needs_input'], 'unsupported', undefined],
    })
  }))

test('rescheduling excludes the selected occurrence and its shared copies, retaining other series occurrences', () => {
  const event = eventForAvailability(UPDATE_EVENT)
  const copy = {
    ...event,
    id: 'shared-copy',
    account: 'personal@example.com',
    calendarId: 'personal@example.com',
    start: '2030-05-03T19:00:00Z',
  }
  const next = { ...event, id: 'next-occurrence', start: '2030-05-03T15:20:00-04:00', end: '2030-05-03T15:50:00-04:00' }
  const result = availabilityOf(
    { ...UPDATE_EVENT.fields, time: '15:15' },
    [{ label: 'Work', events: [event, copy, next] }],
    [],
    UPDATE_NOW,
    UPDATE_EVENT,
  )
  assert({
    given: 'a selected event, its shared copy and another occurrence with the same UID',
    should: 'omit only the original occurrence from conflicts',
    actual: result.events.map((row) => [row.title, row.start, row.conflict]),
    expected: [[event.title, next.start, true]],
  })
})

test('provider event snapshots preserve instant and zone across DST and reject a series master', () => {
  const base = eventForAvailability(UPDATE_EVENT)
  const event = calendarEventSnapshot(
    {
      ...base,
      etag: 'version',
      description: 'Agenda',
      organizer: { self: true },
      timezone: 'America/New_York',
      start: '2030-03-10T06:30:00Z',
      end: '2030-03-10T07:30:00Z',
      recurringEventId: 'series',
    },
    { id: UPDATE_EVENT.ref.calendarId, summary: 'Work', timeZone: 'UTC' },
  )
  const master = calendarEventSnapshot(
    { ...base, etag: 'version', organizer: { self: true }, recurrence: ['RRULE:FREQ=WEEKLY'] },
    { id: UPDATE_EVENT.ref.calendarId, summary: 'Work', timeZone: 'America/New_York' },
  )
  assert({
    given: 'a one-hour occurrence crossing spring DST and a series master',
    should: 'keep elapsed duration, use the event zone and require a single occurrence',
    actual: [
      event.fields.time,
      event.fields.duration,
      event.recurring,
      calendarLocal(event.end, event.fields.timezone).time,
      master.unsupported.length,
    ],
    expected: ['01:30', 60, true, '03:30', 1],
  })
})
