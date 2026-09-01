/**
 * google:read — one page of a Google Doc (markdown), Sheet (csv, first
 * tab) or Slides (text), by URL or file id. The read half of Google
 * Workspace in ai:chat: auto-approved and sub-agent-free, so "what does
 * the doc say" costs one tool call — google:agent stays the door for
 * edits and new files.
 */

import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandPlatform, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, GoogleApiError, listAccountEmails, resolveFileRef } from '#lib/google/mod.ts'
import type { WorkspaceKind } from '#lib/google/mod.ts'
import { probeAccountsForFile } from './lib/probeAccounts.ts'
import { readWorkspaceFile } from './lib/readWorkspaceFile.ts'
import { resolveGoogleClient } from './lib/resolveClient.ts'

const params = {
  target: Arg.string('Google Docs/Sheets/Slides/Drive URL (native or an uploaded Office file), or a bare file id'),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  tabId: Flag.string('Docs only: read a single tab by its tabId (a whole-file read lists them), as plain text'),
  offset: Flag.number('Character offset a truncated read said to continue from'),
}

type Params = InferParams<typeof params>

type ReadTab = { tabId?: string; title?: string }
type Result = {
  account: string
  /** The readable file — the native twin's id when the target is an uploaded Office file. */
  id: string
  name: string
  kind: WorkspaceKind
  url?: string
  content: string
  /** Docs with several tabs: the tab map (a whole-file read covers all of them). */
  tabs?: ReadTab[]
  /** Set when a single tab was read. */
  tab?: ReadTab
  note?: string
  /** External files this read concerned — the chat host records them on the transcript. */
  files: Array<{ title: string; url: string }>
}

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:read': { params: Params; result: Result }
  }
}

@AIChatTool({ needsApproval: false })
export default class GoogleReadTask extends Command {
  static override description: CommandDescription = {
    name: 'google:read',
    description:
      'Read a Google Doc (markdown), Sheet (csv, first tab) or Slides (text) by URL or file id. Long files ' +
      'return 40k chars per call — when the content ends with a [Truncated …] marker, call again with the ' +
      'offset it names. A Doc with several tabs exports ALL of them, each opening with its tab title as a ' +
      '# heading, plus a tabs list mapping titles to tabIds; pass tabId to read one tab as plain text. An ' +
      'uploaded Office file is read through its native Google twin — use the returned id for follow-up ' +
      'calls. Reads only; to edit or create files, use google:agent.',
    usage: [
      'sky google:read <url-or-file-id>',
      'sky google:read <url> --offset 40000',
      'sky google:read <doc-url> --tab-id t.abc123',
      'sky google:read <url> -a work',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    if (!args.target) {
      return CommandResult.fail('Provide a Google file URL or id')
    }
    const parsed = resolveFileRef(args.target)
    if (!parsed) {
      return CommandResult.fail(`Not a Google file URL or id: ${args.target}`)
    }

    let client
    try {
      client = await resolveGoogleClient({
        secrets,
        requested: args.account,
        interactive: context.platform === CommandPlatform.Console && context.compositionDepth === 0,
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    // A URL copied from a specific tab reads that tab; an explicit tabId wins.
    const tabId = args.tabId ?? parsed.tabId

    let outcome
    try {
      outcome = await readWorkspaceFile(client, { fileId: parsed.fileId, tabId, offset: args.offset })
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) {
        // Drive answers 404 both for "gone" and "wrong account" — probe the
        // other stored accounts so the error names the one that can see it.
        const others = (await listAccountEmails(secrets)).filter((email) => email !== client.email)
        const visibleTo = await probeAccountsForFile(secrets, others, parsed.fileId)
        return CommandResult.fail(
          visibleTo.length > 0
            ? `The file is not visible to ${client.email}, but ${visibleTo.join(' and ')} can see it. Retry with account ${visibleTo[0]}`
            : `File not found for ${client.email}: ${parsed.fileId}. Check the URL — or connect the account that owns it (sky google:auth).`,
        )
      }
      if (err instanceof GoogleApiError) {
        return CommandResult.fail(`Google API error reading ${parsed.fileId}: ${err.message}`)
      }
      throw err
    }
    if (!outcome.ok) return CommandResult.fail(outcome.message)

    const { read } = outcome
    const notes: string[] = []
    if (read.convertedFrom) {
      notes.push(
        `"${read.convertedFrom.name}" is an uploaded file Drive stores as-is; this content is its native Google ${read.kind} twin "${read.file.name}" (${read.twinCreated ? 'converted just now' : 'converted earlier, reused'}). Use id ${read.file.id} for every follow-up call.`,
      )
    }
    if (read.tabs) {
      notes.push(
        `This doc has ${read.tabs.length} tabs — the export includes all of them, each opening with its tab title as a # heading. Tab-targeted reads and edits need the tabIds listed.`,
      )
    }

    const files: Array<{ title: string; url: string }> = []
    const requested = read.convertedFrom ?? read.file
    if (requested.webViewLink) files.push({ title: requested.name, url: requested.webViewLink })
    if (read.convertedFrom && read.twinCreated && read.file.webViewLink) {
      files.push({ title: read.file.name, url: read.file.webViewLink })
    }

    output.log(read.content)

    return CommandResult.success({
      account: client.email,
      id: read.file.id,
      name: read.file.name,
      kind: read.kind,
      url: read.file.webViewLink,
      content: read.content,
      tabs: read.tabs?.map((t) => ({ tabId: t.tabId, title: t.title })),
      tab: read.tab,
      note: notes.length > 0 ? notes.join(' ') : undefined,
      files,
    })
  }
}
