import * as path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, walk, writeTextFile } from '#shared/fs/mod.ts'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import { exit } from '#shared/sys/mod.ts'

interface RenameResult {
  path: string
  renamed: boolean
  skipped: boolean
}

const params = {
  from: Flag.string('Tag to rename from', { required: true }),
  to: Flag.string('Tag to rename to', { required: true }),
  interactive: Flag.boolean('Open each file in VSCode for inspection before renaming'),
  dryRun: Flag.boolean('Preview changes without modifying files'),
  limit: Flag.number('Maximum number of files with the tag to process'),
}

type Params = InferParams<typeof params>

export default class TagsRenameTask extends Command {
  static override description: CommandDescription = {
    name: 'tags:rename',
    description: 'Rename tags in markdown files.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { from, to, interactive, dryRun, limit } = args

    if (!TagSet.isValidTag(to)) {
      output.error(colors.red(`Invalid tag name: "${to}". Tags cannot contain semicolons or be empty.`))
      exit(1)
    }

    const results: RenameResult[] = []
    const filesWithTag: string[] = []

    // First pass: find all files with the tag
    output.log(colors.gray('Scanning for tags...\n'))

    for (const dir of config.DIRS_MARKDOWN) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        const contents = await readTextFile(entry.path)
        const doc = MarkdownDocument.fromMarkdown(contents)

        // Check if there was a YAML parsing error
        if (doc.yamlError) {
          output.error(colors.red(`\n❌ YAML parsing error in file:`))
          output.error(colors.cyan(`   ${entry.path}`))
          output.error(colors.yellow(`\nError: ${doc.yamlError}`))
          output.error(colors.gray(`\nPlease fix the YAML frontmatter in this file before proceeding.`))
          output.error(
            colors.gray(`Hint: Check for missing quotes around values with special characters like colons.\n`),
          )
          exit(1)
        }

        if (doc.tags.has(from)) {
          filesWithTag.push(entry.path)
        }
      }
    }

    if (filesWithTag.length === 0) {
      output.log(colors.yellow(`No files found with tag "${from}"`))
      return CommandResult.success()
    }

    // Apply limit if specified
    let filesToProcess = filesWithTag
    if (limit && limit > 0 && filesWithTag.length > limit) {
      filesToProcess = filesWithTag.slice(0, limit)
      output.log(colors.cyan(`Found tag "${from}" in ${filesWithTag.length} file(s)`))
      output.log(colors.yellow(`Processing only first ${limit} file(s) due to --limit\n`))
    } else {
      output.log(colors.cyan(`Found tag "${from}" in ${filesWithTag.length} file(s)\n`))
    }

    if (dryRun) {
      output.log(colors.yellow('DRY RUN MODE - No files will be modified\n'))
    }

    // Process each file
    for (let i = 0; i < filesToProcess.length; i++) {
      const filePath = filesToProcess[i]
      const fileNum = `[${i + 1}/${filesToProcess.length}]`

      output.log(colors.bold(`${fileNum} ${filePath}`))

      const contents = await readTextFile(filePath)
      const doc = MarkdownDocument.fromMarkdown(contents)

      // Show where the tag appears
      const lines = contents.split('\n')
      for (let j = 0; j < lines.length; j++) {
        if (lines[j].includes('tags:') && lines[j].includes(from)) {
          output.log(`  Line ${j + 1}: ${lines[j].trim()}`)
        }
      }
      output.log('')

      let shouldRename = !interactive

      if (interactive) {
        output.log('Opening in VSCode...')
        await openEditor([{ file: filePath }])
        await delay(500)

        const response = await promptUser(output, '[r]ename / [s]kip / [q]uit: ')

        if (response.toLowerCase() === 'q') {
          output.log(colors.yellow('\nOperation cancelled by user'))
          return CommandResult.success()
        }

        shouldRename = response.toLowerCase() === 'r'

        if (!shouldRename) {
          output.log(colors.gray('Skipped\n'))
          results.push({ path: filePath, renamed: false, skipped: true })
          continue
        }
      }

      if (shouldRename && !dryRun) {
        try {
          // Re-read the file in case it was modified in VSCode
          const currentContents = await readTextFile(filePath)
          const currentDoc = MarkdownDocument.fromMarkdown(currentContents)

          if (currentDoc.tags.has(from)) {
            const newDoc = currentDoc.updateTags(currentDoc.tags.replace(from, to))
            await writeTextFile(filePath, newDoc.toMarkdown())
            output.log(colors.green('✓ Renamed\n'))
            results.push({ path: filePath, renamed: true, skipped: false })
          } else {
            output.log(colors.yellow('Tag no longer present (file may have been modified)\n'))
            results.push({ path: filePath, renamed: false, skipped: true })
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          output.error(colors.red(`Error processing file: ${errorMessage}\n`))
          results.push({ path: filePath, renamed: false, skipped: false })
        }
      } else if (shouldRename && dryRun) {
        output.log(colors.blue('Would rename (dry run)\n'))
        results.push({ path: filePath, renamed: true, skipped: false })
      }
    }

    // Summary
    output.log(colors.bold('\n=== Summary ==='))
    const renamed = results.filter((r) => r.renamed).length
    const skipped = results.filter((r) => r.skipped).length
    const failed = results.filter((r) => !r.renamed && !r.skipped).length

    if (dryRun) {
      output.log(colors.blue(`Would rename: ${renamed} file(s)`))
    } else {
      output.log(colors.green(`Renamed: ${renamed} file(s)`))
    }

    if (skipped > 0) {
      output.log(colors.yellow(`Skipped: ${skipped} file(s)`))
    }

    if (failed > 0) {
      output.log(colors.red(`Failed: ${failed} file(s)`))
    }

    if (limit && filesWithTag.length > limit) {
      output.log(
        colors.gray(
          `\nNote: ${filesWithTag.length - limit} additional file(s) with this tag were not processed due to --limit`,
        ),
      )
    }

    return CommandResult.success()
  }
}

async function promptUser(output: any, message: string): Promise<string> {
  output.log(message)
  const rl = createInterface({ input: process.stdin })
  for await (const line of rl) {
    rl.close()
    return line.trim()
  }
  return ''
}
