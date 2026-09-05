import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import type { AgentSlackLaterItem } from '#commands/all/slack/cli/lib/agent-slack/types.ts'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { convertToNotebookTimezone } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { captureLaterItems, openInSlack } from './lib/capture.ts'
import {
  backfillMissingMessages,
  fetchInProgressLater,
  laterCapturable,
  laterChannelMatches,
  laterGroupKey,
  laterItemLink,
  laterMatchableName,
  normalizeChannelQuery,
  renderLaterLabel,
  renderLaterRow,
  resolveRowMemberNames,
  resolveRowMentions,
  resolveStaleChannels,
} from './lib/list.ts'
import { parseSelection } from './lib/pick.ts'

const params = {
  date: Arg.string("Day to fetch (YYYY-MM-DD) — the origin message's notebook day. Defaults to today.", {
    optional: true,
  }),
  savedOn: Flag.bool('Match the day you saved the item instead of the message day', { default: false }),
  channel: Flag.string('Only this conversation: #name, DM person, or group-DM slug (exact match)', {
    optional: true,
  }),
  sortTime: Flag.bool('One chronological list instead of grouping by conversation', { default: false }),
  capture: Flag.string('Capture items into the notebook: "all" or 1-based indexes like "1,3"', { optional: true }),
  captureBatch: Flag.number('Capture the first N matched items (repeat for the next N)', { short: 'n' }),
  open: Flag.stringOrBool(
    'Open items in Slack: bare --open opens what a capture run lands; --open=3 alone opens the first 3 matched read-only',
    { bareValue: 'landed' },
  ),
  limit: Flag.number('Max saved items to fetch from Slack', { default: 600 }),
}

type Params = InferParams<typeof params>

/** Shell-quote a value for the re-run hint — DM names carry spaces; plain names stay bare. */
const quoteArg = (value: string): string => (/^[\w.#-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)

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
  /** Links whose saved message is gone from Slack (deleted) — skipped, still in the queue */
  skipped: string[]
  /** Items opened in Slack via --open */
  opened: number
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
      'them instead), grouped by conversation — channels first, then people,',
      'alphabetical, each under its own header; --sort-time flattens back to',
      'one chronological list. Numbering follows the printed order either way,',
      'so --capture indexes always mean what you see. --channel narrows the',
      'day to one conversation, by exact name: #name or name for channels, the',
      'person for DMs, the raw slug for group DMs — the capture and open flags',
      'then act on that scoped list. Clickable links and --open use the',
      'app.slack.com browser client, skipping the "open the app" page; piped',
      'output keeps workspace permalinks. Listing is read-only.',
      '',
      'With --capture, each picked item runs through slack:follow:message: live',
      'threads are captured AND followed for new replies; threads quiet past',
      'the follow expiry window archive without a follow. Summary, auto-tags,',
      'and auto-rel apply either way, the item is then marked complete in',
      'Slack — the Later list stays the ledger of what remains — and captured',
      'files open in the editor when done.',
      '',
      '--capture-batch N takes only the first N matched items and reports what',
      'is left. Completed items drop off the list, so the same command run again',
      'takes the next N — capture a batch, check its tags, run it again.',
      '',
      'Bare --open on a capture run also opens each item the run lands in',
      'Slack — captured threads and already-captured skips alike, since those',
      'are the ones most likely still waiting on a reply. --open=N alone opens',
      'the first N matched read-only: nothing completes, so the items keep',
      'their saved-for-later badge in Slack.',
    ],
    usage: [
      'sky slack:later:day',
      'sky slack:later:day --capture all',
      'sky slack:later:day --channel atlas --capture all',
      'sky slack:later:day --sort-time',
      'sky slack:later:day 2026-06-03 --capture-batch 10',
      'sky slack:later:day 2026-06-03 --capture 1,3 --open',
      'sky slack:later:day 2026-06-03 --open=3',
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

    const channelQuery = args.channel === undefined ? undefined : normalizeChannelQuery(args.channel)
    if (channelQuery === '') {
      return CommandResult.fail(`Invalid --channel: ${args.channel} (use a conversation name like #atlas)`)
    }

    // Both name what to capture — pick one rather than guess a precedence
    if (args.capture !== undefined && args.captureBatch !== undefined) {
      return CommandResult.fail('Use --capture or --capture-batch, not both')
    }
    if (args.captureBatch !== undefined && (!Number.isInteger(args.captureBatch) || args.captureBatch < 1)) {
      return CommandResult.fail(
        `Invalid --capture-batch: ${args.captureBatch} (use a whole number of items, 1 or more)`,
      )
    }
    // --open wears two hats: bare with a capture run (open what lands), or
    // --open=N alone (open the first N read-only — they keep their Later badge)
    const capturing = args.capture !== undefined || args.captureBatch !== undefined
    const openBare = args.open === 'landed'
    let openCount: number | undefined
    if (args.open !== undefined && !openBare) {
      openCount = Number(args.open)
      if (!Number.isInteger(openCount) || openCount < 1) {
        return CommandResult.fail(`Invalid --open: ${args.open} (bare --open with a capture run, or --open=N alone)`)
      }
      if (capturing) {
        return CommandResult.fail('With a capture run, --open takes no count — bare --open opens what the run lands')
      }
    }
    if (openBare && !capturing) {
      return CommandResult.fail('Bare --open needs a capture run — use --open=N to open the first N without capturing')
    }

    if (!SLACK_WORKSPACE) {
      return CommandResult.fail(
        'No slack.workspace configured — permalinks need it. Set it via sky init or config.jsonc.',
      )
    }
    const workspace = SLACK_WORKSPACE.replace(/\/$/, '')

    const fetched = await fetchInProgressLater(args.limit)
    if ('error' in fetched) return CommandResult.fail(fetched.error)
    const { list } = fetched

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
      const link = laterItemLink(workspace, item)
      dayItems.push({ item, messageDay, savedDay, timeLabel, link })
    }

    const onDay = dayItems
      .filter((d) => (args.savedOn ? d.savedDay === dayStr : d.messageDay === dayStr))
      .sort((a, b) => (a.item.ts < b.item.ts ? -1 : 1))
    const matched = channelQuery === undefined ? onDay : onDay.filter((d) => laterChannelMatches(d.item, channelQuery))

    output.log(
      `Saved-later items for ${dayStr} (${args.savedOn ? 'saved that day' : 'message day'}` +
        (channelQuery === undefined ? '' : `, only ${channelQuery}`) +
        `): ${colors.bold(String(matched.length))} matched of ${list.items.length} fetched` +
        (list.counts.in_progress !== undefined ? colors.dim(` (${list.counts.in_progress} in progress total)`) : ''),
    )
    // A scoped run that matches nothing usually means a name typo — show what
    // the day actually has, in the form --channel matches
    if (channelQuery !== undefined && matched.length === 0 && onDay.length > 0) {
      const present = [...new Set(onDay.flatMap((d) => laterMatchableName(d.item) ?? []))].sort()
      output.log(colors.dim(`No later items there that day — present: ${present.join(', ')}`))
    }
    const stale = resolveStaleChannels(list.items)
    await backfillMissingMessages(matched)
    const [, groupMembers] = await Promise.all([
      resolveRowMentions(matched, workspace),
      resolveRowMemberNames(matched, workspace),
    ])

    // Default order groups by conversation (channels first, then people,
    // alphabetical; time within each) — one context switch per conversation,
    // and batch captures eat the queue a conversation at a time. Indexes are
    // assigned after the sort, so --capture picks exactly what's printed.
    if (!args.sortTime) {
      const keys = new Map<string, string>()
      for (const d of matched) {
        if (!keys.has(d.item.channel_id)) {
          keys.set(d.item.channel_id, laterGroupKey(d.item, groupMembers.get(d.item.channel_id)))
        }
      }
      matched.sort((a, b) => {
        const keyA = keys.get(a.item.channel_id) ?? ''
        const keyB = keys.get(b.item.channel_id) ?? ''
        if (keyA !== keyB) return keyA < keyB ? -1 : 1
        return a.item.ts < b.item.ts ? -1 : 1
      })
    }

    let headerGroup: string | undefined
    for (const [index, d] of matched.entries()) {
      if (!args.sortTime && d.item.channel_id !== headerGroup) {
        headerGroup = d.item.channel_id
        output.log('')
        output.log(`  ${renderLaterLabel(d.item, { stale, groupMembers })}`)
      }
      const rowContext = args.sortTime
        ? { stale, groupMembers }
        : { stale, groupMembers, omitLabel: true, indent: '    ' }
      for (const line of renderLaterRow({ ...d, timeLabel: d.timeLabel.slice(11) }, index, rowContext)) {
        output.log(line)
      }
    }

    // Read-only triage: open the first N matched in Slack, capture nothing —
    // items stay saved, so Slack's Later badge still marks them
    if (openCount !== undefined) {
      const toOpen = matched
        .filter((d) => laterCapturable(d.item))
        .slice(0, openCount)
        .map((d) => ({ ...d, timeLabel: d.timeLabel.slice(11) }))
      await openInSlack(toOpen, output, { groupMembers })
      return CommandResult.success({
        day: dayStr,
        fetched: list.items.length,
        inProgressTotal: list.counts.in_progress,
        matched: matched.length,
        captured: [],
        completed: 0,
        skipped: [],
        opened: toOpen.length,
        remaining: matched.length,
        failures: [],
      })
    }

    if (matched.length === 0 || (!args.capture && args.captureBatch === undefined)) {
      if (matched.length > 0) {
        const scope = channelQuery === undefined ? '' : ` --channel ${quoteArg(channelQuery)}`
        output.log('')
        output.log(
          colors.dim(
            `Re-run with: sky slack:later:day ${dayStr}${scope} --capture-batch 10   (or --capture all, --capture 1,3)`,
          ),
        )
      }
      return CommandResult.success({
        day: dayStr,
        fetched: list.items.length,
        inProgressTotal: list.counts.in_progress,
        matched: matched.length,
        captured: [],
        completed: 0,
        skipped: [],
        opened: 0,
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
      // Dead-id items would only fail the fetch — batches skip them (explicit
      // --capture indexes stay verbatim: the listing marks those rows stale)
      const capturable = matched.filter((d) => laterCapturable(d.item))
      picked = capturable.slice(0, args.captureBatch)
      if (capturable.length < matched.length) {
        output.log('')
        output.log(
          colors.dim(
            `Skipping ${matched.length - capturable.length} unreachable (stale channel id) — complete those in Slack directly`,
          ),
        )
      }
      if (picked.length < capturable.length) {
        output.log('')
        output.log(`Capturing the first ${picked.length} of ${capturable.length} capturable`)
      }
    }

    const outcome = await captureLaterItems(
      picked.map((d) => ({ ...d, timeLabel: d.timeLabel.slice(11) })),
      { tasks, output },
    )

    // Completed items leave the in-progress list, so what's left is what the
    // next run of this same command will pick up
    const remaining = matched.length - outcome.completed

    output.log('')
    output.log(`Captured ${outcome.captured.length}/${picked.length}; completed in Slack: ${outcome.completed}`)
    for (const failure of outcome.failures) output.log(colors.red(`  ! ${failure}`))
    for (const link of outcome.skipped) output.log(colors.dim(`  – ${link}: not found in Slack (deleted) — skipped`))
    if (remaining > 0) {
      const next =
        args.captureBatch === undefined ? '' : ` — re-run for the next ${Math.min(args.captureBatch, remaining)}`
      output.log(colors.dim(`${remaining} left for ${dayStr}${next}`))
    }

    if (outcome.openTargets.length > 0) {
      openEditor(outcome.openTargets.map((file) => ({ file })))
      await delay(500)
    }
    // Slack last, so the user lands there ready to respond
    if (openBare) await openInSlack(outcome.openRows, output, { groupMembers })

    return CommandResult.success({
      day: dayStr,
      fetched: list.items.length,
      inProgressTotal: list.counts.in_progress,
      matched: matched.length,
      captured: outcome.captured,
      completed: outcome.completed,
      skipped: outcome.skipped,
      opened: openBare ? outcome.openRows.length : 0,
      remaining,
      failures: outcome.failures,
    })
  }
}
