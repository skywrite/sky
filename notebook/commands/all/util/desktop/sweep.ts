import { Command, CommandResult } from '#commands/mod.ts'
import * as path from 'node:path'
import { readDir, rename } from '#shared/fs/mod.ts'
import { YMD } from '#universal/dates/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'

export default class UtilDesktopSweepTask extends Command {
  static override description: CommandDescription = {
    name: 'util:desktop:sweep',
    description: "Move desktop files into the day's attachments folder.",
  }

  async run(commandArgs: CommandArgs): Promise<CommandResult> {
    const { config, output } = commandArgs.context
    output.log('Desktop sweeper is starting...')

    const now = new Date()
    const { DIR_DESKTOP, DIR_ATTACHMENTS } = config

    const [year, month, day] = YMD(now)
    const attachmentsDir = path.join(DIR_ATTACHMENTS as string, year, month, day)

    for await (const entry of readDir(<string>DIR_DESKTOP)) {
      if (!entry.isFile) continue
      if (entry.name.startsWith('.')) continue

      output.log(`Found file "${entry.name}"...`)

      const srcPath = path.join(<string>DIR_DESKTOP, entry.name)
      const destPath = path.join(attachmentsDir, entry.name)

      await rename(srcPath, destPath)

      output.log(`Moved ${entry.name} -> ${destPath}`)
    }

    return CommandResult.success()
  }
}
