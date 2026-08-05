import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import { Command, CommandResult, dayArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { dayFile } from '#lib/nbfs/mod.ts'
import { exists, outputFile } from '#shared/fs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'

const params = {
  day: dayArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:open': { params: Params; result: undefined }
  }
}

export default class DayOpenTask extends Command {
  static override description: CommandDescription = {
    name: 'day:open',
    description: 'Open day file.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config } = context
    const { day } = args

    const file = path.join(<string>config.DIR_TIME, dayFile(day))

    if (!(await exists(file))) {
      const dayObj = DayDocument.createPastDay(day)
      await outputFile(file, dayObj.toMarkdown())
    }

    openEditor([{ file }])

    await delay(500)
    return CommandResult.success()
  }
}
