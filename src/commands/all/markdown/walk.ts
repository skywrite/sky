import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/mod.ts'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'
import { consoleSize, writeStdout } from '#shared/sys/mod.ts'

export default class MarkdownWalkTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:walk',
    description: 'Walk all Markdown outputting file names. Ensures Markdown parser is working.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { config, output } = context
    output.log('')

    const { columns } = consoleSize()

    for (const dir of config.DIRS_MARKDOWN) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        const contents = await readTextFile(entry.path)
        let isErr = false
        let doc
        try {
          doc = MarkdownDocument.fromMarkdown(contents)
        } catch (err) {
          const error = err as Error
          isErr = true
          output.error(`${entry.path}... ${colors.red('FAIL')}`)
          output.error(`Error: ${error.message || String(err)}`)
          if (error.stack) output.log(error.stack)
        }

        // Check for YAML parsing errors even if no exception was thrown
        if (!isErr && doc?.yamlError) {
          isErr = true
          output.error(`${entry.path}... ${colors.red('FAIL')}`)
          output.error(`YAML Parse Error: ${doc.yamlError}`)
        }

        if (!isErr) {
          outputInPlace(`${entry.path}... ${colors.green('OK')}`)
        }
      }
    }

    output.log('\n')

    return CommandResult.success()
  }
}

function outputInPlace(msg: string) {
  writeStdout('\x1b[2K\x1b[0G')
  writeStdout(msg)
}

function getLineCount(text: string, terminalWidth: number): number {
  const lines = text.split('\n')
  let lineCount = 0
  for (const line of lines) {
    lineCount += Math.max(1, Math.ceil(line.length / terminalWidth))
  }
  return lineCount
}

function clearPreviousOutput(lineCount: number) {
  // Move cursor up and clear previous lines
  for (let i = 0; i < lineCount; i++) {
    writeStdout('\x1b[1A') // Move cursor up by one line
    writeStdout('\x1b[2K') // Clear the entire line
  }
}
