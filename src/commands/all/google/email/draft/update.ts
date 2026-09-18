/**
 * google:email:draft:update — rewrite a waiting Gmail draft in place.
 * The revision loop behind "let's work on it": new/reply file the draft
 * once, update replaces its body, and the headers — recipient, subject,
 * reply threading — carry forward unless overridden. Sending stays a
 * human act in Gmail.
 */

import open from 'open'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, ArgOrFlag, Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  AccountResolutionError,
  draftUrl,
  getDraft,
  parseRecipients,
  renderEmailHtml,
  updateDraft,
} from '#lib/google/mod.ts'
import type { GmailAddress, GmailDraft } from '#lib/google/mod.ts'
import { resolveGmailClient } from '../lib/resolveGmailClient.ts'

const params = {
  draftId: Arg.string('The draft id (from google:email:draft:new or google:email:draft:reply)'),
  body: ArgOrFlag.string(
    'The FULL replacement message as you would type it in Gmail: short paragraphs separated by blank lines, lines never hard-wrapped; markdown renders',
    { short: 'b', required: true, position: 1 },
  ),
  to: Flag.string('Override the recipient(s), comma-separated (default: kept from the draft)', { short: 't' }),
  subject: Flag.string('Override the subject (default: kept from the draft)', { short: 's' }),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  noOpen: Flag.bool('Do not open the draft in the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { report: string; url: string; draftId: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:draft:update': { params: Params; result: Result }
  }
}

/**
 * Rewrites a draft and nothing else: drafts.update stores content, and
 * this command never calls a send endpoint.
 */
@AIChatTool({ needsApproval: true })
export default class GoogleEmailDraftUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:draft:update',
    description:
      'Replace the text of a waiting Gmail draft — the revision step after google:email:draft:new or ' +
      'google:email:draft:reply. It is never sent: the reworded draft keeps waiting in Gmail for the user to ' +
      'review and send by hand. Pass the draftId the create returned and the FULL new body (it replaces, not ' +
      'appends); recipient, subject, and reply threading carry forward.',
    usage: [
      'sky google:email:draft:update <draft-id> "Reworked: Thursday works after all — details below."',
      'sky google:email:draft:update <draft-id> -b "..." -s "New subject"',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    output.log('')
    output.log(colors.bold('Rewrite this Gmail draft? (never sent — you send it from Gmail)'))
    output.log('')
    output.log(`  Draft: ${text('draftId') || '(no id)'}`)
    if (text('to')) output.log(`  To:    ${text('to')}`)
    if (text('subject')) output.log(`  Subject: ${text('subject')}`)
    output.log('')
    output.log(colors.dim('---'))
    output.log(text('body').replace(/^/gm, '  '))
    output.log(colors.dim('---'))
    output.log('')
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context
    const text = args.body?.trim()
    if (!text) {
      return CommandResult.fail('Provide the replacement text, e.g. sky google:email:draft:update <draft-id> "..."')
    }

    let client
    try {
      client = await resolveGmailClient({
        secrets,
        requested: args.account,
        interactive: context.platform === CommandPlatform.Console && context.compositionDepth === 0,
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    let updated: GmailDraft
    try {
      const existing = await getDraft(client, args.draftId)
      const { message } = existing

      let to: GmailAddress[]
      try {
        to = args.to ? parseRecipients(args.to) : (message.to ?? [])
      } catch (err) {
        return CommandResult.fail((err as Error).message)
      }

      // A reply draft keeps its thread; a fresh draft's threadId is its own
      // message id, which drafts.update must not echo back.
      const isReply = Boolean(message.inReplyTo)
      updated = await updateDraft(
        client,
        args.draftId,
        {
          to,
          cc: message.cc,
          subject: args.subject?.trim() || message.subject,
          inReplyTo: message.inReplyTo,
          references: message.references,
          html: renderEmailHtml(text),
        },
        isReply ? { threadId: message.threadId } : {},
      )
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail draft update failed')
    }

    const url = draftUrl(client.email, updated.messageId)
    if (!args.noOpen) open(url).catch(() => undefined)

    const report = `Gmail draft rewritten (not sent) in ${client.email} — ${url}`
    output.log('')
    output.log(report)
    return CommandResult.success({ report, url, draftId: updated.id })
  }
}
