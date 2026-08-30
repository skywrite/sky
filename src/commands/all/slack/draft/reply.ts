import colors from 'picocolors'
import parseMessageLink from '#commands/all/slack/lib/parseMessageLink.ts'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { composeDraft } from './lib/compose.ts'

const params = {
  link: Arg.string(
    'Link to the message being replied to — a reply inside a thread targets that thread, a top-level message starts one',
  ),
  text: Arg.string(
    'The reply as typed in Slack (mrkdwn: *bold*, _italic_, `code`; lines starting with - or 1. become lists)',
    { position: 1 },
  ),
  noOpen: Flag.bool('Do not open the thread in Slack', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { report: string; url?: string; draftId?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:draft:reply': { params: Params; result: Result }
  }
}

/**
 * Files a draft and nothing else: the only Slack write here is
 * drafts.create, so the reply leaves the account only when the user sends
 * it from the thread's reply box after reading it there.
 */
@AIChatTool({ needsApproval: true })
export default class SlackDraftReplyTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:draft:reply',
    description:
      "Save a Slack DRAFT reply into a thread. It is never sent: the text waits in that thread's reply box for the user to read, edit, and send by hand. Give the link of the message to reply to (a thread reply or its root) and the reply in Slack mrkdwn.",
    descriptionLong: [
      'Parses the channel and thread root out of the message link (a reply',
      "link carries its thread; a top-level message's own thread is used) and",
      'files the text there via `agent-slack message draft create --thread-ts`,',
      'then opens the thread in Slack. The draft shows up in the thread pane',
      "and in Slack's Drafts view, only to you. Nothing is sent, ever — the",
      'send button in Slack is the only way out. Works in channels, group DMs,',
      'and DMs alike (a DM thread is a thread); for the DM composer itself use',
      'slack:draft:new. slack:draft:clear removes what you do not want.',
    ],
    usage: [
      'sky slack:draft:reply https://atlas.slack.com/archives/C012ABCDEF/p1700000000000100 "On it — will have numbers by Thursday"',
      'sky slack:draft:reply <thread link> "Thanks, merging now" --no-open',
      'sky slack:draft:reply <thread link> -- "- first line is a list item"   (-- when the text starts with a dash)',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    output.log('')
    output.log(colors.bold('Save this Slack draft reply? (never sent — you send it from the thread in Slack)'))
    output.log('')
    output.log(`  Thread: ${text('link') || '(no link)'}`)
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

    const parsed = parseMessageLink(args.link)
    if (!parsed) {
      return CommandResult.fail(
        `Not a Slack message link: ${args.link} — copy the link of the message to reply to (…/archives/<channel>/p<ts>)`,
      )
    }

    const outcome = await composeDraft(
      {
        workspace,
        target: parsed.channelId,
        threadTs: parsed.rootTs,
        text: args.text,
        timezone: systemNow.timezone,
        nowMs: systemNow.epochMilliseconds,
        open: !args.noOpen,
      },
      output,
    )
    if ('error' in outcome) return CommandResult.fail(outcome.error)
    return CommandResult.success(outcome)
  }
}
