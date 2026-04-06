import colors from 'picocolors'
import { WebClient } from '@slack/web-api'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { renderSlackForTerminal } from '#lib/terminal/renderSlack.ts'

const params = {
  message: Arg.string('Message to post', { required: true }),
  token: Flag.string('Slack user token (or set SLACK_USER_TOKEN env var)', { short: 't', hidden: true }),
  channel: Flag.string('Channel ID or name (default: your own DM)', { short: 'c' }),
}

type Params = InferParams<typeof params>

export default class SlackPostTask extends Command {
  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const { message, channel } = input as { message: string; channel?: string }
    const dest = channel ? ` to ${channel}` : ' to yourself'
    const indented = renderSlackForTerminal(message).replace(/^/gm, '  ')
    output.log('')
    output.log(colors.bold(`Send this Slack message${dest}?`))
    output.log('')
    output.log(colors.dim('---'))
    output.log(indented)
    output.log(colors.dim('---'))
    output.log('')
  }

  static override description: CommandDescription = {
    name: 'slack:api:post',
    description: 'Post a message to Slack channel or DM.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, env } = context
    const { message, channel } = args
    const token = args.token || env.SLACK_USER_TOKEN

    if (!token) {
      return CommandResult.fail(
        'No Slack token provided. Use --token flag or set SLACK_USER_TOKEN environment variable.',
      )
    }

    try {
      const client = new WebClient(token)

      // If no channel specified, get the user's own DM
      let targetChannel = channel

      if (!targetChannel) {
        output.log('Getting authenticated user info...')

        const authResult = await client.auth.test()
        const userId = authResult.user_id as string
        output.log(`Authenticated as: ${authResult.user} (${userId})`)

        // Open a DM with yourself
        output.log('Opening DM conversation...')
        const dmResult = await client.conversations.open({ users: userId })

        if (!dmResult.channel?.id) {
          return CommandResult.fail('Failed to open DM conversation')
        }

        targetChannel = dmResult.channel.id
        output.log(`DM channel: ${targetChannel}`)
      }

      // Post the message
      output.log(`Posting message to ${targetChannel}...`)
      const result = await client.chat.postMessage({
        channel: targetChannel,
        text: message,
      })

      output.log(`✓ Message posted successfully!`)
      output.log(`  Channel: ${targetChannel}`)
      output.log(`  Timestamp: ${result.ts}`)

      return CommandResult.success({
        channel: targetChannel,
        timestamp: result.ts,
        message,
      })
    } catch (error) {
      return CommandResult.error(error as Error, 'Failed to post to Slack')
    }
  }
}
