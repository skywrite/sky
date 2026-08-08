import colors from 'picocolors'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_IDEAS } from '#config'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import IdeaDocument from '#shared/models/Idea/mod.ts'
import IdeaStore, { type IdeaStatus } from '#shared/models/Store/IdeaStore/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  all: Flag.bool('Show all ideas (default: draft only)', {
    short: 'A',
    default: false,
  }),
  exploring: Flag.bool('Show only exploring ideas', {
    short: 'e',
    default: false,
  }),
  actioned: Flag.bool('Show only actioned ideas', {
    short: 'a',
    default: false,
  }),
  archived: Flag.bool('Show only archived ideas', {
    default: false,
  }),
  tag: Flag.string('Filter by tag', {
    short: 't',
    optional: true,
  }),
  year: Flag.string('Filter by year (e.g., 2026)', {
    short: 'y',
    optional: true,
  }),
}

type Params = InferParams<typeof params>

interface IdeaInfo {
  name: string
  title: string
  status: IdeaStatus
  created: string
  tags: string
  filePath: string
}

type Result = { ideas: IdeaInfo[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'ideas:list': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class IdeasListTask extends Command {
  static override description: CommandDescription = {
    name: 'ideas:list',
    description: 'List ideas with optional filtering.',
    descriptionLong: [
      'Lists all ideas from the ideas directory.',
      'Supports filtering by status (draft/exploring/actioned/archived), tags, and year.',
    ],
    usage: [
      'sky ideas:list                   # List draft ideas (default)',
      'sky ideas:list --all             # List all ideas',
      'sky ideas:list --exploring       # List only exploring ideas',
      'sky ideas:list --actioned        # List only actioned ideas',
      'sky ideas:list --archived        # List only archived ideas',
      'sky ideas:list --tag ai          # Filter by tag',
      'sky ideas:list --year 2026       # Filter by year',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { all, exploring, actioned, archived, tag, year } = args
    // Default to draft-only unless a specific filter is set
    const draft = !all && !exploring && !actioned && !archived

    const ideasDir = DIR_IDEAS
    const ideas: IdeaInfo[] = []

    if (await exists(ideasDir)) {
      for await (const entry of walk(ideasDir, { exts: ['.md'], includeDirs: false })) {
        if (entry.name.startsWith('.')) continue
        if (entry.name === 'ideas.md') continue

        try {
          const content = await readTextFile(entry.path)
          const idea = IdeaDocument.fromMarkdown(content)

          const status = IdeaStore.statusFromPath(entry.path)

          // Apply status filters
          if (draft && status !== 'draft') continue
          if (exploring && status !== 'exploring') continue
          if (actioned && status !== 'actioned') continue
          if (archived && status !== 'archived') continue

          // Apply tag filter
          if (tag && !idea.tags.has(tag)) continue

          // Apply year filter
          if (year && !entry.path.includes(`/${year}/`)) continue

          // Extract title from markdown (first # heading)
          const titleMatch = content.match(/^#\s+(.+)$/m)
          const title = titleMatch ? titleMatch[1] : idea.name

          // Get created date from YAML
          const created = typeof idea.yaml['created'] === 'string' ? idea.yaml['created'].slice(0, 10) : 'unknown'

          ideas.push({
            name: idea.name,
            title,
            status,
            created,
            tags: String(idea.tags),
            filePath: entry.path,
          })
        } catch (err) {
          output.log(colors.yellow(`Warning: Could not parse ${entry.path}: ${(err as Error).message}`))
        }
      }
    }

    // Sort by created date (most recent first)
    ideas.sort((a, b) => b.created.localeCompare(a.created))

    if (ideas.length === 0) {
      const filterDesc = draft
        ? 'draft '
        : exploring
          ? 'exploring '
          : actioned
            ? 'actioned '
            : archived
              ? 'archived '
              : ''
      output.log(`No ${filterDesc}ideas found.`)
      return CommandResult.success({ ideas: [] })
    }

    // Calculate column widths
    const cols = {
      status: 'Status'.length,
      name: 'Name'.length,
      created: 'Created'.length,
    }

    for (const d of ideas) {
      const statusLabel = d.status.charAt(0).toUpperCase() + d.status.slice(1)
      cols.status = Math.max(cols.status, statusLabel.length)
      cols.name = Math.max(cols.name, d.name.length)
      cols.created = Math.max(cols.created, d.created.length)
    }

    // Header
    const header = ['Status'.padEnd(cols.status), 'Name'.padEnd(cols.name), 'Created'.padEnd(cols.created)].join('  ')

    const separator = ['-'.repeat(cols.status), '-'.repeat(cols.name), '-'.repeat(cols.created)].join('  ')

    output.log(header)
    output.log(separator)

    // Rows
    for (const d of ideas) {
      const statusLabel = d.status.charAt(0).toUpperCase() + d.status.slice(1)
      const row = [statusLabel.padEnd(cols.status), d.name.padEnd(cols.name), d.created.padEnd(cols.created)].join('  ')
      output.log(row)
    }

    return CommandResult.success({ ideas })
  }
}
