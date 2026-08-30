import colors from 'picocolors'
import parseChannelTarget from '#commands/all/slack/lib/parseChannelTarget.ts'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { SLACK_WORKSPACE } from '#config'
import { composeDraft } from './lib/compose.ts'

const params = {
  conversation: Arg.string(
    "Where the draft goes: a link to the conversation or any message in it, a #channel, a conversation id (D…, C…, G…), or a user id for that person's DM",
  ),
  text: Arg.string(
    'The message as typed in Slack (mrkdwn: *bold*, _italic_, `code`; lines starting with - or 1. become lists)',
    { position: 1 },
  ),
  noOpen: Flag.bool('Do not open the conversation in Slack', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { report: string; url?: string; draftId?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'slack:draft:new': { params: Params; result: Result }
  }
}

/**
 * Files a draft and nothing else: the only Slack write here is
 * `agent-slack message draft create`, so the message leaves the account
 * only when the user sends it from the composer after reading it there.
 */
@AIChatTool({ needsApproval: true })
export default class SlackDraftNewTask extends Command {
  static override description: CommandDescription = {
    name: 'slack:draft:new',
    description:
      "Save a Slack DRAFT message into a conversation's composer — a DM, group DM, or channel. It is never sent: the text waits in the composer for the user to read, edit, and send by hand. Not for thread replies (slack:draft:reply). Target: a link to the conversation or any message in it, a #channel, a conversation id, or a user id; text in Slack mrkdwn.",
    descriptionLong: [
      'A link names its conversation; a #channel, bare name, conversation id,',
      "or user id goes to agent-slack as given (a user id opens that person's",
      'DM). The text is filed into the composer via `agent-slack message draft',
      'create`, then the conversation opens in Slack. The draft shows in the',
      "composer and in Slack's Drafts view, only to you. Nothing is sent, ever",
      '— the send button in Slack is the only way out. To answer inside a',
      'thread use slack:draft:reply; slack:draft:clear removes what you do not',
      'want.',
    ],
    usage: [
      'sky slack:draft:new https://atlas.slack.com/archives/D012ABCDEF "Hey — got a minute this afternoon?"',
      'sky slack:draft:new "#atlas" "Kickoff moves to Thursday, details in the doc"',
      'sky slack:draft:new U012ABCDEF "..." --no-open',
      'sky slack:draft:new "#atlas" -- "- first line is a list item"   (-- when the text starts with a dash)',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    output.log('')
    output.log(colors.bold('Save this Slack draft? (never sent — you send it from the composer in Slack)'))
    output.log('')
    output.log(`  To: ${text('conversation') || '(no conversation)'}`)
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

    // A link names its conversation id — a message link must not become a
    // thread here; anything else is agent-slack's to resolve
    const target = parseChannelTarget(args.conversation)?.channelId ?? args.conversation.trim()
    if (!target) {
      return CommandResult.fail('Give a conversation: a Slack link, #channel, conversation id, or user id')
    }

    const outcome = await composeDraft(
      {
        workspace,
        target,
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
