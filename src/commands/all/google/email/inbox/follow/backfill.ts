import { Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import EmailFollowRegistry from '#shared/models/Follow/EmailFollowRegistry.ts'
import { backfillArchivedFollows } from '../../lib/backfillArchivedFollows.ts'
import type { BackfillResult } from '../../lib/backfillArchivedFollows.ts'
import { archivedLabelName } from '../../lib/followLabels.ts'
import { resolveGmailClient } from '../../lib/resolveGmailClient.ts'

const params = {
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  label: Flag.string('Follow label whose archived history to mark', { default: () => 'Sky/Follow' }),
  apply: Flag.bool('Apply archive labels; otherwise only preview the counts', { default: false }),
}
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:inbox:follow:backfill': { params: Params; result: BackfillResult }
  }
}

export default class GoogleEmailFollowBackfill extends Command {
  static override description: CommandDescription = {
    name: 'google:email:inbox:follow:backfill',
    description: 'Mark previously saved, closed email follows with Sky/Archived. Preview unless --apply is set.',
    descriptionLong: [
      'Matches archived follows by account and Gmail thread id. Skips active or queued follows.',
      'Only adds the archive label: inbox placement, read status, notebook files, and watches stay as they are.',
      'Safe to repeat; already-marked threads are skipped.',
    ],
    usage: ['sky google:email:inbox:follow:backfill --account jane@example.com --apply'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<BackfillResult>> {
    try {
      const client = await resolveGmailClient({
        secrets: context.secrets,
        requested: args.account,
        interactive: context.platform === CommandPlatform.Console && context.compositionDepth === 0,
      })
      const registry = await EmailFollowRegistry.buildWithArchive(
        context.config.DIR_STATE_FOLLOW_EMAIL_ACTIVE,
        context.config.DIR_STATE_FOLLOW_EMAIL_ARCHIVE,
      )
      const result = await backfillArchivedFollows({
        client,
        registry,
        label: args.label,
        apply: args.apply,
        onProgress: (progress) => {
          if (progress.candidates % 25 === 0) context.output.log(`  Checked ${progress.candidates} archived threads...`)
        },
      })
      context.output.log(
        `${archivedLabelName(args.label)}: ${result.labeled} labeled, ${result.wouldLabel} would label, ${result.alreadyLabeled} already labeled, ${result.skipped} skipped, ${result.errors.length} failed.`,
      )
      if (result.errors.length > 0) return CommandResult.fail(result.errors.join('\n'), result)
      return CommandResult.success(result)
    } catch (error) {
      return CommandResult.error(error as Error, 'Archive-label backfill failed')
    }
  }
}
