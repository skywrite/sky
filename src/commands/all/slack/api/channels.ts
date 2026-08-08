import { WebClient } from '@slack/web-api'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  token: Flag.string('Slack user token (or set SLACK_USER_TOKEN env var)', { short: 't' }),
  limit: Flag.number('How many channels to show (default 25)', { short: 'l', default: 25 }),
  all: Flag.bool('Show all channels (no limit)'),
  private: Flag.bool('Only show private channels'),
  public: Flag.bool('Only show public channels'),
  debug: Flag.bool('Show debug output'),
}

type Params = InferParams<typeof params>

interface ChannelInfo {
  name: string
  type: 'public' | 'private'
  purpose: string
  updated: number
}

type Result = { channels: ChannelInfo[]; total: number }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:api:channels': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class SlackChannelsTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:api:channels',
    description: 'List active Slack channels sorted by recent activity.',
    descriptionLong: [
      'Fetches all joined channels and sorts by most recently updated.',
      'Uses the users.conversations API — no per-channel calls needed.',
    ],
    usage: [
      'sky slack:channels                    # Top 25 most active channels',
      'sky slack:channels --limit 10         # Top 10',
      'sky slack:channels --all              # Show all channels',
      'sky slack:channels --private          # Only private channels',
      'sky slack:channels --public           # Only public channels',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, env } = context
    const token = args.token || env.SLACK_USER_TOKEN
    const showAll = args.all ?? false
    const limit = showAll ? Infinity : (args.limit ?? 25)
    const onlyPrivate = args.private ?? false
    const onlyPublic = args.public ?? false
    const debug = args.debug ?? false

    if (!token) {
      return CommandResult.fail(
        'No Slack token provided. Use --token flag or set SLACK_USER_TOKEN environment variable.',
      )
    }

    if (onlyPrivate && onlyPublic) {
      return CommandResult.fail('Cannot use both --private and --public at the same time.')
    }

    try {
      const client = new WebClient(token)

      // Build types filter based on flags
      const types: string[] = []
      if (!onlyPrivate) types.push('public_channel')
      if (!onlyPublic) types.push('private_channel')

      if (debug) output.log(`Fetching channels (types: ${types.join(', ')})...`)

      // Paginate through all conversations
      type Channel = NonNullable<Awaited<ReturnType<typeof client.users.conversations>>['channels']>[number]

      const allChannels: Channel[] = []
      let cursor: string | undefined
      let page = 0

      do {
        page++
        const response = await client.users.conversations({
          types: types.join(','),
          exclude_archived: true,
          limit: 200,
          cursor,
        })
        allChannels.push(...(response.channels || []))
        cursor = response.response_metadata?.next_cursor
        if (debug && page > 1) output.log(`  Page ${page}: ${response.channels?.length || 0}`)
      } while (cursor)

      if (debug) output.log(`Fetched ${allChannels.length} channels total`)

      // Sort by updated timestamp (most recent first)
      // Note: `updated` from users.conversations is in milliseconds
      allChannels.sort((a, b) => {
        const aUpdated = ((a as Record<string, unknown>).updated as number) || 0
        const bUpdated = ((b as Record<string, unknown>).updated as number) || 0
        return bUpdated - aUpdated
      })

      // Apply limit
      const display = allChannels.slice(0, limit === Infinity ? undefined : limit)

      // Build channel info
      const channels: ChannelInfo[] = display.map((ch) => {
        const updated = ((ch as Record<string, unknown>).updated as number) || 0
        return {
          name: ch.name || ch.id || 'unknown',
          type: ch.is_private ? ('private' as const) : ('public' as const),
          purpose: ch.purpose?.value || '',
          updated,
        }
      })

      // Format table
      const cols = {
        updated: 'Updated'.length,
        type: 'Type'.length,
        name: 'Name'.length,
        purpose: 'Purpose'.length,
      }

      for (const ch of channels) {
        const updatedStr = ch.updated > 0 ? formatTimestamp(ch.updated) : '-'
        const typeStr = ch.type === 'private' ? 'priv' : 'pub'
        const purposeStr = ch.purpose.slice(0, 50)

        cols.updated = Math.max(cols.updated, updatedStr.length)
        cols.type = Math.max(cols.type, typeStr.length)
        cols.name = Math.max(cols.name, ch.name.length)
        cols.purpose = Math.max(cols.purpose, purposeStr.length)
      }

      // Cap purpose column
      cols.purpose = Math.min(cols.purpose, 50)

      // Header
      const header = [
        'Updated'.padEnd(cols.updated),
        'Type'.padEnd(cols.type),
        'Name'.padEnd(cols.name),
        'Purpose'.padEnd(cols.purpose),
      ].join('  ')

      const separator = [
        '-'.repeat(cols.updated),
        '-'.repeat(cols.type),
        '-'.repeat(cols.name),
        '-'.repeat(cols.purpose),
      ].join('  ')

      output.log('')
      output.log(`Showing ${channels.length} of ${allChannels.length} channels (sorted by recent activity)`)
      output.log('')
      output.log(header)
      output.log(separator)

      for (const ch of channels) {
        const updatedStr = ch.updated > 0 ? formatTimestamp(ch.updated) : '-'
        const typeStr = ch.type === 'private' ? 'priv' : 'pub'
        const purposeStr = ch.purpose.slice(0, 50)

        const row = [
          updatedStr.padEnd(cols.updated),
          typeStr.padEnd(cols.type),
          ch.name.padEnd(cols.name),
          purposeStr.padEnd(cols.purpose),
        ].join('  ')
        output.log(row)
      }

      return CommandResult.success({ channels, total: allChannels.length })
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to fetch Slack channels')
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Format a millisecond timestamp into a relative/absolute label */
function formatTimestamp(ms: number): string {
  const date = new Date(ms)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
