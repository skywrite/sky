import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { AccountResolutionError, WORKSPACE_MIME, searchFiles, workspaceKind } from '#lib/google/mod.ts'
import type { DriveFile, WorkspaceKind } from '#lib/google/mod.ts'
import { resolveGoogleClient } from './lib/resolveClient.ts'

const params = {
  query: Arg.string('Text to match against file names and content (omit to list recent files)', { optional: true }),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
  type: Flag.string('Limit to a kind: doc | sheet | slides', { short: 't' }),
  limit: Flag.string('Maximum results', { default: () => '10' }),
}

type Params = InferParams<typeof params>
type Result = { account: string; files: DriveFile[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:find': { params: Params; result: Result }
  }
}

export default class GoogleFindTask extends Command {
  static override description: CommandDescription = {
    name: 'google:find',
    description: 'Find Google Docs/Sheets/Slides in Drive, most recently modified first.',
    usage: ['sky google:find "quarterly report"', 'sky google:find budget -t sheet', 'sky google:find -a work'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    let kind: WorkspaceKind | undefined
    if (args.type) {
      if (!(args.type in WORKSPACE_MIME)) {
        return CommandResult.fail(`Invalid --type "${args.type}". Use: doc, sheet, slides`)
      }
      kind = args.type as WorkspaceKind
    }
    const limit = Number.parseInt(args.limit ?? '10', 10)
    if (!Number.isFinite(limit) || limit < 1) {
      return CommandResult.fail(`Invalid --limit "${args.limit}"`)
    }

    let client
    try {
      client = await resolveGoogleClient({
        secrets,
        requested: args.account,
        interactive: context.compositionDepth === 0,
      })
    } catch (err) {
      if (err instanceof AccountResolutionError) return CommandResult.fail(err.message)
      throw err
    }

    const files = await searchFiles(client, { text: args.query, kind, limit })

    if (files.length === 0) {
      output.log(`No matches in ${client.email}'s Drive.`)
    }
    for (const file of files) {
      const kindLabel = workspaceKind(file.mimeType) ?? file.mimeType
      const modified = file.modifiedTime ? `  ${file.modifiedTime.slice(0, 10)}` : ''
      output.log(`${file.name}  [${kindLabel}]${modified}  ${file.webViewLink ?? file.id}`)
    }

    return CommandResult.success({ account: client.email, files })
  }
}
