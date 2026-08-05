import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'

interface FileMatch {
  path: string
  matchedTags: string[]
  matchCount: number
  modifiedTime: Date
}

const params = {
  pattern: Arg.string('Tag pattern(s) to match - can specify multiple patterns'),
  mode: Flag.string('Matching mode: all (AND), any (OR), exact (default: any)', { default: 'any' }),
  ignoreCase: Flag.boolean('Case-insensitive matching (default: case-sensitive)', { default: false }),
  showTags: Flag.boolean('Show which tags matched in each file', { default: false }),
  sort: Flag.string('Sort by: name, count, date (default: count)', { default: 'count' }),
  limit: Flag.number('Limit number of results'),
  raw: Flag.boolean('Output raw file paths for piping', { default: false }),
  countOnly: Flag.boolean('Show only the total count of matching files', { default: false }),
  verbose: Flag.boolean('Show detailed matching information', { default: false }),
}

type Params = InferParams<typeof params>

export default class TagsMatchTask extends Command {
  static override description: CommandDescription = {
    name: 'tags:match',
    description: 'Find files containing tags that match patterns (exact, prefix, or category)',
    params,
  }

  async run({ args, rawArgs, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { config, output } = context
    // Get patterns from raw args (everything after the task name)
    const rawPatterns = rawArgs._.slice(1) as string[]

    const { pattern, mode, ignoreCase, showTags, sort, limit, raw, countOnly, verbose } = args

    // Use raw patterns if multiple were provided, otherwise use the single pattern
    const patterns = rawPatterns.length > 1 ? rawPatterns : pattern ? [pattern] : []

    if (!patterns || patterns.length === 0) {
      output.error(colors.red('Error: At least one pattern is required'))
      return CommandResult.error('At least one pattern is required')
    }

    if (verbose && !raw) {
      output.log(colors.gray(`Searching for tags matching: ${patterns.join(', ')}`))
      output.log(colors.gray(`Mode: ${mode}`))
      output.log(colors.gray(`Case: ${ignoreCase ? 'insensitive' : 'sensitive'}\n`))
    }

    const matches: FileMatch[] = []

    // Search through markdown directories
    for (const dir of config.DIRS_MARKDOWN) {
      for await (const entry of walk(dir)) {
        if (path.extname(entry.path) !== '.md') continue

        try {
          const contents = await readTextFile(entry.path)
          const doc = MarkdownDocument.fromMarkdown(contents)

          if (doc.yamlError) continue

          const fileMatchedTags: string[] = []

          // Check each tag in the document
          for (const tag of doc.tags) {
            if (matchesPatterns(tag, patterns, mode as 'all' | 'any' | 'exact', ignoreCase)) {
              fileMatchedTags.push(tag)
            }
          }

          if (fileMatchedTags.length > 0) {
            const statInfo = await stat(entry.path)
            matches.push({
              path: entry.path,
              matchedTags: fileMatchedTags,
              matchCount: fileMatchedTags.length,
              modifiedTime: statInfo.mtime || new Date(),
            })
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }

    if (countOnly) {
      output.log(String(matches.length))
      return CommandResult.success()
    }

    if (matches.length === 0) {
      if (!raw) {
        output.log(colors.yellow('No files found matching the specified patterns'))
      }
      return CommandResult.success()
    }

    // Sort results
    switch (sort) {
      case 'name':
        matches.sort((a, b) => a.path.localeCompare(b.path))
        break
      case 'date':
        matches.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
        break
      case 'count':
      default:
        matches.sort((a, b) => b.matchCount - a.matchCount)
        break
    }

    // Apply limit if specified
    const results = limit ? matches.slice(0, limit) : matches

    // Output results
    if (raw) {
      results.forEach((match) => {
        const relativePath = path.relative(config.DIR_BASE, match.path)
        output.log(relativePath)
      })
    } else {
      output.log(colors.cyan(`Found ${matches.length} matching files${limit ? ` (showing ${results.length})` : ''}:\n`))

      results.forEach((match) => {
        const relativePath = path.relative(config.DIR_BASE, match.path)

        output.log(`  ${colors.yellowBright('•')} ${colors.white(relativePath)}`)

        if (showTags || verbose) {
          output.log(`    ${colors.gray('Matched tags:')} ${colors.yellow(match.matchedTags.join(', '))}`)
        }

        if (verbose) {
          output.log(`    ${colors.gray('Match count:')} ${match.matchCount}`)
          output.log(`    ${colors.gray('Modified:')} ${match.modifiedTime.toLocaleDateString()}`)
        }
      })

      output.log('')

      if (!raw && verbose) {
        output.log(colors.gray('─'.repeat(40)))
        output.log(colors.gray(`Total files: ${matches.length}`))
        output.log(colors.gray(`Total tag matches: ${matches.reduce((sum, m) => sum + m.matchCount, 0)}`))
      }
    }

    return CommandResult.success()
  }
}

function matchesPatterns(tag: string, patterns: string[], mode: 'all' | 'any' | 'exact', ignoreCase: boolean): boolean {
  // Normalize based on case sensitivity setting
  const normalizedTag = ignoreCase ? tag.toLowerCase() : tag

  if (mode === 'exact') {
    // Exact mode: tag must exactly match one of the patterns
    return patterns.some((pattern) => {
      const normalizedPattern = ignoreCase ? pattern.toLowerCase() : pattern
      return normalizedTag === normalizedPattern
    })
  }

  const patternMatches = patterns.map((pattern) => {
    const normalizedPattern = ignoreCase ? pattern.toLowerCase() : pattern

    // Check different matching types
    if (normalizedPattern.endsWith('/')) {
      // Prefix match: tag starts with pattern
      return normalizedTag.startsWith(normalizedPattern)
    } else if (normalizedPattern.includes('/')) {
      // Full path match: exact match or tag starts with pattern/
      return normalizedTag === normalizedPattern || normalizedTag.startsWith(normalizedPattern + '/')
    } else {
      // Category match: pattern appears anywhere in tag
      return normalizedTag.includes(normalizedPattern)
    }
  })

  if (mode === 'all') {
    // All patterns must match
    return patternMatches.every((match) => match)
  } else {
    // Any pattern matches (default)
    return patternMatches.some((match) => match)
  }
}
