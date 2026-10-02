/**
 * google:email:draft:reply — a Gmail draft REPLY inside an existing
 * thread. Like draft:new it can only create a draft: recipient, subject,
 * and the RFC threading headers are derived from the thread, the body is
 * markdown rendered to HTML, and sending stays a human act in Gmail.
 */

import open from 'open'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type CommandContext from '#commands/lib/core/CommandContext.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { Arg, ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  AccountResolutionError,
  createDraft,
  draftUrl,
  getThread,
  parseRecipients,
  renderEmailHtml,
} from '#lib/google/mod.ts'
import type { GmailAddress, GmailDraft } from '#lib/google/mod.ts'
import type { SecretsProvider } from '#lib/secrets/SecretsProvider.ts'
import { accountSwitchNote } from '../../lib/resolveClient.ts'
import { findOwningGmailClient } from '../lib/resolveGmailClient.ts'
import { pickReplyTarget } from './lib/replyTarget.ts'

const params = {
  thread: Arg.string('Gmail API thread id (from google:email:inbox:view)'),
  body: ArgOrFlag.string(
    'The reply as you would type it in Gmail: short paragraphs separated by blank lines, lines never hard-wrapped; markdown links, lists and emphasis render',
    { short: 'b', required: true, position: 1 },
  ),
  to: Flag.string('Override the recipient(s), comma-separated (default: the sender being replied to)', {
    short: 't',
  }),
  cc: Flag.string('Cc recipient(s), comma-separated'),
  account: Flag.string(
    'Google account to try first — the `account` on the listed thread (email or unique part of it); left out, Sky replies from the mailbox the thread is in',
    { short: 'a' },
  ),
  noOpen: Flag.bool('Do not open the draft in the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = {
  report: string
  url: string
  threadId: string
  draftId: string
  /** The mailbox the reply waits in */
  account: string
  /** Set when another account was tried first and could not open the thread */
  accountNote?: string
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:draft:reply': { params: Params; result: Result }
  }
}

/** The mailbox a thread lives in, with its messages' headers — a reply is written from there. */
function findThread(secrets: SecretsProvider, thread: string, requested: string | undefined) {
  return findOwningGmailClient({
    secrets,
    requested,
    what: `Gmail thread ${thread}`,
    attempt: (client) => getThread(client, thread, { format: 'metadata' }),
  })
}

/**
 * Creates a reply draft and nothing else: this command never calls a send
 * endpoint. The user reviews and sends the stored reply from Gmail.
 */
@AIChatTool({ needsApproval: true })
export default class GoogleEmailDraftReplyTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:draft:reply',
    description:
      'Create a Gmail draft REPLY inside an existing thread. It is never sent: the draft waits in the thread ' +
      'for the user to review and send by hand. Takes the threadId from google:email:inbox:view; recipient and ' +
      'subject come from the thread (the newest message from the other side). Body is markdown rendered to ' +
      'HTML — never hard-wrap lines. Read the thread with google:email:read first. The reply is written from ' +
      'the mailbox the thread lives in; `account` in the result says which.',
    usage: [
      'sky google:email:draft:reply <threadId> "Thanks — Thursday works. I will bring the numbers."',
      'sky google:email:draft:reply <threadId> -b "..." -a work --no-open',
    ],
    params,
  }

  static async formatApproval(
    input: Record<string, unknown>,
    output: OutputHandler,
    context?: CommandContext,
  ): Promise<void> {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    // The card names the mailbox the reply will wait in; a lookup that fails here fails the run too, and says why there.
    const from = context
      ? await findThread(context.secrets, text('thread'), text('account') || undefined).then(
          (found) => found.client.email,
          () => undefined,
        )
      : undefined
    output.log('')
    output.log(colors.bold('Save this Gmail reply draft? (saved into the thread, never sent — you send it from Gmail)'))
    output.log('')
    if (from) output.log(`  From:    ${from}`)
    output.log(`  Thread:  ${text('thread') || '(no thread)'}`)
    if (text('to')) output.log(`  To:      ${text('to')}`)
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
      return CommandResult.fail('Provide the reply text, e.g. sky google:email:draft:reply <threadId> "Thanks — ..."')
    }

    let found
    try {
      found = await findThread(secrets, args.thread, args.account)
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      return CommandResult.error(err as Error, 'Gmail thread read failed')
    }
    const { client, value: messages } = found
    const target = pickReplyTarget(messages, client.email)
    if (!target) return CommandResult.fail(`Gmail thread ${args.thread} has no messages to reply to.`)

    let to: GmailAddress[]
    let cc: GmailAddress[]
    try {
      to = args.to ? parseRecipients(args.to) : target.to
      cc = parseRecipients(args.cc)
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }
    if (to.length === 0) {
      return CommandResult.fail('The thread names no one to reply to — pass the recipient with --to.')
    }

    let draft: GmailDraft
    try {
      draft = await createDraft(
        client,
        {
          to,
          cc,
          subject: target.subject,
          inReplyTo: target.inReplyTo,
          references: target.references,
          html: renderEmailHtml(text),
        },
        { threadId: args.thread },
      )
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail draft creation failed')
    }

    const url = draftUrl(client.email, draft.messageId)
    if (!args.noOpen) open(url).catch(() => undefined)

    const recipients = to.map((a) => a.address).join(', ')
    const accountNote = accountSwitchNote(found)
    const report = `Reply draft saved (not sent) in ${client.email} — ${target.subject} to ${recipients} — ${url}`
    output.log('')
    if (accountNote) output.log(accountNote)
    output.log(report)
    return CommandResult.success({
      report,
      url,
      threadId: args.thread,
      draftId: draft.id,
      account: client.email,
      ...(accountNote ? { accountNote } : {}),
    })
  }
}
