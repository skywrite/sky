import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { ArgOrFlag, Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { calendarBatch, calendarDraftIds } from '#lib/calendarScheduler/batch.ts'
import { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import { describeCalendarBatch, describeCalendarJob, describePreparation } from '#lib/calendarScheduler/describe.ts'
import type { CalendarJob, CalendarJobBatch, CalendarPreparation } from '#lib/calendarScheduler/types.ts'
import { promptSchedule } from './lib/promptSchedule.ts'
import { calendarApproval, calendarNeedsApproval } from './lib/toolApproval.ts'

const params = {
  request: ArgOrFlag.string(
    'The user’s scheduling words plus any already-known context. Names or initials are enough; date, duration, timezone and emails may be omitted. Pass this before asking for missing details.',
    { optional: true },
  ),
  account: Flag.string('Organizer Google account (email or a unique part of it)', { short: 'a' }),
  timezone: Flag.string('Default IANA timezone for times without a zone; otherwise use the system timezone'),
  send: Flag.string(
    'Create prepared events by draft ID, or comma-separated IDs for one batch. Solo blocks run without approval; invitations require one approval for the whole batch. Repeat the same IDs to retrieve results.',
  ),
  status: Flag.string(
    'Read a previously sent draft/job ID, or comma-separated IDs, without saving or asking for approval',
  ),
  json: Flag.bool('Print the structured result as JSON', { default: false }),
}

type Params = InferParams<typeof params>
type Result = CalendarPreparation | CalendarJob | CalendarJobBatch

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'calendar:schedule': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: true })
export default class CalendarSchedule extends Command {
  static needsApprovalFor = calendarNeedsApproval('schedule')
  static formatApproval = calendarApproval('schedule')
  static override description: CommandDescription = {
    name: 'calendar:schedule',
    description:
      'Schedule Google Calendar events: solo time blocks, holds, or meetings with optional guests and Zoom. Call with the user’s request BEFORE asking for a day, emails or duration; the scheduler interprets the words and looks up saved contacts. Defaults: today, local timezone, 30 minutes; me/myself is the organizer. Preparation saves nothing. Ask only returned unresolved questions. When ready, call send: draftId. Solo blocks save without another confirmation; sending invitations requires approval. For multiple dates, prepare each event first, then send all draft IDs comma-separated in ONE call so any invitation approval covers the whole batch. Use status with the same IDs for receipts; never replace uncertain events. calendar_update edits existing events.',
    descriptionLong: [
      'A request resolves optional guests and conferencing, date, time, duration, and calendar conflicts.',
      'In a terminal, choose unresolved details; solo blocks save directly and invitations require confirmation.',
      'JSON, piped and composed calls return questions or a draft ID without interactive prompts.',
      'Use --send <draft-id> to create that exact event and send invitations only when it has guests.',
      'For several dates, prepare each event and use --send <id-1>,<id-2>,<id-3> to create them together.',
      'Use calendar:update to edit or reschedule an existing event.',
      'Requires the running Sky service and its connected Google Calendar browser. Zoom is needed only for Zoom events.',
      'The command returns structured data to callers; --json also prints it for shell automation.',
    ],
    usage: [
      'sky calendar:schedule "30-minute Zoom with Jane Doe tomorrow at 2pm Chicago time about Atlas"',
      'sky calendar:schedule "Block off tomorrow from 1pm to 3pm for focus time, no guests or video link"',
      'sky calendar:schedule "Meet jane@example.com on 2030-05-03 at 15:00" --account work --timezone America/New_York --json',
      'sky calendar:schedule --send <draft-id>',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const request = args.request?.trim()
    const send = args.send?.trim()
    const status = args.status?.trim()
    if ([request, send, status].filter(Boolean).length !== 1)
      return CommandResult.fail('Provide a natural-language request, --send <draft-id>, or --status <job-id>.')
    let ids: string[] = []
    if (send || status) {
      try {
        ids = calendarDraftIds(send || status)
      } catch {
        return CommandResult.fail(
          'Use prepared draft IDs returned by calendar:schedule, separated by commas for a batch (up to 50 events).',
        )
      }
    }
    if ((send || status) && (args.account || args.timezone))
      return CommandResult.fail(
        'A prepared draft already fixes the account and timezone. Prepare a new request to change them.',
      )
    const client = new CalendarSchedulerClient(`http://localhost:${context.config.PORT_SERVER}`)
    let sendingId = send
    const sendDrafts = async (ids: string[]): Promise<CommandResult<Result>> => {
      sendingId = ids.join(',')
      const result =
        ids.length === 1
          ? await client.wait(await client.send(ids[0]!, context.signal), context.signal)
          : await client.waitBatch(await client.sendBatch(ids, context.signal), context.signal)
      const message = 'jobs' in result ? describeCalendarBatch(result) : describeCalendarJob(result)
      context.output.log(args.json ? JSON.stringify(result, null, 2) : message)
      // Preserve every receipt through the tool boundary; the batch state reports partial failures.
      if ('jobs' in result) return CommandResult.success(result)
      return result.state === 'failed' || result.state === 'uncertain'
        ? CommandResult.fail(message, result)
        : CommandResult.success(result)
    }
    try {
      if (status) {
        const result =
          ids.length === 1
            ? await client.get(ids[0]!, context.signal)
            : calendarBatch(await Promise.all(ids.map((id) => client.get(id, context.signal))))
        context.output.log(
          args.json
            ? JSON.stringify(result, null, 2)
            : 'jobs' in result
              ? describeCalendarBatch(result)
              : describeCalendarJob(result),
        )
        return CommandResult.success(result)
      }
      if (send) return await sendDrafts(ids)
      const input = { request: request!, account: args.account, timezone: args.timezone }
      let prepared = await client.prepare(input, context.signal)
      const interactive =
        !args.json &&
        context.platform === CommandPlatform.Console &&
        context.compositionDepth === 0 &&
        context.prompt.interactive
      if (interactive) {
        const resolved = await promptSchedule(client, input, prepared, context)
        if (!resolved) {
          context.output.log('Cancelled. No event was created.')
          return CommandResult.success()
        }
        prepared = resolved
      }
      context.output.log(args.json ? JSON.stringify(prepared, null, 2) : describePreparation(prepared))
      if (interactive && prepared.status === 'ready' && prepared.draftId) {
        if (
          !prepared.fields.guests.length ||
          (await context.prompt.confirm({
            message: 'Create this event and send invitations?',
            initial: false,
          }))
        )
          return await sendDrafts([prepared.draftId])
        context.output.log('Event not created. The prepared draft is available to create later.')
      }
      return CommandResult.success(prepared)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Calendar scheduling failed.'
      return CommandResult.fail(
        sendingId
          ? `${message} Retrieve this request with sky calendar:schedule --send ${sendingId} before preparing another invitation.`
          : message,
      )
    }
  }
}
