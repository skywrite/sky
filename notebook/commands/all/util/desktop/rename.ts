import { Command, CommandResult } from '#commands/mod.ts'
import * as path from 'node:path'
import { readDir, rename } from '#shared/fs/mod.ts'
import { mkdir } from 'node:fs/promises'
import { REGEX_YMD_EXACT } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import skyPrompt, { SkyPromptStatus } from '#lib/gui/sky-prompt.ts'
import dayAttachmentsDir from '#shared/nbfs/dayAttachmentsDir.ts'
import { runCommand } from '#lib/sys/mod.ts'

export default class UtilDesktopRenameTask extends Command {
  static override description: CommandDescription = {
    name: 'util:desktop:rename',
    description: 'GUI Prompt to rename or move desktop files',
  }

  async run(commandArgs: CommandArgs): Promise<CommandResult> {
    const { config, output } = commandArgs.context

    // Check if sky-prompt is available in PATH
    const { code } = await runCommand('which', ['sky-prompt'])
    if (code !== 0) {
      return CommandResult.error('sky-prompt not found in PATH. Run setup/scripts/bin.sh to install bin utilities.')
    }

    output.log('Desktop renamer is starting...')

    const ignoreFiles = ['Thumbs.db', 'desktop.ini']

    const today = PlainDate.today()
    const ymd = today.toString()
    const { DIR_DESKTOP, DIR_ATTACHMENTS } = config

    // Today's attachments folder
    const todayAttachmentsDir = path.join(DIR_ATTACHMENTS as string, dayAttachmentsDir(today))

    for await (const entry of readDir(<string>DIR_DESKTOP)) {
      if (!entry.isFile) continue
      if (entry.name.startsWith('.')) continue
      if (entry.name.endsWith('.crdownload')) continue
      if (ignoreFiles.includes(entry.name)) continue

      output.log(`Found file "${entry.name}"...`)

      const srcPath = path.join(<string>DIR_DESKTOP, entry.name)
      const ext = path.extname(entry.name)
      const baseName = path.basename(entry.name, ext)

      // Skip files that already have a date prefix
      const dateMatch = REGEX_YMD_EXACT.exec(entry.name.slice(0, 10))
      if (dateMatch?.index === 0) {
        output.log(`Skipping ${entry.name} (already has date prefix)`)
        continue
      }

      const proposedNewFileName = `${ymd}_${entry.name}`
      // Select everything after the date prefix (YYYY-MM-DD_) up to the extension
      const selectStart = ymd.length + 1 // after "YYYY-MM-DD_"
      const selectLength = baseName.length

      const response = await skyPrompt({
        question: `Rename ${entry.name}?`,
        defaultAnswer: proposedNewFileName,
        selectRange: { start: selectStart, length: selectLength },
        action1: 'Move to Today',
        action2: 'Move to Date',
      })

      // Parse date from the answer text (for Move to Date)
      const answerDateMatch = REGEX_YMD_EXACT.exec(response.answer.slice(0, 10))
      const answerHasDate = answerDateMatch?.index === 0

      switch (response.status) {
        case SkyPromptStatus.Ok: {
          // Rename on desktop (use the text from the input)
          const newFileName = response.answer
          if (newFileName && newFileName !== entry.name) {
            const destPath = path.join(<string>DIR_DESKTOP, newFileName)
            await rename(srcPath, destPath)
            output.log(`Renamed ${entry.name} -> ${newFileName}`)
          }
          break
        }

        case SkyPromptStatus.Action1: {
          // Move to today's attachments folder (use filename from answer)
          await mkdir(todayAttachmentsDir, { recursive: true })
          const destPath = path.join(todayAttachmentsDir, response.answer)
          await rename(srcPath, destPath)
          output.log(`Moved ${entry.name} -> ${destPath}`)
          break
        }

        case SkyPromptStatus.Action2: {
          // Move to the date's attachments folder (parsed from answer text)
          if (answerHasDate && answerDateMatch) {
            const fileDate = new PlainDate(answerDateMatch[0])
            const fileDateAttachmentsDir = path.join(DIR_ATTACHMENTS as string, dayAttachmentsDir(fileDate))
            await mkdir(fileDateAttachmentsDir, { recursive: true })
            const destPath = path.join(fileDateAttachmentsDir, response.answer)
            await rename(srcPath, destPath)
            output.log(`Moved ${entry.name} -> ${destPath}`)
          } else {
            output.log(`No date found in "${response.answer}" - skipping`)
          }
          break
        }

        case SkyPromptStatus.Cancel:
          output.log(`Skipped ${entry.name}`)
          break

        case SkyPromptStatus.Error:
          output.error(`Error processing ${entry.name}`)
          break
      }
    }

    output.log('Desktop renamer has ended.\n')

    return CommandResult.success()
  }
}
