/**
 * google:email:read — one Gmail thread as readable text, with sender,
 * time, and decoded body. The read half of working a reply
 * by voice or chat; google:email:inbox:view supplies the threadId.
 */

import { z } from 'zod'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, getThread } from '#lib/google/mod.ts'
import truncate from '#shared/strings/truncate.ts'
import { accountSwitchNote } from '../lib/resolveClient.ts'
import { readThreadContent } from './lib/readThreadContent.ts'
import type { ReadThreadContent } from './lib/readThreadContent.ts'
import { findOwningGmailClient } from './lib/resolveGmailClient.ts'

const params = {
  thread: Arg.string('Gmail API thread id (from google:email:search or google:email:inbox:view)'),
  message: Flag.string('Read one message in full, in chunks; use its id or an omittedMessageIds entry'),
  offset: Flag.number('Continue the selected message at its returned nextOffset', {
    optional: true,
    schema: z.coerce.number().int().min(0),
  }),
  account: Flag.string(
    'Google account to try first — the `account` on the listed thread (email or unique part of it); left out, Sky finds the mailbox the thread is in',
    { short: 'a' },
  ),
}

type Params = InferParams<typeof params>

type Result = {
  threadId: string
  subject: string
  /** The mailbox the thread was read from */
  account: string
  /** Set when another account was tried first and could not open the thread */
  accountNote?: string
} & ReadThreadContent

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
      'summarizing an email aloud or drafting a reply. Takes the threadId from google:email:search or google:email:inbox:view. ' +
      'Bodies are capped at 4,000 characters per message and 24,000 per thread, retaining the newest messages. ' +
      'Check truncated and omittedMessages before treating the result as the complete conversation. ' +
      'For omitted messages, pass message from omittedMessageIds. For shortened bodies, pass message=id and offset=nextOffset; ' +
      'continue until no nextOffset remains. A selected message returns up to 24,000 characters per call. Use these ' +
      'continuations, not a browser, to finish reading. Search can locate related threads beyond this thread. The thread ' +
      'is read from the connected account it lives in; `account` in the result says which. ' +
      'The attachments list includes every file in the thread (or selected message), even on omitted messages. ' +
      'Use google:email:attachments:download with thread, account, the task’s destination as directory, ' +
      'and optional messageId as message / partId as part; ' +
      'then read_file on its saved paths to inspect the contents. Shared Drive links are read with google:read. Changes nothing.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const { thread, account } = args

    // A thread lives in one mailbox: whichever connected account can open it reads it.
    let found
    try {
      found = await findOwningGmailClient({
        secrets,
        requested: account,
        what: `Gmail thread ${thread}`,
        attempt: (client) => getThread(client, thread, { format: 'full' }),
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      return CommandResult.error(err as Error, 'Gmail thread read failed')
    }

    const { client, value: messages } = found
    if (messages.length === 0) return CommandResult.fail(`Gmail thread ${thread} has no messages.`)

    try {
      const content = readThreadContent(messages, { message: args.message, offset: args.offset })
      const subject = messages[0].subject || '(no subject)'
      const accountNote = accountSwitchNote(found)
      output.log(
        `\n  ${subject} — ${content.messages.length} of ${content.totalMessages} message(s) — ${client.email}\n`,
      )
      if (accountNote) output.log(`  ${accountNote}`)
      if (content.omittedMessages > 0) {
        output.log(`  ${content.omittedMessages} older message(s) omitted to fit the read limit.`)
      }
      const shortened = content.messages.filter((row) => row.truncated).length
      if (shortened > 0) output.log(`  ${shortened} message body/bodies shortened to fit the read limit.`)
      for (const row of content.messages) {
        output.log(`  ${row.date ?? '(no date)'}  ${row.from}`)
        output.log(`    ${truncate(row.text, 200)}`)
      }
      output.log(`  ${content.attachments.length} attachment(s) available through google:email:attachments:download.`)
      for (const attachment of content.attachments)
        output.log(
          `    ${attachment.filename} — ${attachment.contentType}, ${attachment.size} bytes — message ${attachment.messageId}, part ${attachment.partId}`,
        )
      return CommandResult.success({
        threadId: thread,
        subject,
        account: client.email,
        ...(accountNote ? { accountNote } : {}),
        ...content,
      })
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail thread read failed')
    }
  }
}
