import * as p from '@clack/prompts'
import colors from 'picocolors'
import { exists, readTextFile, walk } from '#shared/fs/mod.ts'
import { unlink } from 'node:fs/promises'
import { DIR_DECISIONS } from '#config'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

// -----------------------------------------------------------------------------
// Params & Types
// -----------------------------------------------------------------------------

const params = {
  name: Arg.string('Name/slug of the decision to delete', {
    optional: true,
  }),
  force: Flag.boolean('Skip confirmation prompt', {
    short: 'f',
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { deleted: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:delete': {
      params: Params
      result: Result
    }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

type DecisionStatus = 'pending' | 'resolved' | 'archived'

interface DecisionFile {
  name: string
  title: string
  path: string
  status: DecisionStatus
}

function getStatusFromPath(filePath: string): DecisionStatus {
  if (filePath.includes('/pending/')) return 'pending'
  if (filePath.includes('/archived/')) return 'archived'
  if (filePath.includes('/resolved/')) return 'resolved'
  return 'pending'
}

async function findAllDecisions(): Promise<DecisionFile[]> {
  const decisions: DecisionFile[] = []

  if (!(await exists(DIR_DECISIONS))) {
    return decisions
  }

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === 'decisions.md' || entry.name === '.gitkeep') continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : decision.name

      decisions.push({
        name: decision.name,
        title,
        path: entry.path,
        status: getStatusFromPath(entry.path),
      })
    } catch {
      // Skip files that can't be parsed
    }
  }

  return decisions
}

async function findDecision(name: string): Promise<DecisionFile | null> {
  if (!(await exists(DIR_DECISIONS))) {
    return null
  }

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === 'decisions.md' || entry.name === '.gitkeep') continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      if (decision.name === name) {
        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1] : decision.name

        return {
          name: decision.name,
          title,
          path: entry.path,
          status: getStatusFromPath(entry.path),
        }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return null
}

// -----------------------------------------------------------------------------
// Command
// -----------------------------------------------------------------------------

export default class DecisionsDeleteTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:delete',
    description: 'Delete a decision from the register.',
    descriptionLong: ['Deletes a decision file permanently.', 'Will prompt for confirmation unless --force is used.'],
    usage: [
      'sky decisions:delete my-decision      # Delete by name',
      'sky decisions:delete my-decision -f   # Skip confirmation',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { name, force } = args

    // If no name provided, list decisions and let user pick
    if (!name) {
      const decisions = await findAllDecisions()

      if (decisions.length === 0) {
        output.log('No decisions found.')
        return CommandResult.fail('No decisions to delete')
      }

      const selected = await p.select({
        message: 'Which decision do you want to delete?',
        options: decisions.map((d) => ({
          value: d.name,
          label: `[${d.status}] ${d.name}`,
          hint: d.title,
        })),
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

    // Confirm deletion
    if (!force) {
      const confirmed = await p.confirm({
        message: `Delete "${decision.name}" (${decision.title})?`,
        initialValue: false,
      })

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }
    }

    // Delete the file
    try {
      await unlink(decision.path)
      output.log(colors.green(`Deleted: ${decision.path}`))
    } catch (err) {
      return CommandResult.error(err as Error, `Failed to delete file: ${decision.path}`)
    }

    return CommandResult.success({ deleted: decision.name })
  }
}
