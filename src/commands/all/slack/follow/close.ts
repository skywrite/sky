import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import * as p from '@clack/prompts'
import ms from 'ms'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_STATE_FOLLOW_SLACK_ACTIVE, DIR_STATE_FOLLOW_SLACK_ARCHIVE } from '#config'
import { exists, outputFile } from '#shared/fs/mod.ts'
import type Follow from '#shared/models/Follow/mod.ts'
import SlackFollowRegistry from '#shared/models/Follow/SlackFollowRegistry.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'

const params = {
  file: Arg.string('Follow file name (without .yaml extension)', { optional: true }),
  inactiveThan: Flag.string('Close all follows inactive for longer than duration (e.g. 7d, 2w)', {
    short: 'i',
  }),
  dryRun: Flag.bool('Show what would be closed without archiving', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { closed: string[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:follow:close': {
      params: Params
      result: Result
    }
  }
}

export default class SlackFollowCloseTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:follow:close',
    description: 'Close follows by marking them closed and archiving their files.',
    usage: [
      'sky slack:follow:close                                              # Pick from list',
      'sky slack:follow:close slack_core-four_Person-wants-weekly-meetings  # By name',
      'sky slack:follow:close --inactive-than 7d                           # Close inactive > 7 days',
      'sky slack:follow:close --inactive-than 7d --dry-run                 # Preview without archiving',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { file, inactiveThan, dryRun } = args

    if (!(await exists(DIR_STATE_FOLLOW_SLACK_ACTIVE))) {
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
      const entries = registry.getActive()
      const stale = entries.filter((e) => e.follow.inactivityMs(now) >= thresholdMs)

      if (stale.length === 0) {
        output.log(`No active follows inactive longer than ${inactiveThan}.`)
        return CommandResult.success({ closed: [] })
      }

      const closed: string[] = []
      for (const e of stale) {
        const label = dryRun ? '[dry-run] Would close' : 'Closed'
        output.log(`${label}: ${e.follow.summary} (${e.fileName})`)
        if (!dryRun) {
          await archiveFollow(e.path, e.fileName, e.follow)
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

    await archiveFollow(entry.path, selectedFile, entry.follow)
    output.log(`Closed follow: ${selectedFile}`)

    return CommandResult.success({ closed: [selectedFile] })
  }
}

/** Mark the follow closed, write it to the archive dir, and remove it from active/ */
async function archiveFollow(activePath: string, fileName: string, follow: Follow): Promise<void> {
  const closed = follow.updateStatus('closed')
  await outputFile(path.join(DIR_STATE_FOLLOW_SLACK_ARCHIVE, `${fileName}.yaml`), closed.toYaml())
  await unlink(activePath)
}
