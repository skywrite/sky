import open from 'open'
import colors from 'picocolors'
import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import type { OutputHandler } from '#commands/lib/output/OutputHandler.ts'
import { ArgOrFlag, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, createDraft, draftUrl, parseRecipients, renderEmailHtml } from '#lib/google/mod.ts'
import type { GmailAddress, GmailDraft } from '#lib/google/mod.ts'
import { resolveGmailClient } from '../lib/resolveGmailClient.ts'

const params = {
  body: ArgOrFlag.string(
    'The message as you would type it in Gmail: short paragraphs separated by blank lines, lines never hard-wrapped; markdown links, lists and emphasis render',
    { short: 'b', required: true },
  ),
  to: Flag.string('Recipient(s), comma-separated: "Jane Doe <jane@example.com>, bob@example.com"', { short: 't' }),
  cc: Flag.string('Cc recipient(s), comma-separated'),
  bcc: Flag.string('Bcc recipient(s), comma-separated'),
  subject: Flag.string('Subject line', { short: 's' }),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  noOpen: Flag.bool('Do not open the draft in the browser', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { report: string; url: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:email:draft:new': { params: Params; result: Result }
  }
}

/**
 * Creates a draft and nothing else: the Gmail lib has no send primitive, so
 * the only way this message leaves the account is the user pressing Send in
 * Gmail after reading it there.
 */
@AIChatTool({ needsApproval: true })
export default class GoogleEmailDraftNewTask extends Command {
  static override description: CommandDescription = {
    name: 'google:email:draft:new',
    description:
      'Create a NEW Gmail draft — a fresh message, not a reply. It is never sent: the draft waits in Gmail Drafts for the user to review and send by hand. Body is markdown rendered to HTML (paragraphs flow — never hard-wrap lines); give recipients and a subject when known.',
    descriptionLong: [
      'Files a message under Drafts via the Gmail API, using the OAuth grant',
      'from google:auth (requires the Gmail scope), then opens the draft in the',
      'browser. The body is markdown rendered to HTML, so the draft opens in',
      "Gmail's normal rich compose and paragraphs flow to the reader's width.",
      'Nothing is sent, ever: sending is a separate Gmail endpoint the code',
      'does not call — finish and send from Gmail. Recipients and subject are',
      'optional; add them in Gmail if omitted. Replies into existing threads',
      'are not supported yet.',
    ],
    usage: [
      'sky google:email:draft:new "Hi Jane, can we move the Atlas kickoff to Thursday?" -t jane@example.com -s "Atlas kickoff"',
      'sky google:email:draft:new -b "..." -t "Jane Doe <jane@example.com>, bob@example.com" --cc lead@example.com -s "Weekly update"',
      'sky google:email:draft:new "..." -t jane@example.com -a work',
    ],
    params,
  }

  static formatApproval(input: Record<string, unknown>, output: OutputHandler): void {
    const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : '')
    output.log('')
    output.log(colors.bold('Create this Gmail draft? (saved to Drafts, never sent — you send it from Gmail)'))
    output.log('')
    output.log(`  Account: ${text('account') || '(default)'}`)
    output.log(`  To:      ${text('to') || '(none yet)'}`)
    if (text('cc')) output.log(`  Cc:      ${text('cc')}`)
    if (text('bcc')) output.log(`  Bcc:     ${text('bcc')}`)
    output.log(`  Subject: ${text('subject') || '(no subject)'}`)
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
      return CommandResult.fail(
        'Provide the message text, e.g. sky google:email:draft:new "Hi Jane, ..." -t jane@example.com -s "Atlas kickoff"',
      )
    }

    let to: GmailAddress[]
    let cc: GmailAddress[]
    let bcc: GmailAddress[]
    try {
      to = parseRecipients(args.to)
      cc = parseRecipients(args.cc)
      bcc = parseRecipients(args.bcc)
    } catch (err) {
      return CommandResult.fail((err as Error).message)
    }
    const subject = args.subject?.trim() || undefined

    let client
    try {
      client = await resolveGmailClient({
        secrets,
        requested: args.account,
        interactive: context.compositionDepth === 0,
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    let draft: GmailDraft
    try {
      draft = await createDraft(client, { to, cc, bcc, subject, html: renderEmailHtml(text) })
    } catch (err) {
      return CommandResult.error(err as Error, 'Gmail draft creation failed')
    }

    const url = draftUrl(client.email, draft.messageId)
    if (!args.noOpen) open(url).catch(() => undefined)

    const recipients = to.map((a) => a.address).join(', ')
    const report = `Draft saved (not sent) in ${client.email} — ${subject ?? '(no subject)'}${
      recipients ? ` to ${recipients}` : ''
    } — ${url}`
    output.log('')
    output.log(report)
    return CommandResult.success({ report, url })
  }
}
