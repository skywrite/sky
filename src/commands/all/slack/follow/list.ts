import colors from 'picocolors'
import ms from 'ms'
import { exists } from '#shared/fs/mod.ts'
import { DIR_HEARTBEAT_FOLLOW } from '#config'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  all: Flag.boolean('Show all follows including paused (default: active only)', {
    short: 'a',
    default: false,
  }),
}

type Params = InferParams<typeof params>

interface FollowInfo {
  fileName: string
  source: string
  summary: string
  interval: string
  ago: string
  overdue: boolean
  lastMsg: string
  messages: number
  status: string
}

type Result = { follows: FollowInfo[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:list': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class SlackFollowListTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:list',
    description: 'List active follows.',
    descriptionLong: [
      'Lists follows from the follow directory.',
      'By default shows only active follows. Use --all to include paused.',
    ],
    usage: [
      'sky slack:follow:list          # List active follows',
      'sky slack:follow:list --all    # List all follows including paused',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { all } = args

    if (!(await exists(DIR_HEARTBEAT_FOLLOW))) {
      output.log(`No follow directory found at ${DIR_HEARTBEAT_FOLLOW}`)
      return CommandResult.success({ follows: [] })
    }

    const registry = await SlackFollowRegistry.build()

    if (registry.errors.length > 0) {
      for (const err of registry.errors) {
        output.log(colors.yellow(`Warning: ${err.path}: ${err.error}`))
      }
    }

    const entries = all ? registry.getAll() : registry.getActive()

    // Sort by last message date descending (most recent first, no messages last)
    entries.sort((a, b) => {
      const aLast = a.follow.messages?.at(-1)?.date ?? ''
      const bLast = b.follow.messages?.at(-1)?.date ?? ''
      return bLast.localeCompare(aLast)
    })

    const now = fetchNowSync()
    const nowMs = now.plainDateTime.toTimeDateValue().getTime()
    const today = now.plainDateTime.plainDate

    const follows: FollowInfo[] = entries.map((e) => {
      const { follow } = e
      let ago = '-'
      let overdue = false

      if (follow.lastChecked) {
        const elapsedMs = nowMs - follow.lastChecked.toTimeDateValue().getTime()
        ago = humanDuration(elapsedMs)
        const intervalMs = ms(follow.checkInterval as ms.StringValue)
        if (intervalMs !== undefined && elapsedMs >= intervalMs) overdue = true
      }

      const lastMsgDate = follow.messages?.at(-1)?.date
      const lastMsg = lastMsgDate ? humanDays(today, PlainDate.fromString(lastMsgDate)) : '-'

      return {
        fileName: e.fileName,
        source: follow.source ?? '',
        summary: follow.summary ?? '',
        interval: follow.checkInterval ?? '',
        ago,
        overdue,
        lastMsg,
        messages: follow.messages?.length ?? 0,
        status: follow.status ?? 'active',
      }
    })

    if (follows.length === 0) {
      output.log(all ? 'No follows found.' : 'No active follows found.')
      return CommandResult.success({ follows: [] })
    }

    // Calculate column widths
    const cols = {
      source: 'Source'.length,
      summary: 'Summary'.length,
      interval: 'Intv'.length,
      ago: 'Ago'.length,
      lastMsg: 'Last Msg'.length,
      messages: 'Msgs'.length,
      status: 'Status'.length,
    }

    for (const f of follows) {
      cols.source = Math.max(cols.source, f.source.length)
      cols.summary = Math.max(cols.summary, f.summary.length)
      cols.interval = Math.max(cols.interval, f.interval.length)
      cols.ago = Math.max(cols.ago, f.ago.length)
      cols.lastMsg = Math.max(cols.lastMsg, f.lastMsg.length)
      cols.messages = Math.max(cols.messages, String(f.messages).length)
      cols.status = Math.max(cols.status, f.status.length)
    }

    const header = [
      'Source'.padEnd(cols.source),
      'Summary'.padEnd(cols.summary),
      'Intv'.padEnd(cols.interval),
      'Ago'.padEnd(cols.ago),
      'Last Msg'.padEnd(cols.lastMsg),
      'Msgs'.padEnd(cols.messages),
      'Status'.padEnd(cols.status),
    ].join('  ')

    const separator = [
      '-'.repeat(cols.source),
      '-'.repeat(cols.summary),
      '-'.repeat(cols.interval),
      '-'.repeat(cols.ago),
      '-'.repeat(cols.lastMsg),
      '-'.repeat(cols.messages),
      '-'.repeat(cols.status),
    ].join('  ')

    output.log(header)
    output.log(separator)

    for (const f of follows) {
      const summary = f.summary
      const agoStr = f.overdue ? colors.red(f.ago.padEnd(cols.ago)) : f.ago.padEnd(cols.ago)
      const statusStr = f.status === 'paused' ? colors.dim(f.status.padEnd(cols.status)) : f.status.padEnd(cols.status)
      const row = [
        f.source.padEnd(cols.source),
        summary.padEnd(cols.summary),
        f.interval.padEnd(cols.interval),
        agoStr,
        f.lastMsg.padEnd(cols.lastMsg),
        String(f.messages).padEnd(cols.messages),
        statusStr,
      ].join('  ')
      output.log(row)
    }

    return CommandResult.success({ follows })
  }
}

function humanDays(today: PlainDate, date: PlainDate): string {
  const MS_PER_DAY = 86_400_000
  const days = Math.floor((today.toDate().getTime() - date.toDate().getTime()) / MS_PER_DAY)
  if (days <= 0) return 'today'
  if (days === 1) return '1d'
  return `${days}d`
}

function humanDuration(elapsedMs: number): string {
  const seconds = Math.floor(elapsedMs / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d${remainingHours}h` : `${days}d`
}
