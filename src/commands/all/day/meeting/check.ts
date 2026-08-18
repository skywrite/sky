import * as path from 'node:path'
import colors from 'picocolors'
import { fetchDayMeetings, formatEventWhen, formatEventWho } from '#commands/all/google/calendar/lib/dayMeetings.ts'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readDir, readTextFile } from '#shared/fs/mod.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import hasEndOrLength from './lib/hasEndOrLength.ts'

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
  when: { datetime: string; end: string | null } | null
}

type Endless = { start: string; label: string; kind: 'meeting' | 'event' }

type Result = {
  checked: number
  recorded: number
  missing: Array<{ title: string; start: string; end: string }>
  endless: Endless[]
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
 *
 * Also warns about the day's meetings and events that state no end time or
 * length — summary:day's Time section can only count what `when:` states,
 * so open-ended records get named here while memory is fresh. This check
 * needs only the notebook, so it runs even when the calendar doesn't.
 */
export default class DayMeetingCheckTask extends Command {
  static override description: CommandDescription = {
    name: 'day:meeting:check',
    description: 'Warn about calendar meetings missing a notebook record, and records missing end times.',
    usage: ['sky day:meeting:check', 'sky day:meeting:check 7'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets, config } = context
    const { day } = args

    const notebook = await fetchNotebookMeetings(day.ymd)

    // The never-throws contract is enforced here, not at call sites: even a
    // keychain failure below the calendar fetch must degrade to a warning.
    let fetched: Awaited<ReturnType<typeof fetchDayMeetings>> | null = null
    try {
      fetched = await fetchDayMeetings(secrets, day)
    } catch (err) {
      output.log(
        colors.yellow(
          `\n  Could not check the calendar for ${day.ymd} (${err instanceof Error ? err.message : String(err)}) — skipping the meeting check.\n`,
        ),
      )
    }

    let checked = 0
    let recorded = 0
    const missing: Result['missing'] = []
    const errors: string[] = []

    if (fetched) {
      const { timeZone, meetings } = fetched
      errors.push(...fetched.errors)
      for (const error of errors) {
        output.log(colors.yellow(`\n  Warning: ${error}`))
      }
      if (meetings.length === 0) {
        if (errors.length > 0) {
          output.log(colors.yellow(`\n  Could not check the calendar for ${day.ymd} — skipping the meeting check.\n`))
        } else {
          output.log(`\n  ${day.ymd} — no meetings on the calendar. (${timeZone})\n`)
        }
      } else if (notebook === null) {
        output.log(
          colors.yellow(`\n  Could not query notebook meetings for ${day.ymd} — skipping the meeting check.\n`),
        )
      } else {
        checked = meetings.length
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

        recorded = meetings.length - missing.length
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
      }
    }

    // End-time nudge: notebook-only, so it runs regardless of calendar state.
    const endless: Endless[] = []
    for (const m of notebook ?? []) {
      if (m.when && !m.when.end) {
        endless.push({ start: m.when.datetime.slice(11, 16), label: `${m.medium}: ${m.who}`, kind: 'meeting' })
      }
    }
    endless.push(...(await fetchEndlessEvents(<string>config.DIR_TIME, day)))
    endless.sort((a, b) => a.start.localeCompare(b.start))

    if (endless.length > 0) {
      const word = endless.length === 1 ? 'record states' : 'records state'
      output.log(colors.yellow(`  ${endless.length} ${word} no end time — add "- HH:MM" or a length ("45m") to when::`))
      for (const e of endless) {
        output.log(
          `    ${colors.yellow('⚠')} ${e.start}  ${e.label}${e.kind === 'event' ? colors.dim('  (event)') : ''}`,
        )
      }
      output.log('')
    }

    return CommandResult.success({ checked, recorded, missing, endless, errors })
  }
}

/** `HH:MM` (extended hours legal) to minutes; the sign belongs to the hour bucket. */
function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

/** The day's meetings from the local service, or null when it can't answer. */
async function fetchNotebookMeetings(ymd: string): Promise<NotebookMeeting[] | null> {
  const query = `{ meetings(where: { date: "${ymd}" }) { who medium when { datetime end } } }`
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

/**
 * Start-only records from the day's actions/events/ — calendar-sourced
 * events aren't queryable on the service yet, and this is a frontmatter
 * completeness read of one bounded directory, not record matching (which
 * stays on GraphQL). Any failure reads as "no events".
 */
async function fetchEndlessEvents(timeDir: string, day: Params['day']): Promise<Endless[]> {
  const eventsDir = path.join(timeDir, dayDir(day), 'actions', 'events')
  const endless: Endless[] = []
  try {
    for await (const entry of readDir(eventsDir)) {
      if (!entry.name.endsWith('.md')) continue
      const content = await readTextFile(path.join(eventsDir, entry.name))
      const when = content.match(/^when:[ \t]*(.+)$/m)?.[1]?.trim()
      if (!when || hasEndOrLength(when)) continue
      const what = content.match(/^what:[ \t]*(.+)$/m)?.[1]?.trim()
      endless.push({ start: when.slice(11, 16), label: what || entry.name.replace(/\.md$/, ''), kind: 'event' })
    }
  } catch {
    // No events directory, or unreadable — nothing to nudge about.
  }
  return endless
}
