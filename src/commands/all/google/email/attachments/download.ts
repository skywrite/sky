import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { resolveFilePath } from '#commands/lib/chat/fileTools.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { getThread } from '#lib/google/gmail.ts'
import { accountSwitchNote } from '../../lib/resolveClient.ts'
import { downloadAttachments, type AttachmentDownloadResult } from '../lib/downloadAttachments.ts'
import { findOwningGmailClient } from '../lib/resolveGmailClient.ts'

const params = {
  thread: Arg.string('Gmail thread id from google:email:read or search'),
  directory: Flag.string('Destination folder from the user’s task or conversation, absolute or ~/path', {
    required: true,
  }),
  message: Flag.string('Limit to one messageId from the attachment list; omitted downloads all messages in the thread'),
  part: Flag.string('Limit to one partId from the attachment list; requires message'),
  account: Flag.string('Mailbox to try first; use account returned by google:email:read', { short: 'a' }),
}
type Params = InferParams<typeof params>
type Result = AttachmentDownloadResult & { threadId: string; account: string; accountNote?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:attachments:download': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class GoogleEmailAttachmentsDownload extends Command {
  static override description: CommandDescription = {
    name: 'google:email:attachments:download',
    description:
      'Download Gmail attachments directly through the connected account. Read google:email:read for attachment ' +
      'names, messageId and partId first. Downloads the thread’s attachments, or only the chosen message/part. ' +
      'Pass directory explicitly, using the destination already established in the conversation or live plan. ' +
      'Reuse that folder without asking again. There is no default destination. ' +
      'Returns verified local paths and per-file errors; retains completed downloads on partial failure or Stop. ' +
      'Identical files reuse their path; different files sharing a name get a suffix. Never overwrites. ' +
      'Next call read_file on the returned paths to inspect PDFs, images, spreadsheets or documents. ' +
      'For shared Google Drive links in the body use google:read instead. No browser sign-in or manual Gmail download needed. ' +
      'Downloading does not mean the contents have been inspected or uploaded elsewhere. Does not change Gmail labels or messages.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    try {
      context.signal?.throwIfAborted()
      if (typeof args.directory !== 'string' || !args.directory.trim())
        return CommandResult.fail('Pass directory using the destination already established for this task.')
      const directory = resolveFilePath(args.directory, context.env.SKY_USER_CWD ?? context.config.DIR_BASE)
      if (!directory.trim() || directory.includes('\0')) return CommandResult.fail('Name a valid destination folder.')
      const found = await findOwningGmailClient({
        secrets: context.secrets,
        requested: args.account,
        what: `Gmail thread ${args.thread}`,
        attempt: (client) => getThread(client, args.thread, { format: 'full' }),
      })
      if (!found.value.length) return CommandResult.fail(`Gmail thread ${args.thread} has no messages.`)
      const downloaded = await downloadAttachments(found.client, found.value, {
        directory,
        message: args.message,
        part: args.part,
        signal: context.signal,
      })
      const accountNote = accountSwitchNote(found)
      const result: Result = {
        ...downloaded,
        threadId: args.thread,
        account: found.client.email,
        ...(accountNote ? { accountNote } : {}),
      }
      for (const file of result.files) context.output.log(`Saved ${file.filename} → ${file.path} (${file.bytes} bytes)`)
      for (const file of result.errors) context.output.log(`Could not save ${file.filename}: ${file.error}`)
      const summary = `${result.files.length} of ${result.totalAttachments} attachment(s) saved to ${directory}.`
      context.output.log(summary)
      return result.complete ? CommandResult.success(result) : CommandResult.fail(summary, result)
    } catch (error) {
      return CommandResult.error(
        error instanceof Error ? error : new Error(String(error)),
        'Gmail attachment download failed',
      )
    }
  }
}
