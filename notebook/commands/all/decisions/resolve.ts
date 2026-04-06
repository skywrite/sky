import * as path from 'node:path'
import { unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import openEditor from 'open-editor'
import * as p from '@clack/prompts'
import colors from 'picocolors'
import { exists, outputFile, readTextFile, walk, writeTextFile } from '#shared/fs/mod.ts'
import { DIR_DECISIONS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { fetchNow, readDay } from '#shared/nbfs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'
import { Arg, categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  name: Arg.string('Name/slug of the decision to decide', { optional: true }),
  when: Flag.plainDateTime('Resolve at a past date/time (e.g., 2026-01-20 14:00)', {
    short: 'w',
    optional: true,
  }),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:resolve': {
      params: Params
      result: Result
    }
  }
}

interface PendingDecision {
  name: string
  title: string
  path: string
  year: number
}

/**
 * Find all pending decisions in year/pending/ directories
 */
async function findPendingDecisions(): Promise<PendingDecision[]> {
  const pending: PendingDecision[] = []

  if (!(await exists(DIR_DECISIONS))) {
    return pending
  }

  // Walk only pending directories: decisions/YYYY/pending/
  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === '.gitkeep') continue
    if (!entry.path.includes('/pending/')) continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      if (decision.isPending) {
        const yearMatch = entry.path.match(/decisions\/(\d{4})\//)
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear()

        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1] : decision.name

        pending.push({ name: decision.name, title, path: entry.path, year })
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return pending
}

/**
 * Find a specific pending decision by name
 */
async function findPendingDecision(name: string): Promise<PendingDecision | null> {
  if (!(await exists(DIR_DECISIONS))) {
    return null
  }

  for await (const entry of walk(DIR_DECISIONS, { exts: ['.md'], includeDirs: false })) {
    if (entry.name === '.gitkeep') continue
    if (!entry.path.includes('/pending/')) continue

    try {
      const content = await readTextFile(entry.path)
      const decision = DecisionDocument.fromMarkdown(content)

      if (decision.name === name) {
        const yearMatch = entry.path.match(/decisions\/(\d{4})\//)
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear()

        const titleMatch = content.match(/^#\s+(.+)$/m)
        const title = titleMatch ? titleMatch[1] : decision.name

        return { name: decision.name, title, path: entry.path, year }
      }
    } catch {
      // Skip files that can't be parsed
    }
  }

  return null
}

/**
 * Update the ## Decision section content in the markdown
 */
function updateDecisionSection(markdown: string, decisionText: string): string {
  // Match ## Decision section and replace its content up to the next ## heading
  const pattern = /(## Decision\s*\n)([\s\S]*?)((?=\n## )|$)/
  const match = markdown.match(pattern)

  if (match) {
    return markdown.replace(pattern, `$1\n${decisionText}\n\n$3`)
  }

  // If no Decision section exists, add it before ## Outcome
  const outcomePattern = /(## Outcome)/
  if (markdown.match(outcomePattern)) {
    return markdown.replace(outcomePattern, `## Decision\n\n${decisionText}\n\n$1`)
  }

  // Fallback: append at the end
  return markdown + `\n\n## Decision\n\n${decisionText}\n`
}

export default class DecisionsResolveTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:resolve',
    description: 'Mark a decision as resolved and record the decision.',
    descriptionLong: [
      'Marks a pending decision as resolved by:',
      '1. Recording what was decided in the ## Decision section',
      '2. Setting the resolved timestamp',
      '3. Moving the file from pending/ to resolved/',
    ],
    usage: [
      'sky decisions:resolve                              # Interactive selection',
      'sky decisions:resolve my-decision                  # Decide by name',
      'sky decisions:resolve --when "2026-01-20 14:00"    # Resolve at a past date/time',
      'sky decisions:resolve --category Personal           # Set day item category',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    let { name, category, when } = args

    p.intro(colors.bold(colors.cyan('Decide')))

    // If no name provided, list pending decisions and let user pick
    if (!name) {
      const pending = await findPendingDecisions()

      if (pending.length === 0) {
        output.log('No pending decisions found.')
        return CommandResult.fail('No pending decisions')
      }

      const selected = await p.select({
        message: 'Which decision have you made?',
        options: pending.map((d) => ({
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

    // Find the decision in pending/
    const decision = await findPendingDecision(name)

    if (!decision) {
      output.error(`Pending decision "${name}" not found.`)
      return CommandResult.fail(`Pending decision "${name}" not found`)
    }

    // Read the decision file
    const content = await readTextFile(decision.path)
    const decisionDoc = DecisionDocument.fromMarkdown(content)

    if (!decisionDoc.isPending) {
      output.error(`Decision "${name}" has already been resolved.`)
      return CommandResult.fail('Decision already resolved')
    }

    // Build the resolved ZonedDateTime: from --when + day's TZ, or fetchNow()
    let resolvedAt: ZonedDateTime
    if (when) {
      const dayDate = when.plainDate
      try {
        const dayDoc = await readDay(dayDate)
        resolvedAt = new ZonedDateTime(when, dayDoc.timezone)
      } catch {
        // Day file may not exist for that date; fall back to default TZ
        resolvedAt = new ZonedDateTime(when, 'America/Chicago')
      }
    } else {
      const now = await fetchNow()
      resolvedAt = new ZonedDateTime(now.plainDateTime, now.timezone)
    }

    // Prompt for what was decided
    const whenLabel = when ? colors.yellow(`(resolving as of ${resolvedAt.toString()})`) : ''
    const decisionText = await p.text({
      message: `What did you decide? ${whenLabel}\n`,
      placeholder: 'Enter the decision...',
      validate: (value) => {
        if (!value.trim()) return 'Please describe the decision'
      },
    })

    if (p.isCancel(decisionText)) {
      p.cancel('Cancelled')
      return CommandResult.fail('User cancelled')
    }

    // Update the Decision section in the full content (frontmatter + body)
    const updatedContent = updateDecisionSection(content, decisionText as string)

    // Parse and resolve the decision (sets resolved timestamp)
    const resolvedDoc = DecisionDocument.fromMarkdown(updatedContent).resolve(resolvedAt)

    // Determine the new path: year/resolved/month/name.md
    const resolvedDate = resolvedAt.plainDateTime.plainDate
    const year = resolvedDate.year
    const month = String(resolvedDate.month).padStart(2, '0')
    const newPath = path.join(DIR_DECISIONS, String(year), 'resolved', month, `${decision.name}.md`)

    // Ensure the resolved directory exists
    const newDir = path.dirname(newPath)
    if (!(await exists(newDir))) {
      await outputFile(path.join(newDir, '.gitkeep'), '')
    }

    // Write to the new location
    await writeTextFile(newPath, resolvedDoc.toMarkdown())
    output.log(colors.green(`Resolved: ${newPath}`))

    // Remove the old file from pending/
    try {
      await unlink(decision.path)
      output.log(colors.gray(`Removed from pending/`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not remove old file: ${(err as Error).message}`))
    }

    // Add day item
    const entryTime = resolvedAt.plainDateTime.time
    const dayItem = `${entryTime} > decisions/${decision.name} -> Resolved | ${decision.title}`

    try {
      await writeDayItems(resolvedAt.plainDateTime.plainDate, category, dayItem)
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

    p.outro(colors.green(`Decision "${name}" marked as resolved`))

    return CommandResult.success({ file: newPath, name: decision.name })
  }
}
