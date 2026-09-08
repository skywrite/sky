import type { Page } from 'playwright'
import { UPDATE_EVENT } from '#lib/calendarScheduler/test/updateFixture.ts'
import type { CalendarEventFields, CalendarEventSnapshot } from '#lib/calendarScheduler/updateTypes.ts'
import { meetingInterval } from '#lib/calendarScheduler/validation.ts'
import { assert, test } from '#test'
import { finishCalendarEventUpdate, savedCalendarUpdateMatches } from './updateCalendarEvent.ts'

const FIELDS = { ...UPDATE_EVENT.fields, time: '16:00' }
const interval = meetingInterval(FIELDS)
const SAVED: CalendarEventSnapshot = {
  ...UPDATE_EVENT,
  version: '"new-version"',
  fields: FIELDS,
  start: interval.start,
  end: interval.end,
}

test('calendar update readback must keep identity, conference, rooms and exact reviewed fields', () => {
  const mismatch = [
    { ref: { ...SAVED.ref, eventId: 'replacement-event' } },
    { version: UPDATE_EVENT.version },
    { conferenceUrl: 'https://zoom.us/j/10987654321' },
    { start: '2030-05-03T16:00:00-05:00' },
    { fields: { ...FIELDS, title: 'Unrequested title' } },
    { fields: { ...FIELDS, guests: [] } },
    { fields: { ...FIELDS, description: '' } },
    { resourceEmails: ['room@example.com'] },
    { recurring: true },
  ]
  assert({
    given: 'a matching save or an unrequested change',
    should: 'accept only the same event with the reviewed content',
    actual: [
      savedCalendarUpdateMatches(SAVED, UPDATE_EVENT, FIELDS),
      ...mismatch.map((change) => savedCalendarUpdateMatches({ ...SAVED, ...change }, UPDATE_EVENT, FIELDS)),
    ],
    expected: [true, ...mismatch.map(() => false)],
  })
})

test('a recurring update selects only this occurrence and completes delayed guest notifications', async () => {
  let tick = 0
  const actions: string[] = []
  const event = { ...UPDATE_EVENT, recurring: true }
  const page = {
    getByRole: (_role: string, { name }: { name: string }) => ({
      isVisible: async () =>
        name === 'This event'
          ? tick >= 1 && !actions.includes('OK')
          : name === 'Send'
            ? tick >= 2 && actions.includes('OK') && !actions.includes('Send')
            : name === 'Invite all guests'
              ? tick >= 3 && actions.includes('Send') && !actions.includes('Invite all guests')
              : false,
      check: async () => {
        actions.push(name)
      },
      click: async () => {
        actions.push(name)
      },
    }),
    waitForTimeout: async () => {
      tick++
    },
  } as unknown as Page
  const result = await finishCalendarEventUpdate(page, event, FIELDS, async () =>
    actions.includes('Invite all guests') ? { ...SAVED, recurring: true } : event,
  )
  assert({
    given: 'a recurring occurrence followed by invitation dialogs',
    should: 'choose this occurrence, notify once and read back the exact saved ID',
    actual: [actions, result.event, result.zoomUrl],
    expected: [['This event', 'OK', 'Send', 'Invite all guests'], event.ref, event.conferenceUrl],
  })
})

test('a solo event update does not require an invitation dialog', async () => {
  const event = { ...UPDATE_EVENT, fields: { ...UPDATE_EVENT.fields, guests: [] }, conferenceUrl: undefined }
  const fields: CalendarEventFields = { ...event.fields, title: 'Solo focus' }
  const page = {
    getByRole: () => ({ isVisible: async () => false }),
    waitForTimeout: async () => {},
  } as unknown as Page
  const result = await finishCalendarEventUpdate(page, event, fields, async () => ({
    ...event,
    version: '"new"',
    fields,
  }))
  assert({
    given: 'an event with no guests or conference',
    should: 'verify the update without waiting for Send or generating a conference',
    actual: [result.title, result.zoomUrl, result.conferenceUrl, result.event],
    expected: ['Solo focus', '', undefined, event.ref],
  })
})

test('an editor disappearing without notification confirmation cannot report a successful update', async () => {
  const page = {
    getByRole: () => ({ isVisible: async () => false }),
    waitForTimeout: async () => {},
  } as unknown as Page
  const message = await finishCalendarEventUpdate(page, UPDATE_EVENT, FIELDS, async () => SAVED).then(
    () => '',
    (error: Error) => error.message,
  )
  assert({
    given: 'a closed editor without guest notification confirmation',
    should: 'leave the outcome unconfirmed instead of assuming success',
    actual: message,
    expected: 'Calendar did not confirm the exact event update and guest notifications.',
  })
})
