import { z } from 'zod'
import { ArgOrFlag, Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { CalendarSchedulerClient } from '#lib/calendarScheduler/client.ts'
import { describeCalendarJob, describePreparation } from '#lib/calendarScheduler/describe.ts'
import type { CalendarJob, CalendarPreparation } from '#lib/calendarScheduler/types.ts'
import { promptSchedule } from './lib/promptSchedule.ts'

const params = {
  request: ArgOrFlag.string('Who to invite, when, duration, title, and agenda in natural language', { optional: true }),
  account: Flag.string('Organizer Google account (email or a unique part of it)', { short: 'a' }),
  timezone: Flag.string('Default IANA timezone for times without a zone; otherwise use the system timezone'),
  send: Flag.string('Create and send the exact prepared draft by ID; repeat the same ID to retrieve its result'),
  json: Flag.bool('Print the structured result as JSON', { default: false }),
}

type Params = InferParams<typeof params>
type Result = CalendarPreparation | CalendarJob

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'calendar:schedule': { params: Params; result: Result }
  }
}

export default class CalendarSchedule extends Command {
  static override description: CommandDescription = {
    name: 'calendar:schedule',
    description:
      'Prepare a Google Calendar invitation with Zoom from natural language, then send the reviewed draft by ID.',
    descriptionLong: [
      'A request resolves guests, date, time, duration, and calendar conflicts.',
      'In a terminal, choose unresolved contacts, emails and accounts, then confirm the invitation.',
      'JSON, piped and composed calls return questions or a draft ID without interactive prompts.',
      'Use --send <draft-id> to create that exact invitation and send it to guests.',
      'Use calendar:update to edit or reschedule an existing event.',
      'Requires the running Sky service and its connected Google Calendar/Zoom browser.',
      'The command returns structured data to callers; --json also prints it for shell automation.',
    ],
    usage: [
      'sky calendar:schedule "30-minute Zoom with Jane Doe tomorrow at 2pm Chicago time about Atlas"',
      'sky calendar:schedule "Meet jane@example.com on 2030-05-03 at 15:00" --account work --timezone America/New_York --json',
      'sky calendar:schedule --send <draft-id>',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const request = args.request?.trim()
    const send = args.send?.trim()
    if (!!request === !!send) return CommandResult.fail('Provide a natural-language request or --send <draft-id>.')
    if (send && !z.uuid().safeParse(send).success)
      return CommandResult.fail('Use the draft ID returned by calendar:schedule.')
    if (send && (args.account || args.timezone))
      return CommandResult.fail(
        'A prepared draft already fixes the account and timezone. Prepare a new request to change them.',
      )
    const client = new CalendarSchedulerClient(`http://localhost:${context.config.PORT_SERVER}`)
    let sendingId = send
    const sendDraft = async (id: string): Promise<CommandResult<Result>> => {
      sendingId = id
      const job = await client.wait(await client.send(id, context.signal), context.signal)
      const message = describeCalendarJob(job)
      context.output.log(args.json ? JSON.stringify(job, null, 2) : message)
      return job.state === 'failed' || job.state === 'uncertain'
        ? CommandResult.fail(message, job)
        : CommandResult.success(job)
    }
    try {
      if (send) return await sendDraft(send)
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
          context.output.log('Cancelled. No invitation was sent.')
          return CommandResult.success()
        }
        prepared = resolved
      }
      context.output.log(args.json ? JSON.stringify(prepared, null, 2) : describePreparation(prepared))
      if (interactive && prepared.status === 'ready' && prepared.draftId) {
        if (await context.prompt.confirm({ message: 'Create this event and send invitations?', initial: false }))
          return await sendDraft(prepared.draftId)
        context.output.log('Invitation not sent. The prepared draft is available to send later.')
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
