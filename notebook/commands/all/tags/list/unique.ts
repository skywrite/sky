import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import * as path from 'node:path'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import colors from 'picocolors'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'

const params = {
  count: Flag.boolean('Show count of tags containing each word'),
  limit: Flag.number('Limit the number of words to display'),
  filter: Flag.string('Filter words by pattern (case-insensitive)'),
  raw: Flag.boolean('Output raw list without colors or metadata (for piping)'),
}

type Params = InferParams<typeof params>

export default class TagsListUniqueTask extends Command {
  static override description: CommandDescription = {
    name: 'tags:list:unique',
    description: 'List unique words from all tags by splitting on delimiters.',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    const { count: showCount, limit, filter, raw } = args

    // Map to store unique words and count of tags they appear in
    const wordCounts = new Map<string, number>()
    // Map to track lowercase version for case-insensitive deduplication
    const lowercaseToOriginal = new Map<string, string>()

    let filesProcessed = 0
    let tagsProcessed = 0

    // Scan all markdown directories
    if (!raw) {
      output.log(colors.gray('Scanning for tags and extracting unique words...\n'))
    }

    for (const dir of config.DIRS_MARKDOWN) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        filesProcessed++

        try {
          const contents = await readTextFile(entry.path)
          const doc = MarkdownDocument.fromMarkdown(contents)

          // Skip files with YAML errors
          if (doc.yamlError) continue

          // Process each tag
          for (const tag of doc.tags) {
            tagsProcessed++

            // Split by both / and : delimiters
            const tokens = tag.split(/[/:]/g)

            for (const token of tokens) {
              const trimmed = token.trim()
              if (!trimmed) continue // Skip empty tokens

              const lowercase = trimmed.toLowerCase()

              // Check if we've seen this word before (case-insensitive)
              if (lowercaseToOriginal.has(lowercase)) {
                // Use the existing version and increment count
                const existing = lowercaseToOriginal.get(lowercase)!
                wordCounts.set(existing, (wordCounts.get(existing) || 0) + 1)
              } else {
                // First time seeing this word, add it
                lowercaseToOriginal.set(lowercase, trimmed)
                wordCounts.set(trimmed, 1)
              }
            }
          }
        } catch {
          // Silently skip files that can't be read
        }
      }
    }

    if (wordCounts.size === 0) {
      if (!raw) {
        output.log(colors.yellow('No unique words found in any tags.\n'))
      }
      return CommandResult.success({ words: [] })
    }

    // Convert to array for sorting and filtering
    let wordsArray = Array.from(wordCounts.entries())

    // Apply filter if specified
    if (filter) {
      const filterLower = filter.toLowerCase()
      wordsArray = wordsArray.filter(([word, _]) => word.toLowerCase().includes(filterLower))

      if (wordsArray.length === 0) {
        if (!raw) {
          output.log(colors.yellow(`No words found matching filter: "${filter}"\n`))
        }
        return CommandResult.success({ words: [] })
      }
    }

    // Sort by count (descending) if showing counts, otherwise alphabetically (case-insensitive)
    if (showCount) {
      wordsArray.sort((a, b) => b[1] - a[1] || a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
    } else {
      wordsArray.sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
    }

    // Apply limit if specified
    if (limit && limit > 0) {
      wordsArray = wordsArray.slice(0, limit)
    }

    // Display results
    if (raw) {
      // Raw output - just the words, one per line
      for (const [word, _] of wordsArray) {
        output.log(word)
      }
    } else {
      // Formatted output with colors and metadata
      output.log(colors.bold(colors.cyan('Unique words from tags:\n')))

      if (showCount) {
        // Find the longest word for alignment
        const maxWordLength = Math.max(...wordsArray.map(([word, _]) => word.length))

        for (const [word, count] of wordsArray) {
          const paddedWord = word.padEnd(maxWordLength + 2)
          const countStr = String(count).padStart(4)
          output.log(
            `  ${colors.yellowBright(paddedWord)} ${colors.gray('│')} ${colors.cyan(countStr)} ${colors.gray(
              count === 1 ? 'tag' : 'tags',
            )}`,
          )
        }
      } else {
        for (const [word, _] of wordsArray) {
          output.log(`  ${colors.yellowBright(word)}`)
        }
      }

      // Summary
      output.log('')
      output.log(colors.gray('─'.repeat(40)))
      output.log(colors.green(`Total unique words: ${wordCounts.size}`))
      output.log(colors.gray(`Tags processed: ${tagsProcessed}`))
      output.log(colors.gray(`Files processed: ${filesProcessed}`))

      if (filter) {
        output.log(colors.cyan(`Filtered results: ${wordsArray.length} words matching "${filter}"`))
      }

      if (limit && wordCounts.size > limit) {
        output.log(colors.gray(`Showing top ${limit} of ${wordCounts.size} words`))
      }

      output.log('')
    }

    // Return the words in the CommandResult data for programmatic access
    return CommandResult.success({ words: wordsArray.map(([word, _]) => word) })
  }
}
