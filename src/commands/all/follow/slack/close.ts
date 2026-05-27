import * as p from '@clack/prompts'
import ms from 'ms'
import { unlink } from 'node:fs/promises'
import { exists } from '#shared/fs/mod.ts'
import { DIR_HEARTBEAT_FOLLOW } from '#config'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  file: Arg.string('Follow file name (without .yaml extension)', { optional: true }),
  inactiveThan: Flag.string('Close all follows inactive for longer than duration (e.g. 7d, 2w)', {
    short: 'i',
  }),
  dryRun: Flag.boolean('Show what would be closed without deleting', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { closed: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'follow:slack:close': {
      params: Params
      result: Result
    }
  }
}

export default class FollowSlackCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'follow:slack:close',
    description: 'Close follows by deleting their files.',
    usage: [
      'sky follow:slack:close                                              # Pick from list',
      'sky follow:slack:close slack_core-four_Person-wants-weekly-meetings  # By name',
      'sky follow:slack:close --inactive-than 7d                           # Close inactive > 7 days',
      'sky follow:slack:close --inactive-than 7d --dry-run                 # Preview without deleting',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, inactiveThan, dryRun } = args

    if (!(await exists(DIR_HEARTBEAT_FOLLOW))) {
      return CommandResult.fail('No follow directory found.')
    }

    const registry = await SlackFollowRegistry.build()

    // Bulk close: --inactive-than
    if (inactiveThan) {
      const thresholdMs = ms(inactiveThan as ms.StringValue)
      if (thresholdMs === undefined) {
        return CommandResult.fail(`Invalid duration: ${inactiveThan}`)
      }

      const now = fetchNowSync().plainDateTime
      const nowMs = now.toTimeDateValue().getTime()
      const entries = registry.getActive()
      const stale = entries.filter((e) => {
        // Use last message date as primary staleness indicator (matches what follow:list shows)
        const lastMsgDate = e.follow.messages.at(-1)?.date
        if (lastMsgDate) {
          const msgMs = PlainDate.fromString(lastMsgDate).toDate().getTime()
          const todayMs = now.plainDate.toDate().getTime()
          return todayMs - msgMs >= thresholdMs
        }
        // No messages: fall back to lastActivity or followSince
        const anchor = e.follow.lastActivity ?? e.follow.followSince
        if (!anchor) return true
        return nowMs - anchor.toTimeDateValue().getTime() >= thresholdMs
      })

      if (stale.length === 0) {
        output.log(`No active follows inactive longer than ${inactiveThan}.`)
        return CommandResult.success({ closed: [] })
      }

      const closed: string[] = []
      for (const e of stale) {
        const label = dryRun ? '[dry-run] Would close' : 'Closed'
        output.log(`${label}: ${e.follow.summary} (${e.fileName})`)
        if (!dryRun) {
          await unlink(e.path)
        }
        closed.push(e.fileName)
      }

      output.log('')
      output.log(
        `${dryRun ? 'Would close' : 'Closed'} ${closed.length} follow(s) inactive longer than ${inactiveThan}.`,
      )
      return CommandResult.success({ closed })
    }

    // Single close: by name or interactive
    let selectedFile = file
    if (!selectedFile) {
      const entries = registry.getAll()

      entries.sort((a, b) => {
        const aLast = a.follow.messages.at(-1)?.date ?? ''
        const bLast = b.follow.messages.at(-1)?.date ?? ''
        return bLast.localeCompare(aLast)
      })

      if (entries.length === 0) {
        output.log('No follows found.')
        return CommandResult.fail('No follows to close')
      }

      const selected = await p.select({
        message: 'Which follow do you want to close?',
        options: entries.map((e) => ({
          value: e.fileName,
          label: e.follow.summary,
          hint: `${e.follow.source} · ${e.follow.checkInterval} · ${e.follow.messages.length} msgs`,
        })),
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      selectedFile = selected as string
    }

    const entry = registry.findByFileName(selectedFile)

    if (!entry) {
      return CommandResult.fail(`Follow not found: ${selectedFile}`)
    }

    if (dryRun) {
      output.log(`[dry-run] Would close: ${selectedFile}`)
      return CommandResult.success({ closed: [selectedFile] })
    }

    await unlink(entry.path)
    output.log(`Closed follow: ${selectedFile}`)

    return CommandResult.success({ closed: [selectedFile] })
  }
}
