import { stat } from 'node:fs/promises'
import * as path from 'node:path'
import colors from 'picocolors'
import picomatch from 'picomatch'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, walk } from '#shared/fs/mod.ts'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'
import TagSet from '#shared/models/TagSet/mod.ts'
import dayDir from '#shared/nbfs/dayDir.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

interface FileMatch {
  path: string
  relativePath: string
  matchedTags: string[]
  matchedRel: string[]
  matchedYaml: string[]
  modifiedTime: Date
}

interface YamlFilter {
  field: string
  value: string
}

function parseYamlFilter(input: string): YamlFilter | null {
  const colonIndex = input.indexOf(':')
  if (colonIndex === -1) return null
  return {
    field: input.slice(0, colonIndex).trim(),
    value: input.slice(colonIndex + 1).trim(),
  }
}

function matchYamlFieldSingle(yamlValue: unknown, searchLower: string): boolean {
  if (yamlValue === undefined || yamlValue === null) {
    return false
  }

  if (typeof yamlValue === 'string') {
    return yamlValue.toLowerCase().includes(searchLower)
  }

  if (Array.isArray(yamlValue)) {
    return yamlValue.some((item) => {
      if (typeof item === 'string') {
        return item.toLowerCase().includes(searchLower)
      }
      return String(item).toLowerCase().includes(searchLower)
    })
  }

  // For numbers, booleans, etc.
  return String(yamlValue).toLowerCase().includes(searchLower)
}

function matchYamlField(yamlValue: unknown, searchValue: string): boolean {
  // Support semicolon-separated values for OR logic
  const searchValues = searchValue
    .split(';')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s !== '')

  if (searchValues.length === 0) return false

  // OR logic: match if any search value matches
  return searchValues.some((search) => matchYamlFieldSingle(yamlValue, search))
}

const params = {
  tags: Flag.string('Semicolon-separated tags to match (ANY)'),
  tagsAll: Flag.string('Semicolon-separated tags to match (ALL required)'),
  rel: Flag.string('Match files with this value in rel field'),
  yaml: Flag.string('Filter by YAML field (format: "field:value", use | for multiple)'),
  glob: Flag.string('Filter to paths matching glob pattern (relative to SKY_DIR)'),
  day: Flag.plainDate('Get all files for a specific day (e.g., today, 2025-01-02, or 02)', {
    parse: (input: string) => {
      if (input.toLowerCase() === 'today') {
        return new PlainDate()
      }
      return parsePartialDate(input)
    },
  }),
  raw: Flag.boolean('Output just file paths (for piping)', { default: false }),
  limit: Flag.number('Limit number of results'),
  sort: Flag.string('Sort by: name, date (default: name)', { default: () => 'name' }),
  showMatches: Flag.boolean('Show which tags/rel matched', { default: false }),
}

type Params = InferParams<typeof params>
type Result = { files: string[] }

export default class MarkdownFilterTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:filter',
    description: 'Filter markdown files by tags, rel, glob, or day.',
    descriptionLong: [
      'Scans Notebook/ for markdown files matching tags, rel, YAML fields, glob patterns, or day.',
      'Returns file paths for use standalone or via task composition with markdown:concat.',
      '',
      'YAML filter syntax: --yaml "field:value" for single field, "who:Alice;Drew" for OR',
      'within field (semicolon), "who:Alice|medium:Phone" for AND across fields (pipe).',
      '',
      'Matching logic: String values use case-insensitive substring match. Array values match',
      'if any element contains search value. Pipe = AND (all must match), semicolon = OR.',
    ],
    usage: [
      'sky markdown:filter --day today                    # All files for today',
      'sky markdown:filter --tags "Work; AI"              # ANY of these tags',
      'sky markdown:filter --tags-all "Work; AI"          # ALL of these tags',
      'sky markdown:filter --rel "bob"                    # rel field contains "bob"',
      'sky markdown:filter --yaml "who:Alice"            # YAML field match',
      'sky markdown:filter --yaml "who:Alice|medium:Phone"  # AND across fields',
      'sky markdown:filter --glob "notes/**"              # path pattern',
      'sky markdown:filter --raw                          # output paths only',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const {
      tags: tagsInput,
      tagsAll: tagsAllInput,
      rel,
      yaml: yamlInput,
      glob,
      day,
      raw,
      limit,
      sort,
      showMatches,
    } = args

    // Parse tag inputs
    const tags = tagsInput ? TagSet.fromString(tagsInput) : undefined
    const tagsAll = tagsAllInput ? TagSet.fromString(tagsAllInput) : undefined

    // Parse yaml filters (pipe-separated for multiple: "who:Bob|medium:Phone")
    const yamlFilters: YamlFilter[] = []
    if (yamlInput) {
      // Split on pipe to get individual filters
      const filterStrings = String(yamlInput)
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      for (const input of filterStrings) {
        const filter = parseYamlFilter(input)
        if (filter) {
          yamlFilters.push(filter)
        } else {
          output.log(colors.yellow(`Warning: Invalid yaml filter format "${input}", expected "field:value"`))
        }
      }
    }

    // Determine directories to search
    let searchDirs: string[]

    if (day) {
      // If day specified, only search that day's directory
      const dayDirPath = path.join(<string>config.DIR_TIME, dayDir(day))
      searchDirs = [dayDirPath]
    } else {
      searchDirs = config.DIRS_MARKDOWN
    }

    // Compile glob pattern if provided
    let globMatch: ((str: string) => boolean) | undefined
    if (glob) {
      globMatch = picomatch(glob)
    }

    const matches: FileMatch[] = []

    // Search through directories
    for (const dir of searchDirs) {
      try {
        for await (const entry of walk(dir, { includeDirs: false, exts: ['.md'] })) {
          const relativePath = path.relative(<string>config.DIR_BASE, entry.path)

          // Apply glob filter
          if (globMatch && !globMatch(relativePath)) {
            continue
          }

          try {
            const contents = await readTextFile(entry.path)
            const doc = MarkdownDocument.fromMarkdown(contents)

            if (doc.yamlError) continue

            // Check tag filters
            const matchedTags: string[] = []
            if (tags) {
              // ANY mode: at least one tag must match
              let hasMatch = false
              for (const tag of doc.tags) {
                if (tags.has(tag)) {
                  matchedTags.push(tag)
                  hasMatch = true
                }
              }
              if (!hasMatch) continue
            }

            if (tagsAll) {
              // ALL mode: every specified tag must be present
              let allMatch = true
              for (const requiredTag of tagsAll) {
                if (doc.tags.has(requiredTag)) {
                  matchedTags.push(requiredTag)
                } else {
                  allMatch = false
                  break
                }
              }
              if (!allMatch) continue
            }

            // Check rel filter
            const matchedRel: string[] = []
            if (rel) {
              if (!doc.rel.has(rel)) continue
              matchedRel.push(rel)
            }

            // Check yaml filters (AND logic - all must match)
            const matchedYaml: string[] = []
            if (yamlFilters.length > 0) {
              let allYamlMatch = true
              for (const filter of yamlFilters) {
                const yamlValue = doc.yaml[filter.field]
                if (matchYamlField(yamlValue, filter.value)) {
                  matchedYaml.push(`${filter.field}:${filter.value}`)
                } else {
                  allYamlMatch = false
                  break
                }
              }
              if (!allYamlMatch) continue
            }

            // File passed all filters
            const statInfo = await stat(entry.path)
            matches.push({
              path: entry.path,
              relativePath,
              matchedTags,
              matchedRel,
              matchedYaml,
              modifiedTime: statInfo.mtime || new Date(),
            })
          } catch {
            // Skip files that can't be read
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }

    // Sort results
    switch (sort) {
      case 'date':
        matches.sort((a, b) => b.modifiedTime.getTime() - a.modifiedTime.getTime())
        break
      case 'name':
      default:
        matches.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
        break
    }

    // Apply limit
    const results = limit ? matches.slice(0, limit) : matches

    // Output
    if (raw) {
      results.forEach((match) => output.log(match.relativePath))
    } else if (results.length === 0) {
      output.log(colors.yellow('No files found matching the specified filters'))
    } else {
      output.log(colors.cyan(`Found ${matches.length} files${limit ? ` (showing ${results.length})` : ''}:\n`))

      results.forEach((match) => {
        output.log(`  ${colors.yellowBright('\u2022')} ${colors.white(match.relativePath)}`)

        if (showMatches) {
          if (match.matchedTags.length > 0) {
            output.log(`    ${colors.gray('Tags:')} ${colors.yellow(match.matchedTags.join(', '))}`)
          }
          if (match.matchedRel.length > 0) {
            output.log(`    ${colors.gray('Rel:')} ${colors.yellow(match.matchedRel.join(', '))}`)
          }
          if (match.matchedYaml.length > 0) {
            output.log(`    ${colors.gray('YAML:')} ${colors.yellow(match.matchedYaml.join(', '))}`)
          }
        }
      })

      output.log('')
    }

    // Return file paths for task composition
    return CommandResult.success({
      files: results.map((m) => m.path),
    })
  }
}
