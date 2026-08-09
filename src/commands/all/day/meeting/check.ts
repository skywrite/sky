import colors from 'picocolors'
import { fetchDayMeetings, formatEventWhen, formatEventWho } from '#commands/all/google/calendar/lib/dayMeetings.ts'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const GRAPHQL_URL = 'http://localhost:9999/graphql'

/** A recording that started a few minutes late is still the same meeting. */
const START_TOLERANCE_MINUTES = 15

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

interface NotebookMeeting {
  who: string
  medium: string
  when: { datetime: string } | null
}

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
 * left no record. The notebook side is the service's meetings query; a
 * notebook meeting starting within START_TOLERANCE_MINUTES of a calendar
 * meeting counts as its record. Extra notebook meetings (ad-hoc calls that
 * never hit the calendar) are fine and ignored. An unreachable calendar or
 * service degrades to a warning: a check must never hold the notebook
 * hostage. day:end runs this on the ending day; day:start on the previous.
 */
export default class DayMeetingCheckTask extends Command {
  static override description: CommandDescription = {
    name: 'day:meeting:check',
    description: 'Warn about calendar meetings missing a notebook meeting record.',
    usage: ['sky day:meeting:check', 'sky day:meeting:check 7'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { day } = args

    // The never-throws contract is enforced here, not at call sites: even a
    // keychain failure below the calendar fetch must degrade to a warning.
    let fetched: Awaited<ReturnType<typeof fetchDayMeetings>>
    try {
      fetched = await fetchDayMeetings(secrets, day)
    } catch (err) {
      output.log(
        colors.yellow(
          `\n  Could not check the calendar for ${day.ymd} (${err instanceof Error ? err.message : String(err)}) — skipping the meeting check.\n`,
        ),
      )
      return CommandResult.success({ checked: 0, recorded: 0, missing: [], errors: [] })
    }
    const { timeZone, meetings, errors } = fetched
    for (const error of errors) {
      output.log(colors.yellow(`\n  Warning: ${error}`))
    }
    if (meetings.length === 0) {
      if (errors.length > 0) {
        output.log(colors.yellow(`\n  Could not check the calendar for ${day.ymd} — skipping the meeting check.\n`))
      } else {
        output.log(`\n  ${day.ymd} — no meetings on the calendar. (${timeZone})\n`)
      }
      return CommandResult.success({ checked: 0, recorded: 0, missing: [], errors })
    }

    const notebook = await fetchNotebookMeetings(day.ymd)
    if (notebook === null) {
      output.log(colors.yellow(`\n  Could not query notebook meetings for ${day.ymd} — skipping the meeting check.\n`))
      return CommandResult.success({ checked: 0, recorded: 0, missing: [], errors })
    }

    const missing: Result['missing'] = []
    const lines: string[] = []
    for (const event of meetings) {
      const start = minutesOf(event.start.slice(11, 16))
      const record = notebook.find(
        (m) => m.when && Math.abs(minutesOf(m.when.datetime.slice(11, 16)) - start) <= START_TOLERANCE_MINUTES,
      )
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

    const recorded = meetings.length - missing.length
    output.log(
      `\n  ${day.ymd} — ${meetings.length} calendar meetings, ${recorded} recorded, ${missing.length} missing (${timeZone})\n`,
    )
    for (const line of lines) output.log(line)
    if (missing.length > 0) {
      const word = missing.length === 1 ? 'meeting has' : 'meetings have'
      output.log(
        colors.yellow(`\n  ${missing.length} ${word} no notebook record — consider logging before ending the day.`),
      )
    }
    output.log('')

    return CommandResult.success({ checked: meetings.length, recorded, missing, errors })
  }
}

/** `HH:MM` (extended hours legal) to minutes; the sign belongs to the hour bucket. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** The day's meetings from the local service, or null when it can't answer. */
async function fetchNotebookMeetings(ymd: string): Promise<NotebookMeeting[] | null> {
  const query = `{ meetings(where: { date: "${ymd}" }) { who medium when { datetime } } }`
  try {
    const response = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return null
    const body = (await response.json()) as { data?: { meetings?: NotebookMeeting[] }; errors?: unknown[] }
    if (body.errors && body.errors.length > 0) return null
    return body.data?.meetings ?? []
  } catch {
    return null
  }
}
