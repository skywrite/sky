import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { ArgOrFlag, Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import { describeCalendarJob, describeUpdatePreparation } from '#lib/calendarScheduler/describe.ts'
import type { CalendarJob } from '#lib/calendarScheduler/types.ts'
import type { CalendarUpdatePreparation, CalendarUpdateRequest } from '#lib/calendarScheduler/updateTypes.ts'
import { promptUpdate } from './lib/promptUpdate.ts'
import { calendarApproval, calendarNeedsApproval } from './lib/toolApproval.ts'

const params = {
  request: ArgOrFlag.string(
    'The user’s words identifying the existing event and requested changes, plus any already-known context. Call before asking for event IDs or guest emails; the scheduler searches for them.',
    { optional: true },
  ),
  account: Flag.string('Google account email or a unique part of it; an exact email is required with --event', {
    short: 'a',
  }),
  timezone: Flag.string('IANA timezone for interpreting the request; otherwise use the event timezone'),
  event: Flag.string('Exact Google event ID, including a specific occurrence ID for recurring events'),
  calendar: Flag.string('Calendar ID when using --event; defaults to primary'),
  send: Flag.string('Save the exact prepared update by draft ID and notify guests; retries retrieve its result'),
  status: Flag.string('Read a previously saved draft/job ID without changing the event or asking for approval'),
  json: Flag.bool('Print structured questions or a prepared update without interactive prompts', { default: false }),
}
type Params = InferParams<typeof params>
type Result = CalendarUpdatePreparation | CalendarJob

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'calendar:update': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: true })
export default class CalendarUpdate extends Command {
  static needsApprovalFor = calendarNeedsApproval('update')
  static formatApproval = calendarApproval('update')
  static override description: CommandDescription = {
    name: 'calendar:update',
    description:
      'Edit or reschedule an existing Google Calendar event: time, duration, title, agenda, location or guests. Call request first to search events and scored contacts before asking for IDs or emails. Preparation saves nothing; omitted fields stay unchanged. Ask only unresolved questions using returned choices. Reuse exact event, calendar and account IDs once known. When ready, call send: draftId. Solo blocks save without another confirmation; changes affecting guests, including removing them, require approval to notify them. Use status for receipts. Never create a replacement event.',
    descriptionLong: [
      'Find the existing event, review only the requested changes, then save and notify guests.',
      'In a terminal, ambiguous events and guests open pickers before the final confirmation.',
      'JSON, piped and composed calls return structured questions or a draft ID; --send saves that exact update.',
      'Supports time, duration, title, agenda, location and guests for regular timed events you organize.',
      'A recurring event is updated for the selected occurrence only. Its conference link is preserved.',
      'Requires the running Sky service and its signed-in Google Calendar browser.',
    ],
    usage: [
      'sky calendar:update "Move tomorrow’s meeting with Jane Doe to 4pm"',
      'sky calendar:update "Rename it Atlas planning and make it 45 minutes" --event <event-id> --account organizer@example.com --json',
      'sky calendar:update --send <draft-id>',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const request = args.request?.trim()
    const send = args.send?.trim()
    const status = args.status?.trim()
    if ([request, send, status].filter(Boolean).length !== 1)
      return CommandResult.fail('Provide a natural-language update, --send <draft-id>, or --status <job-id>.')
    if (
      (send || status) &&
      (!z.uuid().safeParse(send || status).success || args.account || args.timezone || args.event || args.calendar)
    )
      return CommandResult.fail(
        'Use only --send <draft-id> to save an already reviewed update, or --status <job-id> to read its outcome.',
      )
    if (args.calendar && !args.event) return CommandResult.fail('--calendar requires --event.')
    if (args.event && !z.email().safeParse(args.account).success)
      return CommandResult.fail('--event requires the full Google account email with --account.')
    const client = new CalendarSchedulerClient(`http://localhost:${context.config.PORT_SERVER}`)
    let savingId = send
    const save = async (id: string): Promise<CommandResult<Result>> => {
      savingId = id
      const job = await client.wait(await client.update(id, context.signal), context.signal)
      const message = describeCalendarJob(job)
      context.output.log(args.json ? JSON.stringify(job, null, 2) : message)
      return job.state === 'failed' || job.state === 'uncertain'
        ? CommandResult.fail(message, job)
        : CommandResult.success(job)
    }
    try {
      if (status) {
        const job = await client.get(status, context.signal)
        context.output.log(args.json ? JSON.stringify(job, null, 2) : describeCalendarJob(job))
        return CommandResult.success(job)
      }
      if (send) return await save(send)
      const input: CalendarUpdateRequest = {
        request: request!,
        account: args.account,
        timezone: args.timezone,
        ...(args.event
          ? { event: { eventId: args.event, calendarId: args.calendar ?? 'primary', account: args.account! } }
          : {}),
      }
      let prepared = await client.prepareUpdate(input, context.signal)
      const interactive =
        !args.json &&
        context.platform === CommandPlatform.Console &&
        context.compositionDepth === 0 &&
        context.prompt.interactive
      if (interactive) {
        const resolved = await promptUpdate(client, input, prepared, context)
        if (!resolved) {
          context.output.log('Cancelled. The event was not changed.')
          return CommandResult.success()
        }
        prepared = resolved
      }
      context.output.log(args.json ? JSON.stringify(prepared, null, 2) : describeUpdatePreparation(prepared))
      if (interactive && prepared.status === 'ready' && prepared.draftId) {
        if (
          (!prepared.fields?.guests.length && !prepared.event?.fields.guests.length) ||
          (await context.prompt.confirm({ message: 'Save these event changes and notify guests?', initial: false }))
        )
          return await save(prepared.draftId)
        context.output.log('The event was not changed. The prepared update is available to save later.')
      }
      return CommandResult.success(prepared)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Calendar update failed.'
      return CommandResult.fail(
        savingId
          ? `${message} Retrieve this request with sky calendar:update --send ${savingId} before preparing another update.`
          : message,
      )
    }
  }
}
