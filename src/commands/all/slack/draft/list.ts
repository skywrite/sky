import colors from 'picocolors'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { DRAFTS_PAGE_LIMIT, isScheduled, listActiveDrafts } from './lib/drafts.ts'
import { renderDraftRow, resolveDraftRows } from './lib/rows.ts'

const params = {}

type Params = InferParams<typeof params>

type Result = {
  listed: number
  /** Slack lists at most DRAFTS_PAGE_LIMIT per call — true when the pile is deeper than what was shown */
  hasMore: boolean
  scheduled: number
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:draft:list': { params: Params; result: Result }
  }
}

export default class SlackDraftListTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:draft:list',
    description: 'List the Slack drafts waiting in the composer, most recently edited first.',
    descriptionLong: [
      'Every unsent draft on the account, in the order Slack keeps them — the',
      'last-edited first — with where each would post (a person, a group DM, a',
      '#channel, and whether it is a thread reply) and a snippet of the text.',
      'The time is a link to that thread or conversation.',
      '',
      `Slack answers at most ${DRAFTS_PAGE_LIMIT} drafts per call and offers no way to page,`,
      'so a full page is flagged as possibly deeper. Read-only, via',
      '`agent-slack message draft list`; slack:draft:clear deletes them.',
    ],
    usage: ['sky slack:draft:list'],
    params,
  }

  async run({ context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context

    if (!SLACK_WORKSPACE) {
      return CommandResult.fail('No slack.workspace configured — set it via sky init or config.jsonc.')
    }
    const workspace = SLACK_WORKSPACE.replace(/\/$/, '')

    const page = await listActiveDrafts(workspace)
    if ('error' in page) return CommandResult.fail(page.error)
    const rows = await resolveDraftRows(page.drafts, workspace, systemNow.timezone)
    const scheduled = rows.filter((row) => isScheduled(row.draft)).length

    output.log(
      `Slack drafts: ${colors.bold(String(rows.length))}` +
        (page.hasMore ? colors.dim(` (Slack lists ${DRAFTS_PAGE_LIMIT} at a time — there may be more)`) : ''),
    )
    for (const [index, row] of rows.entries()) {
      for (const line of renderDraftRow(row, index)) output.log(line)
    }
    if (rows.length > 0) {
      output.log('')
      output.log(
        colors.dim(
          `Delete them all with: sky slack:draft:clear${scheduled > 0 ? '   (scheduled sends are kept)' : ''}`,
        ),
      )
    }

    return CommandResult.success({ listed: rows.length, hasMore: page.hasMore, scheduled })
  }
}
