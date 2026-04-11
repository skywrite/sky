import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { readTextFile, writeTextFile } from '#shared/fs/mod.ts'
import MarkdownDocument from '#shared/models/Markdown/Document/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import { stringify } from '#shared/yaml/mod.ts'

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
  output: Flag.string('Output file path (default: stdout)', { short: 'o' }),
  excludeSections: Flag.string('Semicolon-separated section headings to exclude'),
  noSeparators: Flag.boolean('Omit file separators between documents', { default: false }),
  noHeader: Flag.boolean('Omit YAML header', { default: false }),
  limit: Flag.number('Limit number of files'),
}

type Params = InferParams<typeof params>
type Result = { output: string; fileCount: number }

export default class MarkdownConcatTask extends Command {
  static override description: CommandDescription = {
    name: 'markdown:concat',
    description: 'Concatenate markdown files filtered by tags, rel, glob, or day.',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const {
      tags,
      tagsAll,
      rel,
      yaml,
      glob,
      day,
      output: outputFile,
      excludeSections: excludeSectionsInput,
      noSeparators,
      noHeader,
      limit,
    } = args

    // Parse exclude sections
    const excludeSections = excludeSectionsInput
      ? excludeSectionsInput
          .split(';')
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s !== '')
      : []

    // Get files via task composition
    const filterResult = await tasks.run<{ files: string[] }>('markdown:filter', {
      tags,
      tagsAll,
      rel,
      yaml,
      glob,
      day,
      limit,
    })

    if (filterResult.status !== 'success') {
      return CommandResult.error(new Error(filterResult.message || 'Filter failed'), 'Failed to filter files')
    }

    const files = filterResult.data?.files || []

    if (files.length === 0) {
      output.log('No files found matching the specified filters')
      return CommandResult.success()
    }

    output.log(`Concatenating ${files.length} files...`)

    // Build output parts
    const parts: string[] = []

    // Add YAML header
    if (!noHeader) {
      const yaml: Record<string, unknown> = {
        title: day ? `Day: ${day.ymd}` : 'Concatenated Markdown',
        created: PlainDate.today().ymd,
        fileCount: files.length,
      }

      const yamlHeader = ['---', stringify(yaml), '---'].join('\n')
      parts.push(yamlHeader)
    }

    // Process each file
    for (const filePath of files) {
      try {
        const content = await readTextFile(filePath)
        let doc = MarkdownDocument.fromMarkdown(content)

        // Apply section filtering if specified
        if (excludeSections.length > 0) {
          doc = doc.filterSections((heading) => {
            const headingLower = heading.text.toLowerCase()
            return !excludeSections.some((section) => headingLower.includes(section))
          })
        }

        // Add separator
        if (!noSeparators) {
          parts.push('------')
          parts.push(`File: ${filePath}`)
          parts.push('------')
        }

        parts.push(doc.toMarkdown())
      } catch (err) {
        output.log(`Warning: Could not read ${filePath}: ${(err as Error).message}`)
      }
    }

    const finalOutput = parts.join('\n')

    // Output to file or stdout
    if (outputFile) {
      await writeTextFile(outputFile, finalOutput)
      output.log(`Written to ${outputFile}`)
    } else {
      output.log(finalOutput)
    }

    return CommandResult.success({ output: finalOutput, fileCount: files.length })
  }
}
