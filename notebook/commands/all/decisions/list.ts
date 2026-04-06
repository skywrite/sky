import colors from 'picocolors'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import { DIR_DECISIONS } from '#config'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  all: Flag.boolean('Show all decisions (default: pending only)', {
    short: 'A',
    default: false,
  }),
  resolved: Flag.boolean('Show only resolved decisions (not archived)', {
    short: 'r',
    default: false,
  }),
  archived: Flag.boolean('Show only archived decisions', {
    short: 'a',
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

type DecisionStatus = 'pending' | 'resolved' | 'archived'

interface DecisionInfo {
  name: string
  title: string
  status: DecisionStatus
  identified: string
  target: string | null
  resolved: string | null
  tags: string
  filePath: string
}

type Result = { decisions: DecisionInfo[] }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:list': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getStatusFromPath(filePath: string): DecisionStatus {
  if (filePath.includes('/pending/')) return 'pending'
  if (filePath.includes('/archived/')) return 'archived'
  if (filePath.includes('/resolved/')) return 'resolved'
  // Legacy paths without status directory - check the document
  return 'pending'
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class DecisionsListTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:list',
    description: 'List decisions with optional filtering.',
    descriptionLong: [
      'Lists all decisions from the decision register.',
      'Supports filtering by status (pending/resolved/archived), tags, and year.',
    ],
    usage: [
      'sky decisions:list                   # List pending decisions (default)',
      'sky decisions:list --all             # List all decisions',
      'sky decisions:list --resolved        # List only resolved decisions',
      'sky decisions:list --archived        # List only archived decisions',
      'sky decisions:list --tag hiring      # Filter by tag',
      'sky decisions:list --year 2026       # Filter by year',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { all, resolved, archived, tag, year } = args
    // Default to pending-only unless --all, --resolved, or --archived is set
    const pending = !all && !resolved && !archived

    const decisionsDir = DIR_DECISIONS
    const decisions: DecisionInfo[] = []

    // Walk the decisions directory for .md files (if it exists)
    if (await exists(decisionsDir)) {
      for await (const entry of walk(decisionsDir, { exts: ['.md'], includeDirs: false })) {
        // Skip index files and gitkeep
        if (entry.name === '.gitkeep' || entry.name === 'decisions.md') continue

        try {
          const content = await readTextFile(entry.path)
          const decision = DecisionDocument.fromMarkdown(content)

          // Determine status from path
          const status = getStatusFromPath(entry.path)

          // Apply status filters
          if (pending && status !== 'pending') continue
          if (resolved && status !== 'resolved') continue
          if (archived && status !== 'archived') continue

          // Apply tag filter
          if (tag && !decision.tags.has(tag)) continue

          // Apply year filter
          if (year && !decision.identified?.date.startsWith(year)) continue

          // Extract title from markdown (first # heading)
          const titleMatch = content.match(/^#\s+(.+)$/m)
          const title = titleMatch ? titleMatch[1] : decision.name

          // Format target date (handles both PlainDate and PlainDateTime)
          let targetStr: string | null = null
          const target = decision.target
          if (target) {
            targetStr = 'toString' in target ? target.toString() : String(target)
          }

          decisions.push({
            name: decision.name,
            title,
            status,
            identified: decision.identified?.date ?? 'unknown',
            target: targetStr,
            resolved: decision.resolved?.date ?? null,
            tags: String(decision.tags),
            filePath: entry.path,
          })
        } catch (err) {
          output.log(colors.yellow(`Warning: Could not parse ${entry.path}: ${(err as Error).message}`))
        }
      }
    }

    // Sort by identified date (most recent first)
    decisions.sort((a, b) => b.identified.localeCompare(a.identified))

    if (decisions.length === 0) {
      const filterDesc = pending ? 'pending ' : resolved ? 'resolved ' : archived ? 'archived ' : ''
      output.log(`No ${filterDesc}decisions found.`)
      return CommandResult.success({ decisions: [] })
    }

    // Calculate column widths
    const cols = {
      status: 'Status'.length,
      name: 'Name'.length,
      identified: 'Identified'.length,
      target: 'Target'.length,
    }

    for (const d of decisions) {
      const statusLabel = d.status.charAt(0).toUpperCase() + d.status.slice(1)
      cols.status = Math.max(cols.status, statusLabel.length)
      cols.name = Math.max(cols.name, d.name.length)
      cols.identified = Math.max(cols.identified, d.identified.length)
      cols.target = Math.max(cols.target, (d.target ?? '-').length)
    }

    // Header
    const header = [
      'Status'.padEnd(cols.status),
      'Name'.padEnd(cols.name),
      'Identified'.padEnd(cols.identified),
      'Target'.padEnd(cols.target),
    ].join('  ')

    const separator = [
      '-'.repeat(cols.status),
      '-'.repeat(cols.name),
      '-'.repeat(cols.identified),
      '-'.repeat(cols.target),
    ].join('  ')

    output.log(header)
    output.log(separator)

    // Rows
    for (const d of decisions) {
      const statusLabel = d.status.charAt(0).toUpperCase() + d.status.slice(1)
      const row = [
        statusLabel.padEnd(cols.status),
        d.name.padEnd(cols.name),
        d.identified.padEnd(cols.identified),
        (d.target ?? '-').padEnd(cols.target),
      ].join('  ')
      output.log(row)
    }

    return CommandResult.success({ decisions })
  }
}
