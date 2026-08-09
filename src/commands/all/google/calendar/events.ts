import colors from 'picocolors'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import type { CalendarEvent } from '#lib/google/mod.ts'
import { fetchDayMeetings, formatEventWhen, formatEventWho } from './lib/dayMeetings.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>
type Result = {
  meetings: CalendarEvent[]
  dropped: Array<{ event: CalendarEvent; reason: string }>
  errors: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:calendar:events': { params: Params; result: Result }
  }
}

export default class GoogleCalendarEventsTask extends Command {
  static override description: CommandDescription = {
    name: 'google:calendar:events',
    description: "List a day's Google Calendar events across accounts, split by the meeting policy.",
    usage: ['sky google:calendar:events', 'sky google:calendar:events 7', 'sky google:calendar:events 2026-08-07'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { day } = args

    const { timeZone, meetings, dropped, errors } = await fetchDayMeetings(secrets, day)

    if (errors.length > 0 && meetings.length === 0 && dropped.length === 0) {
      return CommandResult.fail(errors.join('\n'))
    }

    const count = meetings.length === 1 ? '1 meeting' : `${meetings.length} meetings`
    output.log(`\n  ${day.ymd} — ${count} (${timeZone})\n`)
    for (const event of meetings) {
      output.log(`    ${formatEventWhen(event)}  ${event.title || '(untitled)'}${formatEventWho(event)}`)
    }
    if (dropped.length > 0) {
      output.log('')
      for (const { event, reason } of dropped) {
        output.log(colors.dim(`    [${reason}] ${formatEventWhen(event)}  ${event.title || '(untitled)'}`))
      }
    }
    for (const error of errors) {
      output.log(colors.yellow(`\n  Warning: ${error}`))
    }
    output.log('')

    return CommandResult.success({ meetings, dropped, errors })
  }
}
