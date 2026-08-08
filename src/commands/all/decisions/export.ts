import * as path from 'node:path'
import * as p from '@clack/prompts'
import colors from 'picocolors'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_DECISIONS, DIR_DESKTOP } from '#config'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Arg.string('Name/slug of the decision to export', { optional: true }),
  all: Flag.bool('Include resolved and archived decisions in the picker', {
    short: 'A',
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:export': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type DecisionStatus = 'pending' | 'resolved' | 'archived'

interface DecisionEntry {
  name: string
  title: string
  status: DecisionStatus
  identified: string
  path: string
}

/**
 * Find decisions, optionally including archived
 */
async function findDecisions(includeArchived: boolean): Promise<DecisionEntry[]> {
  const decisions: DecisionEntry[] = []

  if (!(await exists(DIR_DECISIONS))) return decisions

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === '.gitkeep') continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      let status: DecisionStatus = 'pending'
      if (entry.path.includes('/resolved/')) status = 'resolved'
      else if (entry.path.includes('/archived/')) status = 'archived'

      if (!includeArchived && status !== 'pending') continue

      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : decision.name
      const identified = decision.identified?.date ?? 'unknown'

      decisions.push({ name: decision.name, title, status, identified, path: entry.path })
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Sort: pending first, then resolved, then archived; within each group by name
  const statusOrder: Record<DecisionStatus, number> = { pending: 0, resolved: 1, archived: 2 }
  decisions.sort((a, b) => {
    if (a.status !== b.status) return statusOrder[a.status] - statusOrder[b.status]
    return a.name.localeCompare(b.name)
  })

  return decisions
}

/**
 * Find a specific decision by name across all statuses
 */
async function findDecision(name: string): Promise<DecisionEntry | null> {
  if (!(await exists(DIR_DECISIONS))) return null

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === '.gitkeep') continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      if (decision.name === name) {
        let status: DecisionStatus = 'pending'
        if (entry.path.includes('/resolved/')) status = 'resolved'
        else if (entry.path.includes('/archived/')) status = 'archived'

        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1] : decision.name
        const identified = decision.identified?.date ?? 'unknown'

        return { name: decision.name, title, status, identified, path: entry.path }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return null
}

/**
 * Build the PDF filename: YYYY_MM_DD_decision_{slug}.pdf
 */
function buildPdfFilename(identified: string, slug: string): string {
  return `${identified}_decision_${slug}.pdf`
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class DecisionsExportTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:export',
    description: 'Export a decision as PDF to the Desktop.',
    descriptionLong: [
      'Exports a decision as a styled PDF to ~/Desktop/',
      'Shows pending decisions by default.',
      'Use --all to include resolved and archived decisions.',
    ],
    usage: [
      'sky decisions:export                    # Interactive selection',
      'sky decisions:export my-decision        # Export by name',
      'sky decisions:export --all              # Include archived in picker',
    ],
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { name } = args
    const { all } = args

    // If no name provided, let user pick
    if (!name) {
      const decisions = await findDecisions(all)

      if (decisions.length === 0) {
        output.log('No decisions found.')
        return CommandResult.fail('No decisions found')
      }

      const selected = await p.select({
        message: 'Which decision to export?',
        options: decisions.map((d) => {
          const statusLabel =
            d.status === 'pending'
              ? colors.yellow('pending')
              : d.status === 'resolved'
                ? colors.green('resolved')
                : colors.dim('archived')
          return {
            value: d.name,
            label: `${d.name} ${statusLabel}`,
            hint: d.title,
          }
        }),
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      name = selected as string
    }

    // Find the decision
    const decision = await findDecision(name)

    if (!decision) {
      output.error(`Decision "${name}" not found.`)
      return CommandResult.fail(`Decision "${name}" not found`)
    }

    // Export as PDF via markdown:pdf
    const pdfFilename = buildPdfFilename(decision.identified, decision.name)
    const pdfPath = path.join(DIR_DESKTOP, pdfFilename)

    const pdfResult = await tasks.run<{ pdfPath: string }>('markdown:pdf', {
      _: ['markdown:pdf', decision.path],
      output: pdfPath,
      title: decision.title,
    })

    if (pdfResult.status !== 'success') {
      output.error('PDF export failed')
      return CommandResult.fail('PDF export failed')
    }

    output.log(colors.green(`Exported to ${pdfPath}`))

    return CommandResult.success({ file: pdfPath, name: decision.name })
  }
}
