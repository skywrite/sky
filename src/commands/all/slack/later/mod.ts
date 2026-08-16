import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { formatSlackTimestamp } from '#commands/all/slack/lib/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { captureLaterItems } from './lib/capture.ts'
import {
  fetchInProgressLater,
  laterCapturable,
  laterItemLink,
  renderLaterRow,
  resolveStaleChannels,
} from './lib/list.ts'

/** The listing is a peek, not a dump — the header line carries the full count */
const MAX_LISTED = 20

const params = {
  captureBatch: Flag.number('Capture the oldest N items in the queue (repeat for the next N)', { short: 'n' }),
  limit: Flag.number('Max saved items to fetch from Slack', { default: 600 }),
}

type Params = InferParams<typeof params>

type Result = {
  fetched: number
  inProgressTotal?: number
  captured: string[]
  completed: number
  /** Items still in progress in the queue once this run is done */
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
    description: "List Slack's saved-for-later queue oldest-first, and optionally capture the oldest N.",
    descriptionLong: [
      "Shows the head of Slack's Later tab — the oldest 20 in-progress items,",
      'oldest origin message first, whatever the day; the header line carries',
      'the full queue count. Listing is read-only; slack:later:day is the',
      'day-scoped view of the same queue.',
      '',
      '--capture-batch N captures the N oldest through slack:follow:new: live',
      'threads are captured AND followed for new replies; threads quiet past',
      'the follow expiry window archive without a follow. Summary, auto-tags,',
      'and auto-rel apply either way, each item is then marked complete in',
      'Slack, and captured files open in the editor when done.',
      '',
      'Completed items drop off the list, so the same command run again takes',
      'the next N — drain the backlog a batch at a time, checking tags between',
      'runs. There is deliberately no --capture all here: the queue drains in',
      'batches, never in one sweep.',
    ],
    usage: ['sky slack:later', 'sky slack:later --capture-batch 5', 'sky slack:later -n 5'],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context

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

    const fetched = await fetchInProgressLater(args.limit)
    if ('error' in fetched) return CommandResult.fail(fetched.error)
    const { list } = fetched

    // Oldest origin message first, so batches drain the queue chronologically
    const queue = [...list.items]
      .sort((a, b) => (a.ts < b.ts ? -1 : 1))
      .map((item) => ({
        item,
        timeLabel: formatSlackTimestamp(item.ts, systemNow.timezone),
        link: laterItemLink(workspace, item),
      }))

    output.log(
      `Saved-later queue: ${colors.bold(String(queue.length))} fetched` +
        (list.counts.in_progress !== undefined ? colors.dim(` (${list.counts.in_progress} in progress total)`) : ''),
    )
    // Show enough to cover what a capture run is about to take
    const stale = resolveStaleChannels(list.items)
    const shown = queue.slice(0, Math.max(MAX_LISTED, args.captureBatch ?? 0))
    for (const [index, d] of shown.entries()) {
      for (const line of renderLaterRow(d, index, { stale })) output.log(line)
    }
    if (shown.length < queue.length) output.log(colors.dim(`  …and ${queue.length - shown.length} more`))

    if (queue.length === 0 || args.captureBatch === undefined) {
      if (queue.length > 0) {
        output.log('')
        output.log(colors.dim('Re-run with: sky slack:later --capture-batch 5   (captures the 5 oldest)'))
      }
      return CommandResult.success({
        fetched: list.items.length,
        inProgressTotal: list.counts.in_progress,
        captured: [],
        completed: 0,
        remaining: list.counts.in_progress ?? queue.length,
        failures: [],
      })
    }

    // Dead-id items would only fail the fetch — leave them listed, not picked
    const capturable = queue.filter((d) => laterCapturable(d.item))
    const picked = capturable.slice(0, args.captureBatch)
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
      output.log(`Capturing the ${picked.length} oldest of ${capturable.length} capturable`)
    }

    const outcome = await captureLaterItems(
      picked.map((d) => d.link),
      { tasks, output },
    )

    // Completed items leave the in-progress list; the Slack-reported total is
    // the true queue size when it exceeds what this run fetched
    const remaining = (list.counts.in_progress ?? queue.length) - outcome.completed

    output.log('')
    output.log(`Captured ${outcome.captured.length}/${picked.length}; completed in Slack: ${outcome.completed}`)
    for (const failure of outcome.failures) output.log(colors.red(`  ! ${failure}`))
    if (remaining > 0) {
      output.log(
        colors.dim(`${remaining} left in the queue — re-run for the next ${Math.min(args.captureBatch, remaining)}`),
      )
    }

    if (outcome.openTargets.length > 0) {
      openEditor(outcome.openTargets.map((file) => ({ file })))
      await delay(500)
    }

    return CommandResult.success({
      fetched: list.items.length,
      inProgressTotal: list.counts.in_progress,
      captured: outcome.captured,
      completed: outcome.completed,
      remaining,
      failures: outcome.failures,
    })
  }
}
