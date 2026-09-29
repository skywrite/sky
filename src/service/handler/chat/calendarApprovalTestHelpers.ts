import * as path from 'node:path'
import { availabilityOf } from '#lib/calendarScheduler/availability.ts'
import { calendarDraftIds } from '#lib/calendarScheduler/batch.ts'
import { CalendarScheduler } from '#lib/calendarScheduler/CalendarScheduler.ts'
import { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import type { CalendarFields, CalendarReview, CalendarTiming } from '#lib/calendarScheduler/types.ts'
import type { ResolvedModel } from '#shared/ai/models.ts'
import ChatSession from '#shared/models/Chat/ChatSession/mod.ts'
import { PlainDate, PlainDateTime } from '#universal/dates/nbdt/mod.ts'
import { calendarApprovalPrompt } from './calendarApproval.ts'
import type { ChatRoutesOptions } from './mod.ts'

export const CALENDAR_FIELDS: CalendarFields = {
  title: 'Atlas planning',
  date: '2030-05-03',
  time: '15:00',
  timezone: 'America/New_York',
  duration: 30,
  account: 'organizer@example.com',
  conference: 'zoom',
  guests: [{ name: 'Jane Doe', email: 'jane@example.com' }],
  description: 'Review the proposal.\n\nAgree on the next steps.',
}
const NOW = '2030-05-01T12:00:00Z'

/** Real drafts, approvals and receipts; only the model and calendar provider are synthetic. */
export function calendarApprovalTestHost(root: string) {
  const sent: CalendarFields[] = []
  let now = NOW
  let warning = ''
  let draftIds: string[] | undefined
  let failure: 'before_save' | 'after_save' | 'sign_in' | 'repeat' | undefined
  const availability = async (timing: CalendarTiming) =>
    availabilityOf(timing, [{ label: 'Work', events: [] }], warning ? [warning] : [], NOW)
  const scheduler = new CalendarScheduler(
    {
      dir: path.join(root, 'calendar-state'),
      setup: async () => ({
        date: '2030-05-01',
        timezone: CALENDAR_FIELDS.timezone,
        accounts: [CALENDAR_FIELDS.account],
      }),
      people: async () => [],
      parse: async () => ({
        fields: structuredClone(CALENDAR_FIELDS),
        invitees: CALENDAR_FIELDS.guests.map((guest) => ({ query: guest.name, selected: guest, candidates: [] })),
        assumptions: ['Assuming 30 minutes.'],
        questions: [],
        unsupported: [],
      }),
      availability,
      create: async (fields, hooks) => {
        await hooks.beforeSave()
        if (failure === 'sign_in') throw new Error('Sign in to Google to continue.')
        if (failure === 'repeat')
          throw new Error('Calendar did not keep the requested repeat schedule. Nothing was saved.')
        if (failure === 'before_save') throw new Error('Sign in to the Calendar browser, then retry the saved draft.')
        await hooks.saving()
        if (failure === 'after_save') throw new Error('Connection lost after Save.')
        sent.push(structuredClone(fields))
        return {
          title: fields.title,
          calendarUrl: 'https://example.com/calendar/atlas',
          zoomUrl: 'https://example.com/zoom/atlas',
        }
      },
    },
    { now: () => now },
  )
  class LocalClient extends CalendarSchedulerClient {
    override approval(id: string, operation: 'schedule' | 'update') {
      return scheduler.approval(id, operation)
    }
    override review(value: CalendarReview) {
      return scheduler.review(value)
    }
    override get(id: string) {
      return scheduler.get(id).then((job) => {
        if (!job) throw new Error('Missing test job')
        return job
      })
    }
  }
  const client = new LocalClient('http://calendar.test')
  const chat: ChatRoutesOptions = {
    calendarClient: client,
    timeDir: path.join(root, 'time'),
    settings: {
      defaultModel: 'test',
      defaultContextTokens: 0,
      choices: () => [{ name: 'test', label: 'Test model', provider: 'Test', roles: [] }],
      resolve: () => ({ model: {} as ResolvedModel, profile: { model: 'test' } }),
      profileFor: () => 'test',
    },
    createSession: async (id, onEvent, _prefs, ask, restore) => {
      let called = false
      const ids = draftIds ?? [(await scheduler.prepare({ request: 'Meet Jane for Atlas planning.' })).draftId!]
      return new ChatSession({
        today: new PlainDate('2030-05-01'),
        startTime: new PlainDateTime('2030-05-01 08:00'),
        baseDir: root,
        timeDir: path.join(root, 'time'),
        days: 0,
        contextTokens: 0,
        resume: null,
        restore: restore?.state,
        model: {} as ResolvedModel,
        profile: { model: 'test' },
        producers: {
          produceInitialQuery: async () => ({ ok: true, value: { paths: [] } }),
          evolveQueries: async () => ({ ok: true, value: { queries: [], changed: false } }),
          executeQuery: async () => ({ ok: true, value: { paths: [] } }),
        },
        ambient: { today: { date: '2030-05-01', dayOfWeek: 'Wednesday' }, health: [], prices: [] },
        systemPrompt: async () => 'Test scheduling assistant.',
        tools: async () => ({ tools: {}, toolApproval: {} }),
        approvalHandler: async ({ input }) => {
          const prompt = await calendarApprovalPrompt(input as Record<string, unknown>, client)
          return ask(
            { toolName: 'calendar_schedule', lines: prompt.lines, calendar: prompt.calendar, revision: 0 },
            prompt.revise,
          )
        },
        autosavePath: path.join(root, `${id}.autosave.md`),
        onEvent,
        invokeModel: async ({ messages }) => {
          if (!called) {
            called = true
            const input = { send: ids.join(',') }
            const call = {
              type: 'tool-call' as const,
              toolCallId: 'calendar-call',
              toolName: 'calendar_schedule',
              input,
            }
            return {
              text: '',
              content: [{ type: 'tool-approval-request', approvalId: 'calendar-approval', toolCall: call }],
              steps: [],
              responseMessages: [{ role: 'assistant', content: [call] }],
            }
          }
          const decisions = messages.filter((message) => message.role === 'tool').flatMap((message) => message.content)
          const calls = messages
            .filter((message) => message.role === 'assistant')
            .flatMap((message) => (typeof message.content === 'string' ? [] : message.content))
          const decision = decisions.find((part) => part.type === 'tool-approval-response')
          const call = calls.find((part) => part.type === 'tool-call')
          if (decision?.type === 'tool-approval-response' && decision.approved && call?.type === 'tool-call') {
            const input = call.input as { send: string }
            const ids = calendarDraftIds(input.send)
            const result =
              ids.length === 1
                ? await client.wait(await scheduler.send(ids[0]!))
                : await client.waitBatch(await scheduler.sendBatch(ids))
            return {
              text:
                result.state === 'created'
                  ? 'The event was created.'
                  : 'The calendar request failed; your edited draft is preserved.',
              content: [],
              steps: [],
              responseMessages: [
                {
                  role: 'tool',
                  content: [
                    {
                      type: 'tool-result',
                      toolName: 'calendar_schedule',
                      toolCallId: call.toolCallId,
                      output: { type: 'json', value: result },
                    },
                  ],
                },
              ],
            }
          }
          return { text: 'No invitations were sent.', content: [], steps: [], responseMessages: [] }
        },
        fetchContext: async () => [],
        now: async () => new PlainDateTime('2030-05-01 08:00'),
        logError: async () => {},
      })
    },
  }
  return {
    chat,
    client,
    scheduler,
    sent,
    setFailure: (value: typeof failure) => {
      failure = value
    },
    setDraftIds: (value: string[]) => {
      draftIds = value
    },
    setWarning: (value: string) => {
      warning = value
    },
    setNow: (value: string) => {
      now = value
    },
  }
}
