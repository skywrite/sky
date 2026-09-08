import { spyOn } from 'bun:test'
import { Hono } from 'hono'
import { isAIChatTool } from '#commands/lib/AIChatTool.ts'
import CommandContext, { CommandPlatform } from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import type { Prompter } from '#commands/lib/prompt/Prompter.ts'
import { UnattendedPrompter } from '#commands/lib/prompt/UnattendedPrompter.ts'
import * as config from '#config'
import { UPDATE_EVENT, withUpdateFixture } from '#lib/calendarScheduler/test/updateFixture.ts'
import type { CalendarUpdatePreparation } from '#lib/calendarScheduler/updateTypes.ts'
import { createMeetingRoutes } from '#service/handler/meetings/mod.ts'
import { assert, test } from '#test'
import CalendarUpdate from './update.ts'

type RunArgs = Parameters<CalendarUpdate['run']>[0]['args']

async function fixture(
  run: (
    state: Parameters<Parameters<typeof withUpdateFixture>[0]>[0] & {
      invoke: (args?: Partial<RunArgs>, prompt?: Prompter, depth?: number) => ReturnType<CalendarUpdate['run']>
      output: BufferedOutput
      app: Hono
    },
  ) => Promise<void>,
) {
  await withUpdateFixture(async (state) => {
    const routes = createMeetingRoutes(state.host)
    const app = new Hono().route('/calendar/_api', routes).route('/meetings/_api', routes)
    const fetch = spyOn(globalThis, 'fetch').mockImplementation((async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => app.request(String(input), init)) as typeof globalThis.fetch)
    const output = new BufferedOutput()
    const invoke = (args: Partial<RunArgs> = {}, prompt: Prompter = new UnattendedPrompter(), depth = 0) => {
      const context = CommandContext.test(config).fork({
        platform: CommandPlatform.Console,
        output,
        prompt,
        compositionDepth: depth,
      })
      return new CalendarUpdate().run({
        args: {
          request: 'Move Atlas to 4pm',
          account: undefined,
          timezone: undefined,
          event: undefined,
          calendar: undefined,
          send: undefined,
          json: true,
          ...args,
        },
        context,
        tasks: new CommandService(context),
        rawArgs: { _: [] },
      })
    }
    try {
      await run({ ...state, output, invoke, app })
    } finally {
      fetch.mockRestore()
    }
  })
}

test('calendar:update prepares structured changes and sends the exact update once through the shared service', async () =>
  fixture(async ({ invoke, state, saved, app }) => {
    const prepared = await invoke()
    const draft = prepared.data as CalendarUpdatePreparation
    assert({
      given: 'an AI or piped command',
      should: 'prepare without saving or registering a chat tool',
      actual: [prepared.ok, draft.status, saved.length, isAIChatTool(CalendarUpdate)],
      expected: [true, 'ready', 0, false],
    })
    const sent = await invoke({ request: undefined, send: draft.draftId })
    const retry = await invoke({ request: undefined, send: draft.draftId })
    const legacy = await app.request(`http://localhost/meetings/_api/jobs/${draft.draftId}`)
    assert({
      given: 'the saved draft and a retry through the same API owner',
      should: 'return one update receipt across both route aliases',
      actual: [sent.ok, retry.data, await legacy.json(), saved.length, state.parses],
      expected: [true, sent.data, sent.data, 1, 1],
    })
  }))

test('calendar:update opens event and guest pickers and shows the final changes before confirmation', async () =>
  fixture(async ({ invoke, state, saved, output }) => {
    state.candidates.push({ ...structuredClone(UPDATE_EVENT), ref: { ...UPDATE_EVENT.ref, eventId: 'other-event' } })
    state.parsed.addGuests = [
      {
        query: 'Jordan',
        selected: null,
        candidates: [
          {
            id: 'jordan',
            name: 'Jordan Davis',
            hint: 'Atlas',
            emails: ['jordan@example.com', 'jordan.work@example.com'],
          },
        ],
      },
    ]
    const messages: string[] = []
    const prompt: Prompter = {
      ...new UnattendedPrompter(),
      interactive: true,
      select: async (question) => {
        messages.push(question.message)
        return question.message === 'Which event should be updated?' ? '0' : 'jordan.work@example.com'
      },
      text: async () => {
        throw new Error('No text input needed.')
      },
      confirm: async (question) => {
        messages.push(question.message)
        assert({
          given: 'the final confirmation',
          should: 'show time and email changes before any write',
          actual: [saved.length, output.hasLog('After:  2030-05-03 16:00'), output.hasLog('jordan.work@example.com')],
          expected: [0, true, true],
        })
        return true
      },
      multiselect: async () => null,
      place: async () => null,
      form: async () => null,
    }
    const result = await invoke({ json: false }, prompt)
    assert({
      given: 'ambiguous event and email matches',
      should: 'prompt, then save the selected values without parsing again',
      actual: [result.ok, messages, saved[0]?.fields.guests, state.parses],
      expected: [
        true,
        [
          'Which event should be updated?',
          'Which email address for Jordan Davis?',
          'Save these event changes and notify guests?',
        ],
        [...UPDATE_EVENT.fields.guests, { name: 'Jordan Davis', email: 'jordan.work@example.com' }],
        1,
      ],
    })
  }))

test('declining or cancelling an event update leaves the event unchanged; JSON and composed calls never prompt', async () =>
  fixture(async ({ invoke, saved }) => {
    let confirmations = 0
    const idle = new UnattendedPrompter()
    const prompt: Prompter = {
      interactive: true,
      select: async () => null,
      text: async () => null,
      confirm: async () => {
        confirmations++
        return false
      },
      multiselect: idle.multiselect,
      place: idle.place,
      form: idle.form,
    }
    const declined = await invoke({ json: false }, prompt)
    await invoke({ json: true }, prompt)
    await invoke({ json: false }, prompt, 1)
    assert({
      given: 'a declined terminal confirmation, JSON and a composed command',
      should: 'prepare but never save',
      actual: [declined.ok, confirmations, saved.length],
      expected: [true, 1, 0],
    })
  }))

test('explicit event IDs bypass search, and invalid overrides or cross-site updates cannot write', async () =>
  fixture(async ({ invoke, app, state, saved }) => {
    const explicit = await invoke({
      event: UPDATE_EVENT.ref.eventId,
      calendar: UPDATE_EVENT.ref.calendarId,
      account: UPDATE_EVENT.ref.account,
    })
    const id = (explicit.data as CalendarUpdatePreparation).draftId!
    const mixed = await invoke({ send: id })
    const override = await invoke({ request: undefined, send: id, timezone: 'UTC' })
    const missingAccount = await invoke({ event: 'mock-event' })
    const rejected = await app.request('http://localhost/calendar/_api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://example.com' },
      body: JSON.stringify({ draftId: id }),
    })
    const modified = await app.request('http://localhost/calendar/_api/update', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ draftId: id, fields: { time: '18:00' } }),
    })
    assert({
      given: 'an explicit target and invalid save requests',
      should: 'skip discovery and refuse overrides or cross-site writes',
      actual: [
        explicit.ok,
        state.searches,
        mixed.ok,
        override.ok,
        missingAccount.ok,
        rejected.status,
        modified.status,
        saved.length,
      ],
      expected: [true, 0, false, false, false, 403, 400, 0],
    })
  }))
