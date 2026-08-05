import { mkdir } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { runCommand } from '#lib/sys/mod.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:attachments:open': { params: Params; result: undefined }
  }
}

export default class DayAttachmentsOpenTask extends Command {
  static override description: CommandDescription = {
    name: 'day:attachments:open',
    description: 'Open attachments day folder.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { day } = args
    const dir = path.join(config.DIR_ATTACHMENTS as string, dayAttachmentsDir(day))

    // create dir if doesn't exist
    await mkdir(dir, { recursive: true })

    output.log(`\n  Opening ${dir}...\n`)

    await runCommand('open', [dir])

    return CommandResult.success()
  }
}
