import * as path from 'node:path'
import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'

const params = {
  count: Flag.bool('Show count of occurrences for each tag'),
  limit: Flag.number('Limit the number of tags to display'),
  filter: Flag.string('Filter tags by pattern (case-insensitive)'),
  raw: Flag.bool('Output raw list without colors or metadata (for piping)'),
}

type Params = InferParams<typeof params>

export default class TagsListAllTask extends Command {
  static override description: CommandDescription = {
    name: 'tags:list:all',
    description: 'List all tags from markdown files in a sorted list.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { count: showCount, limit, filter, raw } = args

    const tagCounts = new Map<string, number>()
    let filesProcessed = 0
    let filesWithErrors = 0

    // Scan all markdown directories
    if (!raw) {
      output.log(colors.gray('Scanning for tags...\n'))
    }

    for (const dir of config.DIRS_MARKDOWN) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        filesProcessed++

        try {
          const contents = await readTextFile(entry.path)
          const doc = MarkdownDocument.fromMarkdown(contents)

          // Check if there was a YAML parsing error
          if (doc.yamlError) {
            filesWithErrors++
            continue // Skip files with YAML errors
          }

          // Collect tags from this document
          for (const tag of doc.tags) {
            const currentCount = tagCounts.get(tag) || 0
            tagCounts.set(tag, currentCount + 1)
          }
        } catch (error) {
          filesWithErrors++
          // Silently skip files that can't be read
        }
      }
    }

    if (tagCounts.size === 0) {
      if (!raw) {
        output.log(colors.yellow('No tags found in any markdown files.\n'))
      }
      return CommandResult.success()
    }

    // Convert to array and sort
    let tagsArray = Array.from(tagCounts.entries())

    // Apply filter if specified
    if (filter) {
      const filterLower = filter.toLowerCase()
      tagsArray = tagsArray.filter(([tag, _]) => tag.toLowerCase().includes(filterLower))

      if (tagsArray.length === 0) {
        if (!raw) {
          output.log(colors.yellow(`No tags found matching filter: "${filter}"\n`))
        }
        return CommandResult.success()
      }
    }

    // Sort by count (descending) if showing counts, otherwise alphabetically
    if (showCount) {
      tagsArray.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    } else {
      tagsArray.sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' }))
    }

    // Apply limit if specified
    if (limit && limit > 0) {
      tagsArray = tagsArray.slice(0, limit)
    }

    // Display results
    if (raw) {
      // Raw output - just the tags, one per line
      for (const [tag, _] of tagsArray) {
        output.log(tag)
      }
    } else {
      // Formatted output with colors and metadata
      output.log(colors.bold(colors.cyan('Tags found:\n')))

      if (showCount) {
        // Find the longest tag name for alignment
        const maxTagLength = Math.max(...tagsArray.map(([tag, _]) => tag.length))

        for (const [tag, count] of tagsArray) {
          const paddedTag = tag.padEnd(maxTagLength + 2)
          const countStr = String(count).padStart(4)
          output.log(
            `  ${colors.yellowBright(paddedTag)} ${colors.gray('│')} ${colors.cyan(countStr)} ${colors.gray(
              count === 1 ? 'file' : 'files',
            )}`,
          )
        }
      } else {
        for (const [tag, _] of tagsArray) {
          output.log(`  ${colors.yellowBright(tag)}`)
        }
      }

      // Summary
      output.log('')
      output.log(colors.gray('─'.repeat(40)))
      output.log(colors.green(`Total unique tags: ${tagCounts.size}`))
      output.log(colors.gray(`Files processed: ${filesProcessed}`))

      if (filesWithErrors > 0) {
        output.log(colors.yellow(`Files with errors (skipped): ${filesWithErrors}`))
      }

      if (filter) {
        output.log(colors.cyan(`Filtered results: ${tagsArray.length} tags matching "${filter}"`))
      }

      if (limit && tagCounts.size > limit) {
        output.log(colors.gray(`Showing top ${limit} of ${tagCounts.size} tags`))
      }

      output.log('')
    }

    return CommandResult.success()
  }
}
