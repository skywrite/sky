import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import {
  AccountResolutionError,
  EXPORT_MIME,
  GoogleApiError,
  conversionTarget,
  ensureConvertedTwin,
  exportFile,
  getFile,
  isLikelyFileId,
  parseGoogleUrl,
  workspaceKind,
} from '#lib/google/mod.ts'
import type { DriveFile } from '#lib/google/mod.ts'
import { resolveGoogleClient } from './lib/resolveClient.ts'

const params = {
  target: Arg.string('Google Docs/Sheets/Slides/Drive URL (native or an uploaded Office file), or a bare file id'),
  account: Flag.string('Google account (email or unique part of it)', { short: 'a' }),
}

type Params = InferParams<typeof params>
type Result = { account: string; file: DriveFile; content: string; convertedFrom?: DriveFile }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'google:read': { params: Params; result: Result }
  }
}

export default class GoogleReadTask extends Command {
  static override description: CommandDescription = {
    name: 'google:read',
    description:
      'Read a Google Doc (markdown), Sheet (csv, first tab) or Slides (text) from Drive; an uploaded .xlsx/.docx/.pptx is read through its native Google twin, converted once and reused.',
    usage: ['sky google:read <url-or-file-id>', 'sky google:read <url> -a work'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, secrets } = context

    if (!args.target) {
      return CommandResult.fail('Provide a Google file URL or id')
    }
    const parsed = parseGoogleUrl(args.target) ?? (isLikelyFileId(args.target) ? { fileId: args.target } : null)
    if (!parsed) {
      return CommandResult.fail(`Not a Google file URL or id: ${args.target}`)
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

    let file: DriveFile
    try {
      file = await getFile(client, parsed.fileId)
    } catch (err) {
      if (err instanceof GoogleApiError && err.status === 404) {
        return CommandResult.fail(
          `File not found in ${client.email}'s Drive. If it lives in another account, pass --account.`,
        )
      }
      throw err
    }

    let kind = workspaceKind(file.mimeType)
    if (!kind && !conversionTarget(file.mimeType)) {
      return CommandResult.fail(
        `"${file.name}" is not a Doc/Sheet/Slides file or an upload Drive can convert (${file.mimeType})`,
      )
    }

    let convertedFrom: DriveFile | undefined
    if (!kind) {
      // Uploaded Office/csv/pdf: Drive's "Save as", done once and reused — the twin is what exports.
      const converted = await ensureConvertedTwin(client, file)
      convertedFrom = file
      file = converted.twin
      kind = converted.kind
    }

    const content = await exportFile(client, file.id, EXPORT_MIME[kind])
    output.log(content)

    return CommandResult.success({ account: client.email, file, content, convertedFrom })
  }
}
