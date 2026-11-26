import colors from 'picocolors'
import { formatEventWhen, formatEventWho } from '#commands/all/google/calendar/lib/dayMeetings.ts'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { checkDayMeetings } from './lib/meetingCheck.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

type Result = {
  checked: number
  recorded: number
  missing: Array<{ title: string; start: string; end: string }>
  errors: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:meeting:check': { params: Params; result: Result }
  }
}

/**
 * Cross-references a day's Google Calendar meetings against the notebook's
 * meeting records and warns — never fails — about calendar meetings that
 * left no record. The check itself lives in lib/meetingCheck.ts, shared
 * with the chat and voice hosts that carry it into a model's context; this
 * command is its terminal voice. An unreachable calendar or service
 * degrades to a warning: a check must never hold the notebook hostage.
 * day:start runs this on the previous day; the review shows the same gaps.
 */
export default class DayMeetingCheckTask extends Command {
  static override description: CommandDescription = {
    name: 'day:meeting:check',
    description: 'Warn about calendar meetings missing a notebook record.',
    usage: ['sky day:meeting:check', 'sky day:meeting:check 7'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets, config } = context
    const { day } = args

    const check = await checkDayMeetings(secrets, day, <string>config.DIR_TIME)

    for (const error of check.errors) {
      output.log(colors.yellow(`\n  Warning: ${error}`))
    }

    let checked = 0
    let recorded = 0
    const missing: Result['missing'] = []

    if (!check.calendarRead) {
      output.log(colors.yellow(`\n  Could not check the calendar for ${day.ymd} — skipping the meeting check.\n`))
    } else if (check.meetings.length === 0) {
      output.log(`\n  ${day.ymd} — no meetings on the calendar. (${check.timeZone})\n`)
    } else if (!check.notebookRead) {
      output.log(colors.yellow(`\n  Could not query notebook meetings for ${day.ymd} — skipping the meeting check.\n`))
    } else {
      checked = check.meetings.length
      const lines: string[] = []
      for (const { event, record } of check.meetings) {
        const title = event.title || '(untitled)'
        if (record) {
          lines.push(
            `    ${colors.green('✓')} ${formatEventWhen(event)}  ${title}  ${colors.dim(`→ ${record.medium}: ${record.who}`)}`,
          )
        } else {
          missing.push({ title: event.title, start: event.start, end: event.end })
          lines.push(
            `    ${colors.yellow('⚠')} ${formatEventWhen(event)}  ${title}${formatEventWho(event)}  ${colors.yellow('— no meeting record')}`,
          )
        }
      }

      recorded = checked - missing.length
      output.log(
        `\n  ${day.ymd} — ${checked} calendar meetings, ${recorded} recorded, ${missing.length} missing (${check.timeZone})\n`,
      )
      for (const line of lines) output.log(line)
      if (missing.length > 0) {
        const word = missing.length === 1 ? 'meeting has' : 'meetings have'
        output.log(
          colors.yellow(`\n  ${missing.length} ${word} no notebook record — consider logging before ending the day.`),
        )
      }
      output.log('')
    }

    return CommandResult.success({ checked, recorded, missing, errors: check.errors })
  }
}
