import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { CommandResult } from '#commands/mod.ts'
import type { CommandArgs } from '#commands/mod.ts'
import { captureLaterItems, openInSlack, type LaterCaptureRow } from './capture.ts'
import { resolveLaterConversations } from './conversations.ts'
import {
  backfillMissingMessages,
  fetchSavedItems,
  laterCapturable,
  laterGroupKey,
  laterItemLink,
  renderLaterLabel,
  renderLaterRow,
  resolveRowMentions,
  resolveStaleChannels,
  type SavedView,
} from './list.ts'
import { parseConversationQuery, selectConversations } from './select.ts'

/** Default preview size; --all shows every fetched matching item. */
export const MAX_LISTED = 20

export type PileSort = 'time' | 'channel' | 'due'

/** The flags slack:saved and slack:todos share; only to-dos take --due-within. */
export type PileArgs = {
  channel?: string
  sort?: string
  all: boolean
  captureAll: boolean
  captureBatch?: number
  open?: string
  limit: number
  includeUnavailable: boolean
  dueWithin?: string
}

export type PileResult = {
  fetched: number
  /** Items in the pile as Slack counts it; with --channel, only matches in the fetched queue */
  pileTotal?: number
  matched: number
  captured: string[]
  completed: number
  /** Links whose message is gone from Slack (deleted) — skipped, still in the pile */
  skipped: string[]
  /** Items opened in Slack via --open */
  opened: number
  /** Items still in the pile; with --channel, counts only matches in the fetched queue */
  remaining: number
  failures: string[]
}

/** What distinguishes the two pile commands: which pile, its name in output, and the natural order. */
export type PileSpec = {
  view: SavedView
  command: 'slack:saved' | 'slack:todos'
  /** The pile's name as Slack shows it, for headers and counts */
  noun: string
  /** The Slack message action that puts a message in this pile, for the empty state */
  slackAction: string
  defaultSort: PileSort
}

/** Shell-quote names in re-run hints, including DM names with spaces or apostrophes. */
const quoteArg = (value: string): string => (/^[\w.-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`)

const byTs = (a: { ts: string }, b: { ts: string }) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0)

/** What to say under an empty listing: how to put something in the pile, or why the fetch came back empty. */
function emptyPileNote(spec: PileSpec, args: PileArgs, pileCount: number | undefined): string {
  if (!pileCount) {
    return `Mark a message in Slack with "${spec.slackAction}" and it shows up here, ready to capture into your day.`
  }
  if (args.dueWithin !== undefined) {
    return `None of the ${pileCount} in ${spec.noun} is due within ${args.dueWithin} — drop --due-within to list them all.`
  }
  return `Slack counts ${pileCount} in ${spec.noun} that aren't messages (files, or to-dos typed by hand), which this command doesn't list.`
}

/**
 * List one of Slack's piles and optionally capture from it. slack:saved and
 * slack:todos differ only in which pile they ask agent-slack for, what they
 * call it, and the order they list it in; everything from --channel scoping
 * to the capture run is the same.
 */
export async function runPile(
  spec: PileSpec,
  args: PileArgs,
  deps: Pick<CommandArgs<PileArgs>, 'context' | 'tasks'> & {
    addReminder?: (row: LaterCaptureRow) => Promise<void>
  },
): Promise<CommandResult<PileResult>> {
  const { context, tasks } = deps
  const { output, systemNow } = context

  const query = args.channel === undefined ? undefined : parseConversationQuery(args.channel)
  if (args.channel !== undefined && !query) {
    return CommandResult.fail(
      `Invalid --channel: ${args.channel} (use #channel, @person, group participants, or an ID)`,
    )
  }
  const channelQuery = query?.text
  const sort = args.sort ?? spec.defaultSort
  if (sort !== 'time' && sort !== 'channel' && sort !== 'due') {
    return CommandResult.fail(`Invalid --sort: ${sort} (use "time", "channel", or "due")`)
  }
  const sortByChannel = sort === 'channel'
  const sortByDue = sort === 'due'

  if (args.captureAll && args.captureBatch !== undefined) {
    return CommandResult.fail('Use --capture-all or --capture-batch, not both')
  }
  if (args.captureBatch !== undefined && (!Number.isInteger(args.captureBatch) || args.captureBatch < 1)) {
    return CommandResult.fail(`Invalid --capture-batch: ${args.captureBatch} (use a whole number of items, 1 or more)`)
  }
  // --open wears two hats: bare with a capture run (open what lands), or
  // --open=N alone (open the first N read-only — they stay in the pile)
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

  const fetched = await fetchSavedItems(spec.view, args.limit, { dueWithin: args.dueWithin })
  if ('error' in fetched) return CommandResult.fail(fetched.error)
  const { list } = fetched
  const conversations = await resolveLaterConversations(list.items, workspace)
  const selection = selectConversations(conversations, query)
  if (selection.error) return CommandResult.fail(selection.error)

  // Start chronologically; channel grouping retains time order within each conversation.
  const nowSeconds = Math.floor(systemNow.epochMilliseconds / 1000)
  const queue = list.items
    .filter((item) => selection.ids.has(item.channel_id))
    .sort(byTs)
    .map((item) => ({
      item,
      timeLabel: formatSlackTimestamp(item.ts, systemNow.timezone),
      link: laterItemLink(workspace, item),
      dueLabel:
        item.date_due === undefined ? undefined : formatSlackTimestamp(String(item.date_due), systemNow.timezone),
      overdue: item.date_due !== undefined && item.date_due < nowSeconds,
    }))
  if (sortByDue) {
    // Soonest reminder first; items without one keep their time order at the end
    queue.sort((a, b) => (a.item.date_due ?? Infinity) - (b.item.date_due ?? Infinity) || byTs(a.item, b.item))
  }
  // Slack reports only pile-wide totals; a channel's count comes from this fetch.
  const pileCount = (spec.view === 'saved' ? list.counts.saved : list.counts.todo) ?? list.counts.in_progress
  const queueTotal = channelQuery === undefined ? (pileCount ?? queue.length) : queue.length
  const queueLabel = channelQuery === undefined ? `in ${spec.noun}` : `for ${channelQuery}`

  const overdueNote = spec.view === 'todo' && list.counts.overdue ? `, ${list.counts.overdue} overdue` : ''
  output.log(
    `${spec.noun}${channelQuery === undefined ? '' : ` (only ${channelQuery})`}: ` +
      colors.bold(String(queue.length)) +
      (channelQuery === undefined ? ' fetched' : ` matched of ${list.items.length} fetched`) +
      (pileCount !== undefined ? colors.dim(` (${pileCount} in ${spec.noun} total${overdueNote})`) : ''),
  )
  if (list.items.length === 0) {
    output.log(`  ${emptyPileNote(spec, args, pileCount)}`)
  } else {
    for (const line of selection.lines) output.log(line)
  }
  if (sortByChannel) {
    const keys = new Map<string, string>()
    for (const { item } of queue) {
      if (!keys.has(item.channel_id)) {
        keys.set(item.channel_id, laterGroupKey(item, undefined, conversations.get(item.channel_id)))
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
  await resolveRowMentions(shown, workspace)
  let headerGroup: string | undefined
  for (const [index, d] of shown.entries()) {
    if (sortByChannel && d.item.channel_id !== headerGroup) {
      headerGroup = d.item.channel_id
      output.log('')
      output.log(`  ${renderLaterLabel(d.item, { stale, conversations })}`)
    }
    const rowContext = sortByChannel
      ? { stale, conversations, omitLabel: true, indent: '    ' }
      : { stale, conversations }
    for (const line of renderLaterRow(d, index, rowContext)) output.log(line)
  }
  if (shown.length < visible.length) {
    output.log(colors.dim(`  …and ${visible.length - shown.length} more — use --all to show every fetched match`))
  }

  // Read-only triage: open the first N capturable in Slack, capture nothing —
  // items stay in the pile, so Slack still marks them
  if (openCount !== undefined) {
    const toOpen = queue.filter((d) => laterCapturable(d.item)).slice(0, openCount)
    await openInSlack(toOpen, output, { conversations })
    return CommandResult.success({
      fetched: list.items.length,
      pileTotal: pileCount,
      matched: queue.length,
      captured: [],
      completed: 0,
      skipped: [],
      opened: toOpen.length,
      remaining: queueTotal,
      failures: [],
    })
  }

  const orderWord = sortByChannel ? 'first' : sortByDue ? 'soonest due' : 'oldest'
  if (queue.length === 0 || !capturing) {
    if (queue.some((d) => laterCapturable(d.item))) {
      const scope = channelQuery === undefined ? '' : ` --channel ${quoteArg(channelQuery)}`
      const order = sort === spec.defaultSort ? '' : ` --sort ${sort}`
      const hint = sortByChannel ? 'captures the first 5 in this order' : `captures the 5 ${orderWord}`
      output.log('')
      output.log(
        colors.dim(`Re-run with: sky ${spec.command}${scope}${order} --capture-batch 5   (${hint}; or --capture-all)`),
      )
    }
    return CommandResult.success({
      fetched: list.items.length,
      pileTotal: pileCount,
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
    const selectionLabel = sortByChannel ? `first ${picked.length}` : `${picked.length} ${orderWord}`
    output.log(`Capturing the ${selectionLabel} of ${capturable.length} capturable`)
  }

  const outcome = await captureLaterItems(picked, { tasks, output, addReminder: deps.addReminder })

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
  if (openBare) await openInSlack(outcome.openRows, output, { conversations })

  return CommandResult.success({
    fetched: list.items.length,
    pileTotal: pileCount,
    matched: queue.length,
    captured: outcome.captured,
    completed: outcome.completed,
    skipped: outcome.skipped,
    opened: openBare ? outcome.openRows.length : 0,
    remaining,
    failures: outcome.failures,
  })
}
