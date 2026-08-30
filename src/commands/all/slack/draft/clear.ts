import colors from 'picocolors'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { DRAFTS_PAGE_LIMIT, deleteDraft, isScheduled, listActiveDrafts } from './lib/drafts.ts'
import { renderDraftRow, resolveDraftRows } from './lib/rows.ts'

/** Pages of DRAFTS_PAGE_LIMIT — a runaway guard, not a quota */
const MAX_PASSES = 100

const params = {}

type Params = InferParams<typeof params>

type Result = {
  deleted: number
  /** Scheduled sends left in place */
  kept: number
  failures: string[]
  passes: number
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:draft:clear': { params: Params; result: Result }
  }
}

export default class SlackDraftClearTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:draft:clear',
    description: 'Delete every Slack draft; scheduled sends are kept.',
    descriptionLong: [
      'Lists the drafts as slack:draft:list does and deletes each one as it',
      'goes — the printed rows are the only record of what the drafts said,',
      'so the terminal keeps the ledger. Scheduled sends are drafts with a',
      'date: deleting one cancels the send, so they stay, marked as kept.',
      '',
      `Slack hands over ${DRAFTS_PAGE_LIMIT} drafts at a time with no way to page, so the`,
      'run asks again after each page until the pile is empty. Nothing is',
      'sent, ever — only drafts.delete is called.',
    ],
    usage: ['sky slack:draft:clear'],
    params,
  }

  async run({ context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context

    if (!SLACK_WORKSPACE) {
      return CommandResult.fail('No slack.workspace configured — set it via sky init or config.jsonc.')
    }
    const workspace = SLACK_WORKSPACE.replace(/\/$/, '')

    const keptIds = new Set<string>()
    const failedIds = new Set<string>()
    const failures: string[] = []
    let deleted = 0
    let index = 0
    let passes = 0

    while (passes < MAX_PASSES) {
      const page = await listActiveDrafts(workspace)
      if ('error' in page) {
        return CommandResult.fail(deleted > 0 ? `${page.error} (after deleting ${deleted})` : page.error)
      }
      // Kept and failed drafts come back on every page; only the rest is new work
      const fresh = page.drafts.filter((draft) => !keptIds.has(draft.id) && !failedIds.has(draft.id))
      if (fresh.length === 0) break
      passes++

      const rows = await resolveDraftRows(fresh, workspace, systemNow.timezone)
      output.log(
        passes === 1
          ? `Slack drafts: ${colors.bold(String(rows.length))}` +
              (page.hasMore ? colors.dim(` (Slack lists ${DRAFTS_PAGE_LIMIT} at a time — more to come)`) : '')
          : colors.dim(`Next page: ${rows.length}`),
      )

      for (const row of rows) {
        for (const line of renderDraftRow(row, index)) output.log(line)
        index++
        if (isScheduled(row.draft)) {
          keptIds.add(row.draft.id)
          output.log(colors.dim('       kept — scheduled send'))
          continue
        }
        const result = await deleteDraft(workspace, row.draft)
        if (result.ok) {
          deleted++
        } else {
          failedIds.add(row.draft.id)
          failures.push(`${row.label} (${row.timeLabel}): ${result.error}`)
          output.log(colors.red(`       ! not deleted: ${result.error}`))
        }
      }

      if (!page.hasMore) break
    }

    output.log('')
    if (deleted === 0 && keptIds.size === 0 && failures.length === 0) {
      output.log('No drafts to delete.')
    } else {
      output.log(
        `Deleted ${colors.bold(String(deleted))} draft${deleted === 1 ? '' : 's'}` +
          (keptIds.size > 0 ? colors.dim(`; kept ${keptIds.size} scheduled`) : '') +
          (failures.length > 0 ? colors.red(`; ${failures.length} failed`) : ''),
      )
    }
    return CommandResult.success({ deleted, kept: keptIds.size, failures, passes })
  }
}
