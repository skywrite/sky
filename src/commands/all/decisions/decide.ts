import { unlink } from 'node:fs/promises'
import * as path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import * as p from '@clack/prompts'
import openEditor from 'open-editor'
import colors from 'picocolors'
import { Arg, categoryComplete, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_DECISIONS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { exists, outputFile, readTextFile, walk, writeTextFile } from '#shared/fs/mod.ts'
import DecisionDocument from '#shared/models/Decision/mod.ts'
import { fetchNow, readDay } from '#shared/nbfs/mod.ts'
import ZonedDateTime from '#universal/dates/nbdt/ZonedDateTime/mod.ts'

const params = {
  name: Arg.string('Name/slug of the decision to decide', { optional: true }),
  when: Flag.plainDateTime('Decide at a past date/time (e.g., 2026-01-20 14:00)', {
    short: 'w',
    optional: true,
  }),
  category: categoryComplete(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'decisions:decide': {
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

export default class DecisionsDecideTask extends Command {
  static override description: CommandDescription = {
    name: 'decisions:decide',
    description: 'Mark a decision as decided and record the decision.',
    descriptionLong: [
      'Marks a pending decision as decided by:',
      '1. Recording what was decided in the ## Decision section',
      '2. Setting the decided timestamp',
      '3. Moving the file from pending/ to decided/',
    ],
    usage: [
      'sky decisions:decide                              # Interactive selection',
      'sky decisions:decide my-decision                  # Decide by name',
      'sky decisions:decide --when "2026-01-20 14:00"    # Decide at a past date/time',
      'sky decisions:decide --category Personal           # Set day item category',
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
      output.error(`Decision "${name}" has already been decided.`)
      return CommandResult.fail('Decision already decided')
    }

    // Build the decided ZonedDateTime: from --when + day's TZ, or fetchNow()
    let decidedAt: ZonedDateTime
    if (when) {
      const dayDate = when.plainDate
      try {
        const dayDoc = await readDay(dayDate)
        decidedAt = new ZonedDateTime(when, dayDoc.timezone)
      } catch {
        // Day file may not exist for that date; fall back to default TZ
        decidedAt = new ZonedDateTime(when, 'America/Chicago')
      }
    } else {
      const now = await fetchNow()
      decidedAt = new ZonedDateTime(now.plainDateTime, now.timezone)
    }

    // Prompt for what was decided
    const whenLabel = when ? colors.yellow(`(deciding as of ${decidedAt.toString()})`) : ''
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

    // Mark the decision decided (sets the decided timestamp)
    const decidedDoc = DecisionDocument.fromMarkdown(updatedContent).decide(decidedAt)

    // Determine the new path: year/decided/month/name.md
    const decidedDate = decidedAt.plainDateTime.plainDate
    const year = decidedDate.year
    const month = String(decidedDate.month).padStart(2, '0')
    const newPath = path.join(DIR_DECISIONS, String(year), 'decided', month, `${decision.name}.md`)

    // Ensure the decided directory exists
    const newDir = path.dirname(newPath)
    if (!(await exists(newDir))) {
      await outputFile(path.join(newDir, '.gitkeep'), '')
    }

    // Write to the new location
    await writeTextFile(newPath, decidedDoc.toMarkdown())
    output.log(colors.green(`Decided: ${newPath}`))

    // Remove the old file from pending/
    try {
      await unlink(decision.path)
      output.log(colors.gray(`Removed from pending/`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not remove old file: ${(err as Error).message}`))
    }

    // Add day item
    const entryTime = decidedAt.plainDateTime.time
    const dayItem = `${entryTime} > decisions/${decision.name} -> Decided | ${decision.title}`

    try {
      await writeDayItems(decidedAt.plainDateTime.plainDate, category, dayItem)
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

    p.outro(colors.green(`Decision "${name}" marked as decided`))

    return CommandResult.success({ file: newPath, name: decision.name })
  }
}
