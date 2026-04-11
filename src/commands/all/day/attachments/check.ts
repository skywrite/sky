import * as path from 'node:path'
import { DIR_ATTACHMENTS, DIR_TIME } from '#config'
import { readDir, readTextFile, walk } from '#shared/fs/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { dayDir } from '#shared/nbfs/mod.ts'
import { Document } from '#shared/models/Markdown/mod.ts'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import colors from 'picocolors'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:attachments:check': { params: Params; result: { orphaned: string[] } }
  }
}

export default class DayAttachmentsCheckTask extends Command {
  static override description: CommandDescription = {
    name: 'day:attachments:check',
    description: 'Find orphaned attachments not referenced by any markdown file.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<{ orphaned: string[] }>> {
    const { output } = context
    const { day } = args

    const attachmentsPath = path.join(DIR_ATTACHMENTS, dayAttachmentsDir(day))
    const dayPath = path.join(DIR_TIME, dayDir(day))

    // Collect attachment files on disk
    const filesOnDisk = new Set<string>()
    try {
      for await (const entry of readDir(attachmentsPath)) {
        if (entry.isFile) filesOnDisk.add(entry.name)
      }
    } catch {
      // Directory doesn't exist — no attachments, nothing orphaned
      return CommandResult.success({ orphaned: [] })
    }

    if (filesOnDisk.size === 0) {
      return CommandResult.success({ orphaned: [] })
    }

    // Collect referenced attachment filenames from all markdown files
    const referenced = new Set<string>()
    for await (const entry of walk(dayPath, { exts: ['.md'] })) {
      if (!entry.isFile) continue
      const contents = await readTextFile(entry.path)
      const doc = Document.fromMarkdown(contents)
      for (const att of doc.attachments) {
        referenced.add(att.file)
      }
    }

    // Orphaned = on disk but not referenced
    const orphaned = [...filesOnDisk].filter((f) => !referenced.has(f)).sort()

    if (orphaned.length === 0) {
      output.log(colors.green(`\n  ✓ No orphaned attachments for ${day.ymd}\n`))
    } else {
      output.log(colors.yellow(`\n  Orphaned attachments for ${day.ymd}:`))
      for (const file of orphaned) {
        output.log(`    ${colors.yellowBright(file)}`)
      }
      output.log(
        colors.gray(`\n  ${orphaned.length} file${orphaned.length === 1 ? '' : 's'} not referenced by any markdown\n`),
      )
    }

    return CommandResult.success({ orphaned })
  }
}
