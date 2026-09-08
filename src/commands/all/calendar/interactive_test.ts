import { spyOn } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { Hono } from 'hono'
import CommandContext, { CommandPlatform } from '#commands/lib/core/CommandContext.ts'
import CommandService from '#commands/lib/core/CommandService.ts'
import { BufferedOutput } from '#commands/lib/output/BufferedOutput.ts'
import type { ConfirmPrompt, Prompter, SelectPrompt, TextPrompt } from '#commands/lib/prompt/Prompter.ts'
import { UnattendedPrompter } from '#commands/lib/prompt/UnattendedPrompter.ts'
import * as config from '#config'
import { availabilityOf } from '#lib/calendarScheduler/availability.ts'
import type { CalendarDraft, CalendarFields, CalendarSchedulerHost } from '#lib/calendarScheduler/types.ts'
import { createMeetingRoutes } from '#service/handler/meetings/mod.ts'
import { assert, test } from '#test'
import CalendarSchedule from './schedule.ts'

const FIELDS: CalendarFields = {
  title: 'Atlas review',
  date: '2030-05-03',
  time: '23:00',
  timezone: 'America/New_York',
  duration: 15,
  account: 'organizer@example.com',
  guests: [],
  description: '',
}

type Answer = { kind: 'select' | 'text'; value: string | null } | { kind: 'confirm'; value: boolean | null }

async function fixture(
  answers: Answer[],
  run: (state: {
    host: CalendarSchedulerHost
    sent: CalendarFields[]
    parsed: string[]
    questions: Array<SelectPrompt | TextPrompt | ConfirmPrompt>
    output: BufferedOutput
    invoke: (options?: {
      json?: boolean
      depth?: number
      platform?: CommandPlatform
      interactive?: boolean
    }) => ReturnType<CalendarSchedule['run']>
  }) => Promise<void>,
) {
  const dir = await mkdtemp('/tmp/sky-calendar-interactive-')
  const sent: CalendarFields[] = []
  const parsed: string[] = []
  const questions: Array<SelectPrompt | TextPrompt | ConfirmPrompt> = []
  const output = new BufferedOutput()
  const script = [...answers]
  const next = (kind: Answer['kind'], question: SelectPrompt | TextPrompt | ConfirmPrompt) => {
    questions.push(question)
    const answer = script.shift()
    if (!answer || answer.kind !== kind) throw new Error(`Unexpected ${kind} prompt: ${question.message}`)
    return answer.value
  }
  const idle = new UnattendedPrompter()
  const prompt: Prompter = {
    interactive: true,
    select: async (question) => next('select', question) as string | null,
    text: async (question) => next('text', question) as string | null,
    confirm: async (question) => {
      assert({
        given: 'the final invitation confirmation',
        should: 'show the reviewed invitation before any send',
        actual: [sent.length, output.hasLog('Invite: Jane Doe <jane.work@example.com>')],
        expected: [0, true],
      })
      return next('confirm', question) as boolean | null
    },
    multiselect: idle.multiselect,
    place: idle.place,
    form: idle.form,
  }
  const host: CalendarSchedulerHost = {
    dir,
    setup: async () => ({
      date: FIELDS.date,
      timezone: FIELDS.timezone,
      accounts: [FIELDS.account, 'personal@example.com'],
    }),
    people: async () => [],
    parse: async (query): Promise<CalendarDraft> => {
      parsed.push(query)
      return {
        fields: structuredClone(FIELDS),
        assumptions: [],
        questions: [],
        unsupported: [],
        invitees: [
          {
            query: 'JD',
            selected: null,
            candidates: [
              { id: 'jane', name: 'Jane Doe', hint: 'Atlas', emails: ['jane@example.com', 'jane.work@example.com'] },
              { id: 'jordan', name: 'Jordan Davis', hint: 'Widget', emails: ['jordan@example.com'] },
            ],
          },
        ],
      }
    },
    availability: async (timing) => availabilityOf(timing, [{ label: 'Work', events: [] }], [], '2030-05-01T00:00:00Z'),
    create: async (fields, hooks) => {
      await hooks.beforeSave()
      await hooks.saving()
      sent.push(structuredClone(fields))
      return { title: fields.title, calendarUrl: 'https://example.com/calendar', zoomUrl: 'https://example.com/zoom' }
    },
  }
  const app = new Hono().route('/calendar/_api', createMeetingRoutes(host))
  const mocked = spyOn(globalThis, 'fetch').mockImplementation((async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => app.request(String(input), init)) as typeof fetch)
  const invoke = (
    options: { json?: boolean; depth?: number; platform?: CommandPlatform; interactive?: boolean } = {},
  ) => {
    const context = CommandContext.test(config).fork({
      platform: options.platform ?? CommandPlatform.Console,
      compositionDepth: options.depth ?? 0,
      prompt: options.interactive === false ? idle : prompt,
      output,
    })
    return new CalendarSchedule().run({
      args: {
        request: '15 minutes with JD tonight at 11 PM',
        account: undefined,
        timezone: undefined,
        send: undefined,
        json: options.json ?? false,
      },
      context,
      tasks: new CommandService(context),
      rawArgs: { _: [] },
    })
  }
  try {
    await run({ host, sent, parsed, questions, output, invoke })
  } finally {
    mocked.mockRestore()
    await rm(dir, { recursive: true, force: true })
  }
}

const choices: Answer[] = [
  { kind: 'select', value: FIELDS.account },
  { kind: 'select', value: '0' },
  { kind: 'select', value: 'jane.work@example.com' },
]

test('terminal scheduling prompts for organizer, contact and address, then sends only the confirmed selection', async () => {
  await fixture([...choices, { kind: 'confirm', value: true }], async ({ sent, parsed, questions, invoke }) => {
    const result = await invoke()
    assert({
      given: 'an ambiguous short name, two emails and two organizer accounts',
      should: 'ask real prompts and use those exact selections without a second AI parse',
      actual: [result.ok, questions.map((question) => question.message), sent, parsed.length],
      expected: [
        true,
        [
          'Which account should organize the meeting?',
          'Who do you mean by "JD"?',
          'Which email address for Jane Doe?',
          'Create this event and send invitations?',
        ],
        [{ ...FIELDS, guests: [{ name: 'Jane Doe', email: 'jane.work@example.com' }] }],
        1,
      ],
    })
  })
})

test('cancelling a picker or declining final confirmation never sends an invitation', async () => {
  for (let stage = 0; stage <= choices.length; stage++) {
    const answers: Answer[] = [
      ...choices.slice(0, stage),
      stage === choices.length ? { kind: 'confirm', value: false } : { kind: 'select', value: null },
    ]
    await fixture(answers, async ({ sent, invoke }) => {
      const result = await invoke()
      assert({
        given: `cancellation at prompt ${stage + 1}`,
        should: 'finish without inviting anyone',
        actual: [result.ok, sent.length],
        expected: [true, 0],
      })
    })
  }
})

test('JSON, piped, service and composed calls keep returning questions without terminal prompts', async () => {
  await fixture([], async ({ sent, questions, invoke }) => {
    const results: Awaited<ReturnType<CalendarSchedule['run']>>[] = []
    for (const options of [{ json: true }, { interactive: false }, { platform: CommandPlatform.Server }, { depth: 1 }])
      results.push(await invoke(options))
    assert({
      given: 'noninteractive callers with unresolved guests',
      should: 'return structured questions and never open a picker or send',
      actual: [
        results.map((result) => (result.data && 'status' in result.data ? result.data.status : '')),
        questions.length,
        sent.length,
      ],
      expected: [['needs_input', 'needs_input', 'needs_input', 'needs_input'], 0, 0],
    })
  })
})

test('terminal scheduling asks for missing timing before resolving contacts', async () => {
  await fixture(
    [{ kind: 'text', value: 'At 11 PM' }, ...choices, { kind: 'confirm', value: false }],
    async ({ host, parsed, questions, invoke }) => {
      const parse = host.parse
      host.parse = async (...args) => {
        const result = await parse(...args)
        if (parsed.length === 1) {
          result.fields.time = ''
          result.questions = ['What time should it start?']
        }
        return result
      }
      const result = await invoke()
      assert({
        given: 'a request needing a time and a contact choice',
        should: 'ask for timing in natural language, then preserve the selected contact directly',
        actual: [result.ok, questions[0]?.message, parsed.length, parsed[1]?.includes('Clarification: At 11 PM')],
        expected: [true, 'Please clarify the meeting details', 2, true],
      })
    },
  )
})

test('contacts without email addresses prompt for an address and reject invalid input', async () => {
  await fixture(
    [
      { kind: 'select', value: FIELDS.account },
      { kind: 'select', value: '0' },
      { kind: 'text', value: 'not an email' },
      { kind: 'text', value: 'jane.work@example.com' },
      { kind: 'confirm', value: false },
    ],
    async ({ host, questions, output, invoke }) => {
      const parse = host.parse
      host.parse = async (...args) => {
        const result = await parse(...args)
        result.invitees[0]!.candidates[0]!.emails = []
        return result
      }
      const result = await invoke()
      assert({
        given: 'a chosen contact without a saved address',
        should: 'validate a manually entered address before review',
        actual: [
          result.ok,
          questions.filter((question) => question.message === 'Email address for Jane Doe').length,
          output.hasLog('Enter a valid email address.'),
        ],
        expected: [true, 2, true],
      })
    },
  )
})

test('calendar availability is refreshed after answering the pickers and shown before confirmation', async () => {
  await fixture([...choices, { kind: 'confirm', value: false }], async ({ host, output, sent, invoke }) => {
    let checks = 0
    host.availability = async (timing) => {
      checks++
      return availabilityOf(timing, [], checks > 1 ? ['Could not check Work.'] : [], '2030-05-01T00:00:00Z')
    }
    const result = await invoke()
    assert({
      given: 'a calendar check that became incomplete while the user answered prompts',
      should: 'show the fresh warning in the final review without sending automatically',
      actual: [result.ok, checks, output.hasLog('Calendar check incomplete: Could not check Work.'), sent.length],
      expected: [true, 2, true, 0],
    })
  })
})
