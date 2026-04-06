import { Command, CommandResult } from '#commands/mod.ts'
import colors from 'picocolors'
import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import MarkdownDoc from '#shared/models/Markdown/Document/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'

export default class UtilCheckMarkdownTask extends Command {
  static override description: CommandDescription = {
    name: 'util:check:markdown',
    description: 'Check all Markdown can be parsed.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { config, output } = context
    const DIRS = <string[]>config.DIRS_MARKDOWN

    console.time('Total')

    for (const dir of DIRS) {
      const name = path.basename(dir).toUpperCase()
      output.log('\n' + colors.bold(colors.green(name)))

      console.time(name)
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        const contents = await readTextFile(entry.path)

        try {
          MarkdownDoc.fromMarkdown(contents)
        } catch (err) {
          output.error(colors.red(`\n  ${entry.path}\n`))
          output.error(err instanceof Error ? err.message : String(err))
          return CommandResult.error(err as Error, `Failed to parse markdown: ${entry.path}`)
        }
      }
      output.log('')
      console.timeEnd(name)
    }

    output.log('\n')
    console.timeEnd('Total')
    output.log('')

    return CommandResult.success()
  }
}
