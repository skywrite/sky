import { spyOn } from 'bun:test'
import { Hono } from 'hono'
import * as manifest from '#commands/all/cli/_commandsManifest.ts'
import {
  createNotebookTools,
  createToolApprovalConfig,
  discoverAIChatTools,
  getApprovalFormatter,
  sessionKeyToolNames,
} from '#commands/lib/chat/notebookTools.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#config'
import type { CalendarScheduler } from '#lib/calendarScheduler/CalendarScheduler.ts'
import { CalendarDrafts } from '#lib/calendarScheduler/drafts.ts'
import { UPDATE_EVENT, withUpdateFixture } from '#lib/calendarScheduler/test/updateFixture.ts'
import type { CalendarFields } from '#lib/calendarScheduler/types.ts'
import { approvalCard } from '#service/handler/chat/approvalCard.ts'
import { createMeetingRoutes } from '#service/handler/meetings/mod.ts'
import { createVoiceCommandTools } from '#service/handler/voice/commandTools.ts'
import { createVoiceRoutes } from '#service/handler/voice/mod.ts'
import { assert, test } from '#test'

type Payload = Record<string, unknown>
type ExecutableTool = { execute: (input: Payload) => Promise<Payload> }

async function withTools(
  run: (fixture: {
    chat: Record<string, ExecutableTool>
    call: (name: string, input: Payload) => Promise<Payload>
    policy: (name: string, input: Payload) => Promise<unknown>
    card: (name: string, input: Payload) => Promise<string>
    created: CalendarFields[]
    fixture: Parameters<Parameters<typeof withUpdateFixture>[0]>[0]
  }) => Promise<void>,
) {
  await withUpdateFixture(async (fixture) => {
    const { host } = fixture
    const fields = structuredClone(UPDATE_EVENT.fields)
    const created: CalendarFields[] = []
    host.parse = async (request) => ({
      fields,
      invitees: [
        {
          query: 'Jane',
          candidates: [
            { id: 'jane', name: 'Jane Doe', hint: 'Atlas', emails: ['jane@example.com', 'jane.work@example.com'] },
          ],
          selected: request.includes('jane.work@example.com')
            ? { name: 'Jane Doe', email: 'jane.work@example.com' }
            : null,
        },
      ],
      assumptions: ['Use the requested New York timezone.'],
      questions: [],
      unsupported: [],
    })
    host.create = async (value, hooks) => {
      await hooks.beforeSave()
      await hooks.saving()
      created.push(structuredClone(value))
      return {
        title: value.title,
        calendarUrl: 'https://example.com/calendar/created',
        zoomUrl: 'https://example.com/conference',
        event: { ...UPDATE_EVENT.ref, eventId: 'created-event' },
      }
    }
    const cached = spyOn(manifest, 'getManifest').mockResolvedValue({
      version: 2,
      commands: {
        core: ['schedule', 'update'].map((operation) => ({
          name: `calendar:${operation}`,
          file: new URL(`./${operation}.ts`, import.meta.url).pathname,
          description: '',
          flags: [],
          aiChatTool: true,
        })),
        local: [],
        global: [],
      },
    })
    const app = new Hono().route('/calendar/_api', createMeetingRoutes(host))
    const fetching = spyOn(globalThis, 'fetch').mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => app.request(String(input), init)) as typeof fetch)
    const context = CommandContext.test({ ...config, PORT_SERVER: 41234 })
    const tasks = new CommandService(context)
    try {
      const chat = (await createNotebookTools(tasks)) as Record<string, ExecutableTool>
      const policies = createToolApprovalConfig({ context })
      const voices = createVoiceCommandTools(await discoverAIChatTools(), tasks)
      app.route(
        '/voice',
        createVoiceRoutes({
          createThread: async () => ({
            session: { type: 'realtime', model: 'mock-model' },
            opening: '',
            tools: voices,
          }),
          mint: async () => {
            throw new Error('Tests never open a real voice connection.')
          },
        }),
      )
      const call = async (name: string, input: Payload): Promise<Payload> => {
        const response = await app.request('http://localhost/voice/calendar-test/tools', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, arguments: JSON.stringify(input) }),
        })
        const { output } = (await response.json()) as { output: string }
        try {
          return JSON.parse(output) as Payload
        } catch {
          return { message: output }
        }
      }
      await run({
        chat,
        call,
        created,
        fixture,
        policy: async (name, input) => {
          const policy = policies[name]
          return typeof policy === 'function' ? policy(input) : policy
        },
        card: async (name, input) => (await approvalCard(name, input, getApprovalFormatter(name), context)).join('\n'),
      })
    } finally {
      await app.request('http://localhost/voice/calendar-test/end', { method: 'POST' })
      fetching.mockRestore()
      cached.mockRestore()
    }
  })
}

async function prepareDays(scheduler: CalendarScheduler, guests: boolean[]): Promise<string[]> {
  const days = await Promise.all(
    guests.map((invite, index) =>
      scheduler.review({
        fields: {
          ...UPDATE_EVENT.fields,
          title: `Atlas planning ${index + 1}`,
          date: `2030-06-0${index + 3}`,
          guests: invite ? UPDATE_EVENT.fields.guests : [],
          conference: 'none',
        },
      }),
    ),
  )
  return days.map((day) => day.draftId!)
}

test('chat and voice save multi-day solo blocks without approval and reuse their receipts', async () =>
  withTools(async ({ chat, call, policy, created, fixture: { scheduler } }) => {
    for (const surface of ['chat', 'voice']) {
      const ids = await prepareDays(scheduler, [false, false, false])
      const input = { send: [...ids, ids[0]].join(',') }
      assert({
        given: 'three requested solo blocks and a repeated draft ID',
        should: 'auto-approve from the saved empty guest lists',
        actual: await policy('calendar_schedule', input),
        expected: 'approved',
      })
      const run = (input: Payload) =>
        surface === 'chat' ? chat.calendar_schedule!.execute(input) : call('calendar_schedule', input)
      const saved = await run(input)
      const retried = await run(input)
      const receipt = await run({ status: ids.join(',') })
      assert({
        given: `a multi-day ${surface} save followed by a retry and status read`,
        should: 'create every block once with no approval and retain each result',
        actual: [
          saved.needsConfirmation,
          saved.state,
          (saved.jobs as Array<{ id: string; state: string }>).map((job) => [job.id, job.state]),
          retried.jobs,
          receipt.jobs,
          created.length,
        ],
        expected: [
          undefined,
          'created',
          ids.map((id) => [id, 'created']),
          saved.jobs,
          saved.jobs,
          surface === 'chat' ? 3 : 6,
        ],
      })
    }
  }))

test('one confirmation covers all events in an invitation or mixed calendar batch', async () =>
  withTools(async ({ call, policy, card, created, fixture: { scheduler } }) => {
    for (const guests of [
      [true, true, true],
      [false, true, false],
    ]) {
      const before = created.length
      const ids = await prepareDays(scheduler, guests)
      const input = { send: ids.join(',') }
      const summary = await card('calendar_schedule', input)
      const parked = await call('calendar_schedule', input)
      assert({
        given: 'multiple events including invitations in one request',
        should: 'show every date in one approval and write nothing before confirmation',
        actual: [
          await policy('calendar_schedule', input),
          parked.needsConfirmation,
          created.length,
          ['2030-06-03', '2030-06-04', '2030-06-05'].every((date) => summary.includes(date)),
          String(parked.summary).includes('Create these 3 calendar events together.'),
        ],
        expected: ['user-approval', true, before, true, true],
      })
      const saved = await call('confirm_action', { approvalId: parked.approvalId })
      const retried = await call('calendar_schedule', input)
      assert({
        given: 'one spoken yes and a retry of the completed batch',
        should: 'save the whole batch once and retrieve results without another approval',
        actual: [
          saved.state,
          (saved.jobs as unknown[]).length,
          retried.needsConfirmation,
          retried.jobs,
          created.length,
          await policy('calendar_schedule', input),
        ],
        expected: ['created', 3, undefined, saved.jobs, before + 3, 'approved'],
      })
    }
  }))

test('cancelled or invalid calendar batches cannot create a subset or bypass guest approval', async () =>
  withTools(async ({ chat, call, policy, created, fixture: { scheduler } }) => {
    const ids = await prepareDays(scheduler, [false, true, false])
    const parked = await call('calendar_schedule', { send: ids.join(',') })
    await call('cancel_action', { approvalId: parked.approvalId })
    const missing = `${ids[0]},${crypto.randomUUID()}`
    const failed = await chat.calendar_schedule!.execute({ send: missing })
    const refused = await call('calendar_schedule', { send: missing })
    let rejectedClaim = false
    try {
      await policy('calendar_schedule', { send: ids[1], guests: [], needsApproval: false })
    } catch {
      rejectedClaim = true
    }
    assert({
      given: 'a cancelled batch, a missing draft, or caller-supplied approval claims',
      should: 'reject the operation before any event is created',
      actual: [failed.success, refused.needsConfirmation, rejectedClaim, created.length],
      expected: [false, undefined, true, 0],
    })
  }))

test('batch receipts preserve successful and uncertain events without replaying either save', async () =>
  withTools(async ({ chat, policy, created, fixture: { scheduler, host } }) => {
    const ids = await prepareDays(scheduler, [false, false, false])
    const create = host.create
    host.create = async (...args) => {
      const result = await create(...args)
      if (args[0].title === 'Atlas planning 2') throw new Error('Lost the second save response.')
      return result
    }
    const input = { send: ids.join(',') }
    const saved = await chat.calendar_schedule!.execute(input)
    const retried = await chat.calendar_schedule!.execute(input)
    assert({
      given: 'one unconfirmed save among three requested blocks',
      should: 'return every receipt, keep the batch uncertain, and never repeat the writes',
      actual: [
        saved.state,
        (saved.jobs as Array<{ state: string }>).map((job) => job.state),
        retried.jobs,
        created.length,
        await policy('calendar_schedule', input),
      ],
      expected: ['uncertain', ['created', 'uncertain', 'created'], saved.jobs, 3, 'approved'],
    })
  }))

test('solo updates skip confirmation but removing the last guest still requires it', async () =>
  withTools(async ({ call, policy, fixture: { scheduler, state, saved } }) => {
    const removed = await scheduler.reviewUpdate({
      event: state.event.ref,
      version: state.event.version,
      fields: { ...state.event.fields, guests: [] },
    })
    const parked = await call('calendar_update', { send: removed.draftId })
    assert({
      given: 'an update removing every guest',
      should: 'still require approval for guest notifications',
      actual: [await policy('calendar_update', { send: removed.draftId }), parked.needsConfirmation, saved.length],
      expected: ['user-approval', true, 0],
    })
    await call('cancel_action', { approvalId: parked.approvalId })
    state.event.fields.guests = []
    const solo = await scheduler.reviewUpdate({
      event: state.event.ref,
      version: state.event.version,
      fields: { ...state.event.fields, time: '16:00' },
    })
    const decision = await policy('calendar_update', { send: solo.draftId })
    const result = await call('calendar_update', { send: solo.draftId })
    assert({
      given: 'a requested time change to an existing solo block',
      should: 'save directly without another confirmation',
      actual: [decision, result.needsConfirmation, result.state, saved.length],
      expected: ['approved', undefined, 'updated', 1],
    })
  }))

test('chat discovers calendar tools, asks for missing choices, and approves the saved invitation details', async () =>
  withTools(async ({ chat, policy, card, created }) => {
    const tool = chat.calendar_schedule!
    const unresolved = await tool.execute({ request: 'Meet Jane at 3pm', send: '' })
    const ready = await tool.execute({
      request: 'Meet Jane Doe at jane.work@example.com on 2030-05-03 at 15:00 New York time for 30 minutes',
    })
    const input = { send: ready.draftId }
    const summary = await card('calendar_schedule', input)
    assert({
      given: 'discovered tools and a conversational email clarification',
      should: 'prepare without writes, then gate only saving with the exact invitation and conflicts visible',
      actual: [
        Object.keys(chat).sort(),
        unresolved.status,
        ready.status,
        created.length,
        await policy('calendar_schedule', { request: 'Meet Jane', send: '' }),
        await policy('calendar_schedule', input),
        await policy('calendar_update', { status: ready.draftId }),
        sessionKeyToolNames(),
        summary.includes('jane.work@example.com'),
        summary.includes('2030-05-03 15:00'),
        summary.includes('Conflict: Atlas review'),
        summary.includes('Assumption:'),
      ],
      expected: [
        ['calendar_schedule', 'calendar_update'],
        'needs_input',
        'ready',
        0,
        'approved',
        'user-approval',
        'approved',
        [],
        true,
        true,
        true,
        true,
      ],
    })
    const sent = await tool.execute(input)
    const status = await tool.execute({ status: ready.draftId })
    assert({
      given: 'approval followed by a read-only receipt lookup',
      should: 'return the same completed event and send once',
      actual: [sent.state, status, created.length, created[0]?.guests],
      expected: ['created', sent, 1, [{ name: 'Jane Doe', email: 'jane.work@example.com' }]],
    })
  }))

test('voice schedules through conversation and sends only after one spoken confirmation', async () =>
  withTools(async ({ call, created }) => {
    const unresolved = await call('calendar_schedule', { request: 'Meet Jane at 3pm', send: ' ' })
    const ready = await call('calendar_schedule', { request: 'Meet jane.work@example.com at 3pm for 30 minutes' })
    const parked = await call('calendar_schedule', { send: ready.draftId })
    assert({
      given: 'a voice request, a clarification and a save call',
      should: 'resolve first, then park the concrete invitation without sending',
      actual: [
        unresolved.status,
        ready.status,
        parked.needsConfirmation,
        created.length,
        String(parked.summary).includes('jane.work@example.com'),
        String(parked.summary).includes('Conflict:'),
      ],
      expected: ['needs_input', 'ready', true, 0, true, true],
    })
    const sent = await call('confirm_action', { approvalId: parked.approvalId })
    const replay = await call('confirm_action', { approvalId: parked.approvalId })
    const receipt = await call('calendar_schedule', { status: ready.draftId })
    assert({
      given: 'a spoken yes, duplicate confirmation and a status question',
      should: 'create once and retrieve the same result without another confirmation',
      actual: [sent.state, String(replay.message).startsWith('No such pending action'), receipt, created.length],
      expected: ['created', true, sent, 1],
    })
  }))

test('voice resolves an existing event, cancels a draft and approves revised before/after changes', async () =>
  withTools(async ({ call, card, policy, created, fixture: { state, saved } }) => {
    state.candidates.push({ ...structuredClone(UPDATE_EVENT), ref: { ...UPDATE_EVENT.ref, eventId: 'another-event' } })
    const candidates = await call('calendar_update', { request: 'Move Atlas to 4pm' })
    const request = {
      request: 'Move Atlas to 4pm',
      event: UPDATE_EVENT.ref.eventId,
      calendar: UPDATE_EVENT.ref.calendarId,
      account: UPDATE_EVENT.ref.account,
    }
    const ready = await call('calendar_update', request)
    const parked = await call('calendar_update', { send: ready.draftId })
    const summary = await card('calendar_update', { send: ready.draftId })
    assert({
      given: 'ambiguous events and an explicit event selection',
      should: 'ask which event, then show identical stored changes in chat and voice',
      actual: [
        candidates.status,
        ready.status,
        saved.length,
        summary === parked.summary,
        summary.includes('Before: 2030-05-03 15:00'),
        summary.includes('After:  2030-05-03 16:00'),
        summary.includes('jane@example.com'),
        await policy('calendar_update', request),
        await policy('calendar_update', { send: ready.draftId }),
      ],
      expected: ['needs_input', 'ready', 0, true, true, true, true, 'approved', 'user-approval'],
    })
    await call('cancel_action', { approvalId: parked.approvalId })
    const cancelled = await call('confirm_action', { approvalId: parked.approvalId })
    state.parsed.changes = { time: '17:00', title: 'Atlas planning', duration: 45 }
    const revised = await call('calendar_update', {
      ...request,
      request: 'Move Atlas to 5pm, rename it Atlas planning and make it 45 minutes',
    })
    const approval = await call('calendar_update', { send: revised.draftId })
    const updated = await call('confirm_action', { approvalId: approval.approvalId })
    const receipt = await call('calendar_update', { status: revised.draftId })
    assert({
      given: 'a cancelled approval followed by a revised request and a yes',
      should: 'save only the revised existing event and preserve its conference',
      actual: [
        String(cancelled.message).startsWith('No such pending action'),
        updated.state,
        receipt,
        saved.length,
        created.length,
        saved[0]?.event.ref,
        saved[0]?.fields.time,
        saved[0]?.fields.title,
        saved[0]?.fields.duration,
        state.event.conferenceUrl,
      ],
      expected: [
        true,
        'updated',
        updated,
        1,
        0,
        UPDATE_EVENT.ref,
        '17:00',
        'Atlas planning',
        45,
        UPDATE_EVENT.conferenceUrl,
      ],
    })
  }))

test('calendar approval failures and stale events cannot save through voice', async () =>
  withTools(async ({ call, created, fixture: { state, saved } }) => {
    const ready = await call('calendar_update', { request: 'Move Atlas to 4pm' })
    const wrongTool = await call('calendar_schedule', { send: ready.draftId })
    const missing = await call('calendar_update', { send: crypto.randomUUID() })
    const override = await call('calendar_update', { send: ready.draftId, request: 'Move it to 5pm' })
    const parked = await call('calendar_update', { send: ready.draftId })
    state.event.version = '"changed-elsewhere"'
    const failed = await call('confirm_action', { approvalId: parked.approvalId })
    assert({
      given: 'wrong-operation, missing or overridden drafts, and an event changed after approval',
      should: 'fail before writing or sending any invitation',
      actual: [
        wrongTool.needsConfirmation,
        missing.needsConfirmation,
        override.needsConfirmation,
        failed.success,
        saved.length,
        created.length,
      ],
      expected: [undefined, undefined, undefined, false, 0, 0],
    })
  }))

test('legacy draft approvals load their stored fields and recheck the original availability', async () =>
  withTools(async ({ card, fixture: { scheduler, host, state } }) => {
    const prepared = await scheduler.prepareUpdate({ request: 'Move Atlas to 4pm' })
    const drafts = new CalendarDrafts(host.dir)
    const current = await drafts.get(prepared.draftId!)
    const legacy = await drafts.save({ fields: current.fields, reviewKey: current.reviewKey, update: current.update })
    const summary = await card('calendar_update', { send: legacy })
    state.event.start = '2030-05-03T16:00:00-04:00'
    state.event.end = '2030-05-03T16:30:00-04:00'
    state.event.ref.eventId = 'new-conflict'
    state.event.iCalUid = 'different-uid'
    let rejected = false
    try {
      await card('calendar_update', { send: legacy })
    } catch {
      rejected = true
    }
    assert({
      given: 'an older stored draft without a saved summary',
      should: 'show the exact update if availability still matches and refuse a changed review',
      actual: [summary.includes('After:  2030-05-03 16:00'), rejected],
      expected: [true, true],
    })
  }))
