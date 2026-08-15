import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import parseLaterList from '#commands/all/slack/cli/lib/agent-slack/parseLaterList.ts'
import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { runAgentSlack } from '#commands/all/slack/lib/agentSlack.ts'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { mpdmMemberHandles } from '#commands/all/slack/lib/mpdmMembers.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_BASE, SLACK_WORKSPACE } from '#config'
import { convertToNotebookTimezone } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { oneLine, parseSelection } from './lib/pick.ts'

const params = {
  date: Arg.string("Day to fetch (YYYY-MM-DD) — the origin message's notebook day. Defaults to today.", {
    optional: true,
  }),
  savedOn: Flag.bool('Match the day you saved the item instead of the message day', { default: false }),
  capture: Flag.string('Capture items into the notebook: "all" or 1-based indexes like "1,3"', { optional: true }),
  captureBatch: Flag.number('Capture the first N matched items (repeat for the next N)', { short: 'n' }),
  limit: Flag.number('Max saved items to fetch from Slack', { default: 600 }),
}

type Params = InferParams<typeof params>

type DayItem = {
  item: AgentSlackLaterItem
  /** Notebook day of the origin message */
  messageDay: string
  /** Notebook day of the save action */
  savedDay?: string
  timeLabel: string
  link: string
}

type Result = {
  day: string
  fetched: number
  inProgressTotal?: number
  matched: number
  captured: string[]
  completed: number
  /** Items still in progress for the day once this run is done */
  remaining: number
  failures: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:later:day': { params: Params; result: Result }
  }
}

export default class SlackLaterDayTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:later:day',
    description: 'Fetch Slack saved-for-later items for one day, and optionally capture them.',
    descriptionLong: [
      "Lists the in-progress items from Slack's Later tab whose origin message",
      'falls on the given notebook day (--saved-on matches the day you saved',
      'them instead). Listing is read-only.',
      '',
      'With --capture, each picked item runs through slack:follow:new: live',
      'threads are captured AND followed for new replies; threads quiet past',
      'the follow expiry window archive without a follow. Summary, auto-tags,',
      'and auto-rel apply either way, the item is then marked complete in',
      'Slack — the Later list stays the ledger of what remains — and captured',
      'files open in the editor when done.',
      '',
      '--capture-batch N takes only the first N matched items and reports what',
      'is left. Completed items drop off the list, so the same command run again',
      'takes the next N — capture a batch, check its tags, run it again.',
    ],
    usage: [
      'sky slack:later:day',
      'sky slack:later:day --capture all',
      'sky slack:later:day 2026-06-03 --capture-batch 10',
      'sky slack:later:day 2026-06-03 --capture 1,3',
      'sky slack:later:day 2026-06-03 --saved-on',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context

    let day: PlainDate
    try {
      day = new PlainDate(args.date ?? context.notebookNow.date)
    } catch {
      return CommandResult.fail(`Invalid date: ${args.date} (use YYYY-MM-DD)`)
    }
    const dayStr = day.toString()

    // Both name what to capture — pick one rather than guess a precedence
    if (args.capture !== undefined && args.captureBatch !== undefined) {
      return CommandResult.fail('Use --capture or --capture-batch, not both')
    }
    if (args.captureBatch !== undefined && (!Number.isInteger(args.captureBatch) || args.captureBatch < 1)) {
      return CommandResult.fail(
        `Invalid --capture-batch: ${args.captureBatch} (use a whole number of items, 1 or more)`,
      )
    }

    if (!SLACK_WORKSPACE) {
      return CommandResult.fail(
        'No slack.workspace configured — permalinks need it. Set it via sky init or config.jsonc.',
      )
    }
    const workspace = SLACK_WORKSPACE.replace(/\/$/, '')

    const listResult = await runAgentSlack([
      'later',
      'list',
      '--state',
      'in_progress',
      '--limit',
      String(args.limit),
      '--max-body-chars',
      '300',
    ])
    if (!listResult.success) {
      const detail = listResult.stderr.trim() || listResult.stdout.trim()
      const hint = detail.includes('invalid_auth') ? ' — credentials expired, run `sky slack:auth`' : ''
      return CommandResult.fail(`agent-slack later list failed: ${detail}${hint}`)
    }
    const list = parseLaterList(listResult.stdout)
    if (!list) {
      return CommandResult.fail(`Failed to parse agent-slack later list output: ${oneLine(listResult.stdout, 200)}`)
    }

    // Notebook-day per item, via the same conversion slack:new uses to file
    // captures — so the listed day and the captured day can never disagree
    const dayItems: DayItem[] = []
    for (const item of list.items) {
      const timeLabel = formatSlackTimestamp(item.ts, systemNow.timezone)
      const messageDay = (await convertToNotebookTimezone(timeLabel)).plainDate.toString()
      let savedDay: string | undefined
      if (item.date_saved) {
        const savedLabel = formatSlackTimestamp(String(item.date_saved), systemNow.timezone)
        savedDay = (await convertToNotebookTimezone(savedLabel)).plainDate.toString()
      }
      const link = `${workspace}/archives/${item.channel_id}/p${item.ts.replace('.', '')}`
      dayItems.push({ item, messageDay, savedDay, timeLabel, link })
    }

    const matched = dayItems
      .filter((d) => (args.savedOn ? d.savedDay === dayStr : d.messageDay === dayStr))
      .sort((a, b) => (a.item.ts < b.item.ts ? -1 : 1))

    output.log(
      `Saved-later items for ${dayStr} (${args.savedOn ? 'saved that day' : 'message day'}): ` +
        `${matched.length} matched of ${list.items.length} fetched` +
        (list.counts.in_progress !== undefined ? ` (${list.counts.in_progress} in progress total)` : ''),
    )
    for (const [index, d] of matched.entries()) {
      // D-prefixed conversation ids are DMs (person, no #); mpdm slugs list their members
      const isDm = d.item.channel_id.startsWith('D')
      const name = d.item.channel_name?.replace(/^#/, '')
      const groupHandles = mpdmMemberHandles(name)
      const channel =
        groupHandles.length > 0 ? groupHandles.join(', ') : name ? (isDm ? name : `#${name}`) : d.item.channel_id
      output.log(`  ${index + 1}. ${d.timeLabel.slice(11)}  ${channel}  ${oneLine(d.item.message?.content ?? '', 90)}`)
      output.log(`     ${d.link}`)
    }

    if (matched.length === 0 || (!args.capture && args.captureBatch === undefined)) {
      if (matched.length > 0) {
        output.log('')
        output.log(`Re-run with: sky slack:later:day ${dayStr} --capture-batch 10   (or --capture all, --capture 1,3)`)
      }
      return CommandResult.success({
        day: dayStr,
        fetched: list.items.length,
        inProgressTotal: list.counts.in_progress,
        matched: matched.length,
        captured: [],
        completed: 0,
        remaining: matched.length,
        failures: [],
      })
    }

    let picked: DayItem[]
    if (args.capture) {
      const selection = parseSelection(args.capture, matched.length)
      if (!selection) {
        return CommandResult.fail(`Invalid --capture: ${args.capture} (use "all" or indexes 1-${matched.length})`)
      }
      picked = selection === 'all' ? matched : selection.map((i) => matched[i])
    } else {
      picked = matched.slice(0, args.captureBatch)
      if (picked.length < matched.length) {
        output.log('')
        output.log(`Capturing the first ${picked.length} of ${matched.length} matched`)
      }
    }

    const captured: string[] = []
    const openTargets: string[] = []
    const failures: string[] = []
    let completed = 0

    for (const d of picked) {
      output.log('')
      output.log(`Capturing ${d.link}`)
      const result = await tasks.run('slack:follow:new', { link: d.link, noEditor: true })

      if (!result.ok) {
        // An already-followed thread is already flowing into the notebook via
        // follow:check — completing the Later item is still the right move
        if (result.message?.includes('Duplicate follow')) {
          output.log('  Already followed — skipping capture')
          const done = await runAgentSlack(['later', 'complete', d.link])
          if (done.success) completed++
          else
            failures.push(`${d.link}: already followed; complete failed — ${oneLine(done.stderr || done.stdout, 120)}`)
          continue
        }
        failures.push(`${d.link}: ${result.message}`)
        continue
      }

      const files = result.data?.slackFiles ?? []
      if (files.length === 0) {
        failures.push(`${d.link}: no files written`)
        continue
      }
      if (result.data?.followed) output.log('  Live thread — following for new replies')
      captured.push(...files)
      openTargets.push(...files.map((p) => path.join(DIR_BASE, p)))

      const done = await runAgentSlack(['later', 'complete', d.link])
      if (done.success) {
        completed++
      } else {
        failures.push(`${d.link}: captured but not completed in Slack — ${oneLine(done.stderr || done.stdout, 120)}`)
      }
    }

    // Completed items leave the in-progress list, so what's left is what the
    // next run of this same command will pick up
    const remaining = matched.length - completed

    output.log('')
    output.log(`Captured ${captured.length}/${picked.length}; completed in Slack: ${completed}`)
    for (const failure of failures) output.log(`  ! ${failure}`)
    if (remaining > 0) {
      const next =
        args.captureBatch === undefined ? '' : ` — re-run for the next ${Math.min(args.captureBatch, remaining)}`
      output.log(`${remaining} left for ${dayStr}${next}`)
    }

    if (openTargets.length > 0) {
      openEditor(openTargets.map((file) => ({ file })))
      await delay(500)
    }

    return CommandResult.success({
      day: dayStr,
      fetched: list.items.length,
      inProgressTotal: list.counts.in_progress,
      matched: matched.length,
      captured,
      completed,
      remaining,
      failures,
    })
  }
}
