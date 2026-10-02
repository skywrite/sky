/**
 * google:read — one page of a Google Doc (markdown), Sheet (csv, first
 * tab) or Slides (text), by URL or file id. The read half of Google
 * Workspace in ai:chat: auto-approved and sub-agent-free, so "what does
 * the doc say" costs one tool call — google:agent stays the door for
 * edits and new files.
 */

import { AIChatTool } from '#commands/lib/AIChatTool.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, GoogleApiError, resolveFileRef } from '#lib/google/mod.ts'
import type { WorkspaceKind } from '#lib/google/mod.ts'
import { readWorkspaceFile } from './lib/readWorkspaceFile.ts'
import { accountSwitchNote, findOwningGoogleClient } from './lib/resolveClient.ts'

const params = {
  target: Arg.string('Google Docs/Sheets/Slides/Drive URL (native or an uploaded Office file), or a bare file id'),
  account: Flag.string(
    'Google account to try first (email or unique part of it); left out, Sky finds the connected account that can open the file',
    { short: 'a' },
  ),
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
      'calls. The file is read from whichever connected account can open it; `account` in the result says ' +
      'which. Reads only; to edit or create files, use google:agent.',
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

    // A URL copied from a specific tab reads that tab; an explicit tabId wins.
    const tabId = args.tabId ?? parsed.tabId

    // Drive answers 404 both for "gone" and "wrong account", so the file is
    // read from whichever connected account can open it.
    let found
    try {
      found = await findOwningGoogleClient({
        secrets,
        requested: args.account,
        what: `The file ${parsed.fileId}`,
        attempt: (client) => readWorkspaceFile(client, { fileId: parsed.fileId, tabId, offset: args.offset }),
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      if (err instanceof GoogleApiError) {
        return CommandResult.fail(`Google API error reading ${parsed.fileId}: ${err.message}`)
      }
      throw err
    }
    const { client, value: outcome } = found
    if (!outcome.ok) return CommandResult.fail(outcome.message)

    const { read } = outcome
    const notes: string[] = []
    const switched = accountSwitchNote(found)
    if (switched) notes.push(switched)
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
