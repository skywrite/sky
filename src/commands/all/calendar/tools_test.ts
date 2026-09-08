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
      const policies = createToolApprovalConfig()
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
