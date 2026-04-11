import * as path from 'node:path'
import { unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import * as p from '@clack/prompts'
import colors from 'picocolors'
import { exists, outputFile, readTextFile, walk, writeTextFile } from '#shared/fs/mod.ts'
import { DIR_DECISIONS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import { Arg, categoryComplete, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  name: Arg.string('Name/slug of the decision to archive', { optional: true }),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:archive': {
      params: Params
      result: Result
    }
  }
}

interface ResolvedDecision {
  name: string
  title: string
  path: string
  year: number
  month: string
}

/**
 * Find all resolved (not archived) decisions in year/resolved/ directories
 */
async function findResolvedDecisions(): Promise<ResolvedDecision[]> {
  const resolved: ResolvedDecision[] = []

  if (!(await exists(DIR_DECISIONS))) {
    return resolved
  }

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === '.gitkeep') continue
    if (!entry.path.includes('/resolved/')) continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      // Extract year and month from path: decisions/YYYY/resolved/MM/name.md
      const pathMatch = entry.path.match(/decisions\/(\d{4})\/resolved\/(\d{2})\//)
      const year = pathMatch ? parseInt(pathMatch[1]) : new Date().getFullYear()
      const month = pathMatch ? pathMatch[2] : '01'

      const titleMatch = content.match(/^#\s+(.+)$/m)
      const title = titleMatch ? titleMatch[1] : decision.name

      resolved.push({ name: decision.name, title, path: entry.path, year, month })
    } catch {
      // Skip files that can't be parsed
    }
  }

  return resolved
}

/**
 * Find a specific resolved decision by name
 */
async function findResolvedDecision(name: string): Promise<ResolvedDecision | null> {
  if (!(await exists(DIR_DECISIONS))) {
    return null
  }

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === '.gitkeep') continue
    if (!entry.path.includes('/resolved/')) continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      if (decision.name === name) {
        const pathMatch = entry.path.match(/decisions\/(\d{4})\/resolved\/(\d{2})\//)
        const year = pathMatch ? parseInt(pathMatch[1]) : new Date().getFullYear()
        const month = pathMatch ? pathMatch[2] : '01'

        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1] : decision.name

        return { name: decision.name, title, path: entry.path, year, month }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return null
}

export default class DecisionsArchiveTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:archive',
    description: 'Archive a resolved decision after reviewing its outcome.',
    descriptionLong: [
      'Moves a decision from resolved/ to archived/ after outcome review.',
      'Use this when you have reviewed the outcome of a decision and',
      'no longer need to track it for follow-up.',
    ],
    usage: [
      'sky decisions:archive                    # Interactive selection',
      'sky decisions:archive my-decision        # Archive by name',
      'sky decisions:archive --category Personal # Set day item category',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { name, category } = args

    p.intro(colors.bold(colors.cyan('Archive Decision')))

    // If no name provided, list resolved decisions and let user pick
    if (!name) {
      const resolved = await findResolvedDecisions()

      if (resolved.length === 0) {
        output.log('No resolved decisions found to archive.')
        return CommandResult.fail('No resolved decisions')
      }

      const selected = await p.select({
        message: 'Which decision do you want to archive?',
        options: resolved.map((d) => ({
          value: d.name,
          label: d.name,
          hint: d.title,
        })),
      })

      if (p.isCancel(selected)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      name = selected as string
    }

    // Find the decision in resolved/
    const decision = await findResolvedDecision(name)

    if (!decision) {
      output.error(`Resolved decision "${name}" not found.`)
      return CommandResult.fail(`Resolved decision "${name}" not found`)
    }

    // Read the decision file
    const content = await readTextFile(decision.path)

    // Ask if user wants to add outcome notes
    const addOutcome = await p.confirm({
      message: 'Do you want to add/update the outcome notes?',
      initialValue: false,
    })

    if (p.isCancel(addOutcome)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    let finalContent = content

    if (addOutcome) {
      const outcomeText = await p.text({
        message: 'What was the outcome?\n',
        placeholder: 'Describe the outcome of this decision...',
      })

      if (p.isCancel(outcomeText)) {
        p.cancel('Cancelled')
        return CommandResult.fail('User cancelled')
      }

      if (outcomeText) {
        // Update the Outcome section
        const pattern = /(## Outcome\s*\n)([\s\S]*?)$/
        const match = content.match(pattern)

        if (match) {
          finalContent = content.replace(pattern, `$1\n${outcomeText}\n`)
        } else {
          finalContent = content + `\n\n## Outcome\n\n${outcomeText}\n`
        }
      }
    }

    // Determine the new path: year/archived/month/name.md (same month as resolved)
    const newPath = path.join(DIR_DECISIONS, String(decision.year), 'archived', decision.month, `${decision.name}.md`)

    // Ensure the archived directory exists
    const newDir = path.dirname(newPath)
    if (!(await exists(newDir))) {
      await outputFile(path.join(newDir, '.gitkeep'), '')
    }

    // Write to the new location
    await writeTextFile(newPath, finalContent)
    output.log(colors.green(`Archived: ${newPath}`))

    // Remove the old file from resolved/
    try {
      await unlink(decision.path)
      output.log(colors.gray(`Removed from resolved/`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not remove old file: ${(err as Error).message}`))
    }

    // Add day item
    const now = await fetchNow()
    const entryTime = now.plainDateTime.time
    const dayItem = `${entryTime} > decisions/${decision.name} -> Archived | ${decision.title}`

    try {
      await writeDayItems(now.plainDateTime.plainDate, category, dayItem)
      output.log(colors.gray(`Added to ${category}: ${dayItem}`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not add day item: ${(err as Error).message}`))
    }

    // Open in editor
    try {
      openEditor([{ file: newPath }])
      await delay(500)
    } catch {
      // Editor opening is best-effort
    }

    p.outro(colors.green(`Decision "${name}" archived`))

    return CommandResult.success({ file: newPath, name: decision.name })
  }
}
