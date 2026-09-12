import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
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

/** Default preview size; --all shows every fetched matching item. */
const MAX_LISTED = 20

const params = {
  channel: Flag.string(
    'Filter conversations by #name, DM person, or group-DM slug; supports * wildcards (quote patterns)',
    {
      optional: true,
    },
  ),
  sort: Flag.string('Sort by: time (oldest first) or channel (group by conversation)', { default: 'time' }),
  all: Flag.bool('Show every fetched matching item (still subject to --limit)', { default: false }),
  captureAll: Flag.bool('Capture every fetched matching item (still subject to --limit)', { default: false }),
  captureBatch: Flag.number('Capture the first N matched items in the selected sort order (repeat for the next N)', {
    short: 'n',
  }),
  open: Flag.stringOrBool(
    'Open items in Slack: bare --open opens what a capture run lands; --open=3 alone opens the first 3 matched read-only',
    { bareValue: 'landed' },
  ),
  limit: Flag.number('Max saved items to fetch from Slack', { default: 600 }),
  includeUnavailable: Flag.bool('Show saved items whose channels are unavailable', { default: false }),
}

type Params = InferParams<typeof params>

/** Shell-quote names in re-run hints, including DM names with spaces or apostrophes. */
const quoteArg = (value: string): string => (/^[\w.-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)

type Result = {
  fetched: number
  inProgressTotal?: number
  matched: number
  captured: string[]
  completed: number
  /** Links whose saved message is gone from Slack (deleted) — skipped, still in the queue */
  skipped: string[]
  /** Items opened in Slack via --open */
  opened: number
  /** Items still in progress; with --channel, counts only matches in the fetched queue */
  remaining: number
  failures: string[]
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:later': { params: Params; result: Result }
  }
}

export default class SlackLaterTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:later',
    description: "List Slack's saved-for-later queue (oldest-first by default), and optionally capture items.",
    descriptionLong: [
      "Shows the head of Slack's Later tab — the first 20 available in-progress items,",
      'oldest origin message first by default (--sort time), whatever the day.',
      '--all shows every fetched matching item; --limit controls how many items',
      'are fetched from Slack (default 600).',
      '--sort channel groups by conversation: channels first, then people,',
      'alphabetically, with oldest messages first within each conversation.',
      'Listing, batch capture, and open all follow the selected sort order;',
      'grouping is applied before the listing limit. The header line carries',
      'the full queue count. Listing is read-only; slack:later:day is the',
      'day-scoped view of the same queue.',
      'Unavailable channels are hidden by default; --include-unavailable shows',
      'them too, within the same listing limit. They remain in the queue.',
      '--channel narrows listing, capture, and open by conversation name: #name',
      'or name for channels, the person for DMs, or the raw group-DM slug.',
      'Matching ignores case and is exact unless you use * for any sequence of',
      "characters. Quote patterns, e.g. --channel '#atlas-*', so the shell",
      'passes them through. Channel counts cover the fetched items (--limit).',
      '',
      '--capture-batch N captures the first N through slack:follow:message: live',
      'threads are captured AND followed for new replies; threads quiet past',
      'the follow expiry window archive without a follow. Summary, auto-tags,',
      'and auto-rel apply either way, each item is then marked complete in',
      'Slack, and captured files open in the editor when done.',
      '--capture-all captures every available matching item in this fetch,',
      'in the selected sort order. Use --limit to increase the fetch size.',
      '',
      'Bare --open on a capture run also opens each item the run lands in',
      'Slack — captured threads and already-captured skips alike, since those',
      'are the ones most likely still waiting on a reply. --open=N alone opens',
      'the first N read-only before any capturing: nothing completes, so the',
      'items keep their saved-for-later badge in Slack.',
      '',
      'Completed items drop off the list, so the same command run again takes',
      'the next N — drain the backlog a batch at a time, checking tags between',
      'runs, or use --capture-all to capture every fetched match at once.',
    ],
    usage: [
      'sky slack:later',
      'sky slack:later --all',
      'sky slack:later --sort channel',
      'sky slack:later --sort channel --all',
      'sky slack:later --sort channel --capture-batch 5',
      'sky slack:later --channel atlas',
      "sky slack:later --channel '#atlas-*' --all",
      "sky slack:later --channel '#atlas-*' --capture-batch 5",
      "sky slack:later --channel '#atlas-*' --capture-all",
      'sky slack:later --channel atlas --capture-batch 5',
      'sky slack:later --include-unavailable',
      'sky slack:later --capture-batch 5',
      'sky slack:later -n 5 --open',
      'sky slack:later --open=3',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context

    const channelQuery = args.channel === undefined ? undefined : normalizeChannelQuery(args.channel)
    if (channelQuery === '') {
      return CommandResult.fail(`Invalid --channel: ${args.channel} (use a conversation name like #atlas)`)
    }
    const sort = args.sort ?? 'time'
    if (sort !== 'time' && sort !== 'channel') {
      return CommandResult.fail(`Invalid --sort: ${sort} (use "time" or "channel")`)
    }
    const sortByChannel = sort === 'channel'

    if (args.captureAll && args.captureBatch !== undefined) {
      return CommandResult.fail('Use --capture-all or --capture-batch, not both')
    }
    if (args.captureBatch !== undefined && (!Number.isInteger(args.captureBatch) || args.captureBatch < 1)) {
      return CommandResult.fail(
        `Invalid --capture-batch: ${args.captureBatch} (use a whole number of items, 1 or more)`,
      )
    }
    // --open wears two hats: bare with a capture run (open what lands), or
    // --open=N alone (open the first N read-only — they keep their Later badge)
    const capturing = args.captureAll || args.captureBatch !== undefined
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

    if (!context.config.SLACK_WORKSPACE) {
      return CommandResult.fail(
        'No slack.workspace configured — permalinks need it. Set it via sky init or config.jsonc.',
      )
    }
    const workspace = context.config.SLACK_WORKSPACE.replace(/\/$/, '')

    const fetched = await fetchInProgressLater(args.limit)
    if ('error' in fetched) return CommandResult.fail(fetched.error)
    const { list } = fetched

    // Start chronologically; channel grouping retains time order within each conversation.
    const queue = list.items
      .filter((item) => channelQuery === undefined || laterChannelMatches(item, channelQuery))
      .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
      .map((item) => ({
        item,
        timeLabel: formatSlackTimestamp(item.ts, systemNow.timezone),
        link: laterItemLink(workspace, item),
      }))
    // Slack reports only a global total; a channel's count comes from this fetch.
    const queueTotal = channelQuery === undefined ? (list.counts.in_progress ?? queue.length) : queue.length
    const queueLabel = channelQuery === undefined ? 'in the queue' : `for ${channelQuery}`

    output.log(
      `Saved-later queue${channelQuery === undefined ? '' : ` (only ${channelQuery})`}: ` +
        colors.bold(String(queue.length)) +
        (channelQuery === undefined ? ' fetched' : ` matched of ${list.items.length} fetched`) +
        (list.counts.in_progress !== undefined ? colors.dim(` (${list.counts.in_progress} in progress total)`) : ''),
    )
    if (channelQuery !== undefined && queue.length === 0 && list.items.length > 0) {
      const present = [...new Set(list.items.flatMap((item) => laterMatchableName(item) ?? []))].sort()
      output.log(colors.dim(`No later items there in this fetch — present: ${present.join(', ') || '(none named)'}`))
    }
    // Resolve group-DM display names before sorting the full queue, so the
    // preview and every action agree on which conversations come first.
    const sortedGroupMembers = sortByChannel ? await resolveRowMemberNames(queue, workspace) : undefined
    if (sortByChannel) {
      const keys = new Map<string, string>()
      for (const { item } of queue) {
        if (!keys.has(item.channel_id)) {
          keys.set(item.channel_id, laterGroupKey(item, sortedGroupMembers?.get(item.channel_id)))
        }
      }
      queue.sort((a, b) => {
        const keyA = keys.get(a.item.channel_id) ?? ''
        const keyB = keys.get(b.item.channel_id) ?? ''
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0
      })
    }
    // Show enough to cover what a capture or open run is about to take
    const stale = resolveStaleChannels(list.items)
    const visible = args.includeUnavailable ? queue : queue.filter((d) => laterCapturable(d.item))
    const hidden = queue.length - visible.length
    if (hidden > 0) {
      output.log(colors.dim(`  ${hidden} unavailable-channel items hidden — use --include-unavailable to show them`))
    }
    const shown =
      args.all || args.captureAll
        ? visible
        : visible.slice(0, Math.max(MAX_LISTED, args.captureBatch ?? 0, openCount ?? 0))
    await backfillMissingMessages(shown)
    const [, groupMembers] = await Promise.all([
      resolveRowMentions(shown, workspace),
      sortedGroupMembers ?? resolveRowMemberNames(shown, workspace),
    ])
    let headerGroup: string | undefined
    for (const [index, d] of shown.entries()) {
      if (sortByChannel && d.item.channel_id !== headerGroup) {
        headerGroup = d.item.channel_id
        output.log('')
        output.log(`  ${renderLaterLabel(d.item, { stale, groupMembers })}`)
      }
      const rowContext = sortByChannel
        ? { stale, groupMembers, omitLabel: true, indent: '    ' }
        : { stale, groupMembers }
      for (const line of renderLaterRow(d, index, rowContext)) output.log(line)
    }
    if (shown.length < visible.length) {
      output.log(colors.dim(`  …and ${visible.length - shown.length} more — use --all to show every fetched match`))
    }

    // Read-only triage: open the first N capturable in Slack, capture nothing —
    // items stay saved, so Slack's Later badge still marks them
    if (openCount !== undefined) {
      const toOpen = queue.filter((d) => laterCapturable(d.item)).slice(0, openCount)
      await openInSlack(toOpen, output, { groupMembers })
      return CommandResult.success({
        fetched: list.items.length,
        inProgressTotal: list.counts.in_progress,
        matched: queue.length,
        captured: [],
        completed: 0,
        skipped: [],
        opened: toOpen.length,
        remaining: queueTotal,
        failures: [],
      })
    }

    if (queue.length === 0 || !capturing) {
      if (queue.some((d) => laterCapturable(d.item))) {
        const scope = channelQuery === undefined ? '' : ` --channel ${quoteArg(channelQuery)}`
        const order = sortByChannel ? ' --sort channel' : ''
        const hint = sortByChannel ? 'captures the first 5 in this order' : 'captures the 5 oldest'
        output.log('')
        output.log(
          colors.dim(`Re-run with: sky slack:later${scope}${order} --capture-batch 5   (${hint}; or --capture-all)`),
        )
      }
      return CommandResult.success({
        fetched: list.items.length,
        inProgressTotal: list.counts.in_progress,
        matched: queue.length,
        captured: [],
        completed: 0,
        skipped: [],
        opened: 0,
        remaining: queueTotal,
        failures: [],
      })
    }

    // Dead-id items would only fail the fetch, even when included in the listing
    const capturable = queue.filter((d) => laterCapturable(d.item))
    const picked = args.captureAll ? capturable : capturable.slice(0, args.captureBatch)
    if (capturable.length < queue.length) {
      output.log('')
      output.log(
        colors.dim(
          `Skipping ${queue.length - capturable.length} unreachable (stale channel id) — complete those in Slack directly`,
        ),
      )
    }
    if (picked.length < capturable.length) {
      output.log('')
      const selection = sortByChannel ? `first ${picked.length}` : `${picked.length} oldest`
      output.log(`Capturing the ${selection} of ${capturable.length} capturable`)
    }

    const outcome = await captureLaterItems(picked, { tasks, output })

    const remaining = queueTotal - outcome.completed

    output.log('')
    output.log(`Captured ${outcome.captured.length}/${picked.length}; completed in Slack: ${outcome.completed}`)
    for (const failure of outcome.failures) output.log(colors.red(`  ! ${failure}`))
    for (const link of outcome.skipped) output.log(colors.dim(`  – ${link}: not found in Slack (deleted) — skipped`))
    if (remaining > 0) {
      const next =
        args.captureBatch === undefined ? '' : ` — re-run for the next ${Math.min(args.captureBatch, remaining)}`
      output.log(colors.dim(`${remaining} left ${queueLabel}${next}`))
    }

    if (outcome.openTargets.length > 0) {
      openEditor(outcome.openTargets.map((file) => ({ file })))
      await delay(500)
    }
    // Slack last, so the user lands there ready to respond
    if (openBare) await openInSlack(outcome.openRows, output, { groupMembers })

    return CommandResult.success({
      fetched: list.items.length,
      inProgressTotal: list.counts.in_progress,
      matched: queue.length,
      captured: outcome.captured,
      completed: outcome.completed,
      skipped: outcome.skipped,
      opened: openBare ? outcome.openRows.length : 0,
      remaining,
      failures: outcome.failures,
    })
  }
}
