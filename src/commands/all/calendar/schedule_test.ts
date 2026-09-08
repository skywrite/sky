import { spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { Hono } from 'hono'
import { isAIChatTool } from '#commands/lib/AIChatTool.ts'
import CommandContext from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import * as config from '#config'
import { availabilityOf } from '#lib/calendarScheduler/availability.ts'
import type { CalendarFields, CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import { createMeetingRoutes } from '#service/handler/meetings/mod.ts'
import { assert, test } from '#test'
import CalendarSchedule from './schedule.ts'

test('calendar:schedule prepares through the service and sends its exact draft without exposing a chat tool', async () => {
  const dir = await mkdtemp('/tmp/sky-calendar-command-')
  const fields: CalendarFields = {
    title: 'Atlas kickoff',
    date: '2030-05-03',
    time: '15:00',
    timezone: 'America/New_York',
    duration: 30,
    account: 'organizer@example.com',
    guests: [{ name: 'Jane Doe', email: 'jane@example.com' }],
    description: '',
  }
  let sends = 0
  let parses = 0
  const host: CalendarSchedulerHost = {
    dir,
    setup: async () => ({ date: fields.date, timezone: fields.timezone, accounts: [fields.account] }),
    people: async () => [],
    parse: async () => {
      parses++
      return {
        fields,
        invitees: [{ query: 'Jane Doe', candidates: [], selected: fields.guests[0]! }],
        assumptions: [],
        questions: [],
        unsupported: [],
      }
    },
    availability: async (timing) => availabilityOf(timing, [{ label: 'Work', events: [] }], [], '2030-05-01T00:00:00Z'),
    create: async (_fields, hooks) => {
      await hooks.beforeSave()
      await hooks.saving()
      sends++
      return { title: fields.title, calendarUrl: 'https://example.com/calendar', zoomUrl: 'https://example.com/zoom' }
    },
  }
  const app = new Hono()
  const routes = createMeetingRoutes(host)
  app.route('/calendar/_api', routes)
  app.route('/meetings/_api', routes)
  const requests: string[] = []
  const mocked = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    requests.push(`${init?.method ?? 'GET'} ${new URL(String(input)).pathname}`)
    return app.request(String(input), init)
  }) as typeof fetch)
  const context = CommandContext.test({ ...config, PORT_SERVER: 41234 })
  const command = new CalendarSchedule()
  const invoke = (args: { request?: string; send?: string; account?: string; timezone?: string; json?: boolean }) =>
    command.run({
      args: { request: undefined, send: undefined, account: undefined, timezone: undefined, json: true, ...args },
      context,
      tasks: new CommandService(context),
      rawArgs: { _: [] },
    })
  try {
    const prepared = await invoke({ request: 'Meet Jane Doe tomorrow at 3pm' })
    const data = prepared.data
    const id = data && 'draftId' in data ? data.draftId : undefined
    assert({
      given: 'a natural-language command call',
      should: 'return the prepared invitation without sending or registering itself for chat',
      actual: [prepared.ok, !!id, sends, isAIChatTool(CalendarSchedule), requests],
      expected: [true, true, 0, false, ['POST /calendar/_api/prepare']],
    })
    const sent = await invoke({ send: id })
    const retried = await invoke({ send: id })
    const legacyStatus = await app.request(`http://localhost/meetings/_api/jobs/${id}`)
    const body = await legacyStatus.json()
    assert({
      given: 'send, retry and a composer lookup of the same request',
      should: 'share one completed job across both API paths and never reinterpret it',
      actual: [sent.ok, retried.data, body, sends, parses],
      expected: [true, sent.data, sent.data, 1, 1],
    })
    const before = requests.length
    const changed = await invoke({ send: id, timezone: 'Europe/Paris' })
    const combined = await invoke({ send: id, request: 'Use a different time' })
    const missing = await invoke({})
    assert({
      given: 'field overrides on a send, mixed modes and empty input',
      should: 'refuse invalid command calls before contacting the service',
      actual: [changed.ok, combined.ok, missing.ok, requests.length],
      expected: [false, false, false, before],
    })
    const modified = await app.request('http://localhost/calendar/_api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draftId: id, fields: { ...fields, time: '17:00' } }),
    })
    assert({
      given: 'an API send that also supplies modified fields',
      should: 'refuse the override instead of implying that the prepared draft changed',
      actual: modified.status,
      expected: 400,
    })
  } finally {
    mocked.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
})
