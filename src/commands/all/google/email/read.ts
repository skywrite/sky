/**
 * google:email:read — one Gmail thread as readable text, with sender,
 * time, and decoded body. The read half of working a reply
 * by voice or chat; google:email:inbox:view supplies the threadId.
 */

import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, getThread } from '#lib/google/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { readThreadContent } from './lib/readThreadContent.ts'
import type { ReadThreadContent } from './lib/readThreadContent.ts'
import { resolveGmailClient } from './lib/resolveGmailClient.ts'

const params = {
  thread: Arg.string('Gmail API thread id (from google:email:inbox:view)'),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
}

type Params = InferParams<typeof params>

type Result = { threadId: string; subject: string } & ReadThreadContent

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:read': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class GoogleEmailReadTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:read',
    description:
      'Read one Gmail thread with sender, time, and body text, oldest first. Call it before ' +
      'summarizing an email aloud or drafting a reply. Takes the threadId from google:email:inbox:view. ' +
      'Bodies are capped at 4,000 characters per message and 24,000 per thread, retaining the newest messages. ' +
      'Check truncated and omittedMessages before treating the result as the complete conversation. Changes nothing.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { thread, account } = args

    let client
    try {
      client = await resolveGmailClient({
        secrets,
        requested: account,
        interactive: context.platform === CommandPlatform.Console && context.compositionDepth === 0,
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    try {
      const messages = await getThread(client, thread, { format: 'full' })
      if (messages.length === 0) return CommandResult.fail(`Gmail thread ${thread} has no messages.`)

      const content = readThreadContent(messages)
      const subject = messages[0].subject || '(no subject)'
      output.log(`\n  ${subject} — ${content.messages.length} of ${content.totalMessages} message(s)\n`)
      if (content.omittedMessages > 0) {
        output.log(`  ${content.omittedMessages} older message(s) omitted to fit the read limit.`)
      }
      const shortened = content.messages.filter((row) => row.truncated).length
      if (shortened > 0) output.log(`  ${shortened} message body/bodies shortened to fit the read limit.`)
      for (const row of content.messages) {
        output.log(`  ${row.date ?? '(no date)'}  ${row.from}`)
        output.log(`    ${truncate(row.text, 200)}`)
      }
      return CommandResult.success({ threadId: thread, subject, ...content })
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail thread read failed')
    }
  }
}
