import type { CalendarDraft, CalendarInvitee } from '#lib/calendarScheduler/types.ts'
import { assert, test } from '#test'
import { mergeMeetingDraft } from './meetingDraft.ts'

const sam: CalendarInvitee = {
  query: 'Sam',
  candidates: [{ id: 'sam', name: 'Sam Rivera', hint: '', emails: ['sam@example.com', 'sam.work@example.com'] }],
  selected: null,
}
const jane: CalendarInvitee = {
  query: 'Jane Doe',
  candidates: [],
  selected: { name: 'Jane Doe', email: 'jane@example.com' },
}
const initial: CalendarDraft = {
  fields: {
    title: 'Meeting with Sam',
    date: '2030-05-03',
    time: '15:00',
    timezone: 'America/New_York',
    duration: 30,
    account: '',
    guests: [],
    description: '',
  },
  invitees: [sam, jane],
  assumptions: ['Assuming 30 minutes.'],
  questions: [],
  unsupported: [],
}

test('live meeting drafts preserve reviewed emails, manual guests and removals while wording evolves', () => {
  const extra: CalendarInvitee = {
    query: 'extra@example.com',
    candidates: [],
    selected: { name: 'extra@example.com', email: 'extra@example.com' },
  }
  const chosen = { ...sam, personId: 'sam', selected: { name: 'Sam Rivera', email: 'sam.work@example.com' } }
  const current = {
    ...initial,
    fields: {
      ...initial.fields,
      account: 'organizer@example.com',
      duration: 45,
      title: 'Atlas planning',
      conference: 'none' as const,
    },
    invitees: [chosen, extra],
  }
  const next = {
    ...initial,
    fields: { ...initial.fields, time: '17:00' },
    invitees: [{ ...sam, query: 'Sam Rivera' }, jane],
  }
  const merged = mergeMeetingDraft(current, initial, next)
  assert({
    given: 'a longer name and a new time after choosing an email, adding a guest and removing another',
    should: 'update the time while preserving the reviewed details and guest list',
    actual: [merged.fields, merged.invitees.map((person) => person.selected)],
    expected: [{ ...current.fields, time: '17:00' }, [chosen.selected, extra.selected]],
  })
  const changedEmail = mergeMeetingDraft(current, initial, {
    ...next,
    invitees: [{ ...sam, query: 'sam@example.com', selected: { name: 'Sam Rivera', email: 'sam@example.com' } }],
  })
  assert({
    given: 'a new explicit address in the wording',
    should: 'use that address rather than carrying over the earlier name-based email choice',
    actual: changedEmail.invitees.map((person) => person.selected?.email),
    expected: ['sam@example.com', 'extra@example.com'],
  })
})

test('edits made while an AI response is pending take precedence over that response', () => {
  const current = {
    ...initial,
    fields: { ...initial.fields, time: '16:30', duration: 60 },
    invitees: [{ ...sam, personId: 'sam' }, jane],
  }
  const next = { ...initial, fields: { ...initial.fields, time: '17:00', duration: 90 } }
  const merged = mergeMeetingDraft(current, initial, next, new Set(['time', 'duration']))
  assert({
    given: 'new manual timing and an unfinished email choice during an in-flight request',
    should: 'keep the human edits and clear stale timing explanations',
    actual: [merged.fields.time, merged.fields.duration, merged.invitees[0]?.personId, merged.assumptions],
    expected: ['16:30', 60, 'sam', []],
  })
})
