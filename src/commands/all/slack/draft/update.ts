/**
 * slack:draft:update — replace a waiting draft's text. The revision loop
 * behind "let's work on it": create files the draft once, update rewrites
 * it in place, and Slack's send button stays the only way out.
 */

import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { slackTs, updateDraft } from './lib/drafts.ts'
import type { SlackDraft } from './lib/drafts.ts'
import { renderDraftRow, resolveDraftRows } from './lib/rows.ts'

const params = {
  draftId: Arg.string('The draft id (from slack:draft:new, slack:draft:reply, or slack:draft:list)'),
  text: Arg.string(
    'The full replacement text as typed in Slack (mrkdwn: *bold*, _italic_, `code`; lines starting with - or 1. become lists)',
    { position: 1 },
  ),
}

type Params = InferParams<typeof params>
type Result = { report: string; url?: string; draftId: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:draft:update': { params: Params; result: Result }
  }
}

/**
 * Rewrites a draft and nothing else: the only Slack write here is
 * drafts.update, so the message still leaves the account only when the
 * user sends it from Slack after reading it there.
 */
@AIChatTool({ needsApproval: true })
export default class SlackDraftUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:draft:update',
    description:
      'Replace the text of a waiting Slack draft — the revision step after slack:draft:new or slack:draft:reply. ' +
      'It is never sent: the reworded draft keeps waiting where it was for the user to read, edit, and send by ' +
      'hand. Pass the draftId the create returned and the FULL new text (it replaces, not appends).',
    usage: [
      'sky slack:draft:update <draft-id> "Reworked: Thursday works after all — details in the doc"',
      'sky slack:draft:update <draft-id> -- "- the new text starts with a dash"',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    output.log('')
    output.log(colors.bold('Rewrite this Slack draft? (never sent — you send it from Slack)'))
    output.log('')
    output.log(`  Draft: ${text('draftId') || '(no id)'}`)
    output.log('')
    output.log(colors.dim('---'))
    output.log(text('text').replace(/^/gm, '  '))
    output.log(colors.dim('---'))
    output.log('')
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, systemNow } = context

    if (!SLACK_WORKSPACE) {
      return CommandResult.fail('No slack.workspace configured — set it via sky init or config.jsonc.')
    }
    const workspace = SLACK_WORKSPACE.replace(/\/$/, '')

    const text = args.text.trim()
    if (!text) return CommandResult.fail('The draft has no text')

    const outcome = await updateDraft(workspace, { id: args.draftId, text })
    if (!outcome.ok) return CommandResult.fail(outcome.error)

    const draft: SlackDraft = outcome.draft ?? {
      id: args.draftId,
      text,
      last_updated_ts: slackTs(systemNow.epochMilliseconds),
      date_scheduled: 0,
      file_ids: [],
      destinations: [],
    }
    const [row] = await resolveDraftRows([draft], workspace, systemNow.timezone)

    output.log('')
    output.log(colors.bold('Draft rewritten (not sent) — read, edit, and send it in Slack:'))
    for (const line of renderDraftRow(row, 0)) output.log(line)

    const report = `Slack draft ${args.draftId} rewritten (not sent)${row.link ? ` — ${row.link}` : ''}`
    return CommandResult.success({ report, url: row.link, draftId: args.draftId })
  }
}
