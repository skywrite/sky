import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import type { CalendarEvent } from '#lib/google/calendar.ts'
import { createSecret } from '#lib/secrets/marshal.ts'
import { TestSecretsProvider } from '#lib/secrets/TestSecretsProvider.ts'
import { createTypeSafeClient } from '#shared/ai/typesafe/client.ts'
import type { AIUsageRecord } from '#shared/ai/usageLog.ts'
import { assert, test } from '#test'
import type { CalendarOwnerContext } from './context.ts'
import { calendarEventKey, classifyCalendarEvents, setCalendarEventType } from './mod.ts'

const event = (id: string, title = id): CalendarEvent => ({
  id,
  title,
  account: 'owner@example.com',
  calendarId: 'primary',
  start: '2026-01-27T09:00:00-06:00',
  end: '2026-01-27T10:00:00-06:00',
  allDay: false,
  attendees: [{ email: 'jane@example.com', name: 'Jane Doe', self: false, response: 'accepted' }],
  status: 'confirmed',
  eventType: 'default',
})

function answer(type: 'meeting' | 'notification', probability = 0.98, confidence = probability) {
  return Response.json({
    model: 'jev-test',
    answers: {
      event_type: {
        type: 'choice',
        choice: type,
        confidence,
        probabilities: { meeting: 1 - probability, notification: 1 - probability, [type]: probability },
      },
    },
    usage: { input_tokens: 100, output_tokens: 0 },
  })
}
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), 'sky-calendar-classification-'))
  const calls: Array<{
    state: {
      title: string
      description: string
      owner: CalendarOwnerContext
      selfResponse: string | null
      correctedExamples: Array<{ type: string; event: { title: string; selfResponse: string | null } }>
    }
    questions: unknown
  }> = []
  const usage: AIUsageRecord[] = []
  const control = {
    response: (_signal?: AbortSignal | null): Response | Promise<Response> => answer('notification'),
    preparations: 0,
  }
  const secrets = new TestSecretsProvider({ 'typesafe/main': createSecret('tsk-test-key') })
  const client = createTypeSafeClient({
    secrets,
    fetch: (async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)))
      return control.response(init?.signal)
    }) as typeof fetch,
  })
  const classify = (events: CalendarEvent[], enabled = true, owner?: CalendarOwnerContext) =>
    classifyCalendarEvents(events, {
      dir,
      enabled,
      client,
      owner,
      prepare: async () => {
        control.preparations += 1
      },
      sink: (record) => void usage.push(record),
    })
  return { dir, calls, usage, control, secrets, classify, clean: () => rm(dir, { recursive: true, force: true }) }
}

test('calendar classification caches Jev judgments, invalidates edits, and keeps uncertain meetings visible', async () => {
  const f = await fixture()
  try {
    const notice = event('school-notice', 'School closure')
    const first = await f.classify([notice])
    const again = await f.classify([notice])
    f.control.response = () => answer('meeting')
    const changed = await f.classify([
      { ...notice, title: 'Family planning call', description: 'Discuss the school plan together.' },
    ])
    f.control.response = () => answer('notification', 0.6)
    const uncertain = await f.classify([event('ambiguous', 'Catch up')])
    assert({
      given: 'a confident notice, unchanged polling, a changed event and a weak classification',
      should:
        'reuse the saved judgment, reassess changed content, log only new calls and retain uncertainty in Meetings',
      actual: [
        first.notifications[0].classification?.type,
        again.notifications[0].classification,
        changed.meetings[0].classification?.type,
        uncertain.meetings[0].classification?.type,
        f.calls.length,
        f.control.preparations,
        f.usage.map((record) => record.provider),
        f.calls[1].state.description,
      ],
      expected: [
        'notification',
        first.notifications[0].classification,
        'meeting',
        'uncertain',
        3,
        3,
        ['typesafe', 'typesafe', 'typesafe'],
        'Discuss the school plan together.',
      ],
    })
  } finally {
    await f.clean()
  }
})

test('owner relationships and RSVP reach the classifier and invalidate judgments when changed', async () => {
  const f = await fixture()
  try {
    const owner = { name: 'Jane Doe', family: 'Children: Alex and Sam. Partner: Jordan.' }
    const lesson = { ...event('lesson', 'Alex voice'), selfResponse: 'needsAction' as const }
    await f.classify([lesson], true, owner)
    await f.classify([{ ...lesson, selfResponse: 'accepted' }], true, owner)
    const changed = { ...owner, family: 'Alex is a colleague. Sam is my child.' }
    await f.classify([{ ...lesson, selfResponse: 'accepted' }], true, changed)
    await f.classify(
      [
        {
          ...lesson,
          selfResponse: undefined,
          attendees: [...lesson.attendees, { email: lesson.account, self: true, response: 'tentative' }],
        },
      ],
      true,
      owner,
    )
    assert({
      given: 'household context, a changed owner RSVP, a corrected relationship, and an RSVP in the guest list',
      should: 'supply each as evidence and reassess the event instead of reusing an obsolete judgment',
      actual: f.calls.map(({ state }) => [state.owner, state.selfResponse]),
      expected: [
        [owner, 'needsAction'],
        [owner, 'accepted'],
        [changed, 'accepted'],
        [owner, 'tentative'],
      ],
    })
  } finally {
    await f.clean()
  }
})

test('saved corrections teach similar events, survive edits, and disappear from evidence when reset', async () => {
  const f = await fixture()
  try {
    const lesson = { ...event('lesson', 'Alex voice'), selfResponse: 'accepted' as const, recurringEventId: 'lessons' }
    const key = calendarEventKey(lesson)
    const next = { ...lesson, id: 'next-lesson', title: 'Singing lesson' }
    f.control.response = () => answer('meeting')
    await f.classify([next])
    await setCalendarEventType(f.dir, key, 'notification', lesson)
    const saved = JSON.parse(await readFile(path.join(f.dir, 'overrides', `${key}.json`), 'utf8'))
    const changed = await f.classify([{ ...lesson, title: 'Updated lesson' }])
    const learned = await f.classify([next])
    await f.classify([
      event('unrelated', 'Atlas review'),
      { ...next, account: 'another@example.com' },
      { ...next, calendarId: 'other' },
    ])
    const examples = f.calls.map(({ state }) =>
      state.correctedExamples.map((example) => [example.type, example.event.title, example.event.selfResponse]),
    )
    await setCalendarEventType(f.dir, key, null)
    await f.classify([next])
    const reset = JSON.parse(await readFile(path.join(f.dir, 'overrides', `${key}.json`), 'utf8'))
    assert({
      given:
        'a dismissed lesson, its renamed next occurrence, unrelated events, and restoring automatic classification',
      should:
        'persist the correction and use it as scoped evidence without forcing other labels, then remove it completely',
      actual: [
        saved.type,
        changed.notifications[0].classification?.source,
        learned.meetings[0].classification?.type,
        examples,
        f.calls.length,
        reset,
      ],
      expected: [
        'notification',
        'manual',
        'meeting',
        [[], [['notification', 'Alex voice', 'accepted']], [], [], []],
        5,
        { type: null },
      ],
    })
  } finally {
    await f.clean()
  }
})

test(
  { name: 'calendar classification allows normal provider latency and uses the selected probability', timeout: 10000 },
  async () => {
    const f = await fixture()
    try {
      f.control.response = async (signal) => {
        await new Promise((resolve) => setTimeout(resolve, 3100))
        signal?.throwIfAborted()
        return answer('notification', 0.86, 0.65)
      }
      const result = await f.classify([
        event('notice-a', 'Library closure'),
        event('notice-b', 'Youth tennis practice'),
      ])
      assert({
        given: 'Jev answers after three seconds with a clear choice and a lower distribution confidence',
        should: 'sort both notifications, prepare credentials once, and avoid a false connection warning',
        actual: [result.notifications.length, result.meetings.length, result.warning, f.control.preparations],
        expected: [2, 0, undefined, 1],
      })
    } finally {
      await f.clean()
    }
  },
)

test('manual calendar corrections survive content changes and disabled automation, and can return to automatic', async () => {
  const f = await fixture()
  try {
    const notice = event('family-event')
    const key = calendarEventKey(notice)
    await f.classify([notice])
    await setCalendarEventType(f.dir, key, 'meeting')
    const corrected = await f.classify([{ ...notice, title: 'Updated title' }])
    await setCalendarEventType(f.dir, key, 'notification')
    const off = await f.classify([notice, event('other-account')], false)
    await setCalendarEventType(f.dir, key, null)
    const reset = await f.classify([notice])
    assert({
      given: 'the owner overrides an event, changes it, turns automation off and restores automatic classification',
      should: 'honor the correction independently of the cache and avoid model calls when disabled',
      actual: [
        corrected.meetings[0].classification?.source,
        off.notifications.length,
        off.meetings.length,
        reset.notifications[0].classification?.source,
        f.calls.length,
        key !== calendarEventKey({ ...notice, account: 'another@example.com' }),
        key !== calendarEventKey({ ...notice, calendarId: 'family' }),
      ],
      expected: ['manual', 1, 1, 'automatic', 1, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('provider and stored-state failures keep calendar entries visible and never cache a failure', async () => {
  const f = await fixture()
  try {
    f.control.response = () => Response.json({ error: 'unavailable' }, { status: 503 })
    const events = Array.from({ length: 9 }, (_, index) => event(`notice-${index}`))
    const failed = await f.classify(events)
    const failedCalls = f.calls.length
    f.control.response = () => answer('notification')
    const recovered = await f.classify([events[0]])
    await setCalendarEventType(f.dir, calendarEventKey(events[0]), 'meeting')
    await writeFile(path.join(f.dir, 'overrides', `${calendarEventKey(events[0])}.json`), 'invalid')
    const corrupt = await f.classify([events[0]])
    assert({
      given: 'a failed provider followed by recovery, then an unreadable correction',
      should: 'retain every entry, bound the failed batch, retry on the next read and explain the fallback',
      actual: [
        failed.meetings.length,
        failed.notifications.length,
        Boolean(failed.warning),
        failedCalls <= 4,
        recovered.notifications.length,
        corrupt.meetings[0].classification?.type,
        Boolean(corrupt.warning),
      ],
      expected: [9, 0, true, true, 1, 'uncertain', true],
    })
  } finally {
    await f.clean()
  }
})

test('invalid answers and oversized evidence stay visible, but a partial guest list does not prevent sorting', async () => {
  const f = await fixture()
  try {
    const skipped = await f.classify([
      { ...event('partial', 'School closure'), attendeesOmitted: true },
      { ...event('large'), description: 'x'.repeat(25_000) },
    ])
    f.control.response = () =>
      Response.json({
        model: 'jev-test',
        answers: { event_type: { choice: 'notification' } },
        usage: { input_tokens: 1, output_tokens: 0 },
      })
    const malformed = await f.classify([event('malformed')])
    await f.secrets.delete('typesafe', 'main')
    // A new client observes the missing key rather than the earlier client's cached credential.
    const missing = await classifyCalendarEvents([event('no-key')], {
      dir: f.dir,
      enabled: true,
      client: createTypeSafeClient({ secrets: f.secrets }),
      sink: () => {},
    })
    assert({
      given: 'a partial guest list, oversized description, malformed model answer and missing TypeSafe key',
      should: 'classify the activity with partial guests and retain failures without clipping oversized evidence',
      actual: [
        skipped.meetings.length,
        skipped.notifications.length,
        malformed.meetings.length,
        missing.meetings.length,
        f.calls.length,
        Boolean(malformed.warning),
        Boolean(missing.warning),
      ],
      expected: [1, 1, 1, 1, 2, true, true],
    })
  } finally {
    await f.clean()
  }
})

test('a correction made while Jev is answering wins over the late automatic result', async () => {
  const f = await fixture()
  try {
    const notice = event('in-flight')
    let release!: (response: Response) => void
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    f.control.response = () =>
      new Promise<Response>((resolve) => {
        release = resolve
        started()
      })
    const pending = f.classify([notice])
    await ready
    await setCalendarEventType(f.dir, calendarEventKey(notice), 'meeting')
    release(answer('notification'))
    const result = await pending
    assert({
      given: 'a manual correction saved during the model request',
      should: 'keep the manual meeting classification',
      actual: result.meetings[0].classification,
      expected: { key: calendarEventKey(notice), type: 'meeting', source: 'manual' },
    })
  } finally {
    await f.clean()
  }
})
