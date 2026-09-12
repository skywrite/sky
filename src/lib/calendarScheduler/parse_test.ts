import { spyOn } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import * as models from '#shared/ai/models.ts'
import MarkdownStore from '#shared/models/Markdown/Store/mod.ts'
import { assert, test } from '#test'
import { PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { parseMeeting } from './parse.ts'
import { meetingPeople } from './people.ts'

test('calendar interpretation uses the civil clock and live scored contacts before requesting guest details', async () => {
  const notebook = await MarkdownStore.build({ peopleDirs: [], orgDirs: [] })
  notebook.people.set(
    '/notebook/people/Jordan-Davis.md',
    '---\nname: [Jordan Davis, JD]\nemail: jordan@example.com\n---\n',
  )
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Meet Jordan',
            date: '2030-05-03',
            requestedWeekday: null,
            time: '01:00',
            timezone: 'America/New_York',
            duration: 30,
            people: ['JD'],
            conference: 'zoom',
            description: '',
            assumptions: ['Assuming today, 2030-05-03.', 'Assuming 30 minutes.'],
            questions: [],
            unsupported: [],
          }),
        },
      ],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
  const selectedModel = spyOn(models, 'aiModelByProfile').mockReturnValue({ model })
  const searched: string[] = []
  try {
    const draft = await parseMeeting(
      'Schedule myself and JD at 1 AM',
      'America/New_York',
      async (query) => {
        searched.push(query)
        return meetingPeople(notebook, query, [{ name: 'Jordan Davis', score: 10 }])
      },
      undefined,
      PlainDateTime.fromString('2030-05-03 00:20'),
    )
    const instructions = model.doGenerateCalls[0]!.prompt.find((message) => message.role === 'system')!.content
    assert({
      given: 'a time and initials without a date or email, shortly after midnight',
      should: 'use the fast parser and stored contact, retain today, and treat the caller as organizer',
      actual: [
        selectedModel.mock.calls[0]?.[0],
        instructions.includes('2030-05-03'),
        instructions.includes('never put these in people'),
        searched,
        draft.fields.date,
        draft.fields.time,
        draft.fields.duration,
        draft.questions,
        draft.invitees.map((person) => person.selected),
      ],
      expected: [
        'default-cerebras-qwen-3.8',
        true,
        true,
        ['JD'],
        '2030-05-03',
        '01:00',
        30,
        [],
        [{ name: 'Jordan Davis', email: 'jordan@example.com' }],
      ],
    })
  } finally {
    selectedModel.mockRestore()
  }
})

test('calendar interpretation retains a solo hold without looking up a recipient or requiring Zoom', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            title: 'Focus time',
            date: '2030-05-03',
            requestedWeekday: null,
            time: '13:00',
            timezone: 'America/New_York',
            duration: 120,
            people: [],
            conference: 'none',
            description: '',
            assumptions: [],
            questions: [],
            unsupported: [],
          }),
        },
      ],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  })
  const selectedModel = spyOn(models, 'aiModelByProfile').mockReturnValue({ model })
  const searched: string[] = []
  try {
    const draft = await parseMeeting(
      'Block off tomorrow from 1pm to 3pm for focus time, no guests or video link',
      'America/New_York',
      async (query) => {
        searched.push(query)
        return []
      },
      undefined,
      PlainDateTime.fromString('2030-05-02 10:00'),
    )
    assert({
      given: 'a solo calendar block returned by interpretation',
      should: 'keep the full interval and conference choice without contact lookup or guest questions',
      actual: [
        draft.fields.time,
        draft.fields.duration,
        draft.fields.conference,
        draft.invitees,
        draft.questions,
        draft.unsupported,
        searched,
      ],
      expected: ['13:00', 120, 'none', [], [], [], []],
    })
  } finally {
    selectedModel.mockRestore()
  }
})
