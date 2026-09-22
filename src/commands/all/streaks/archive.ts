import * as path from 'node:path'
import colors from 'picocolors'
import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { writePlanningChanges } from '#lib/nbfs/planningChanges.ts'
import { createStreakClassifier, resolveStreakCategory } from '#lib/streaks/category.ts'
import { loadStreakEntries, loadStreaks } from '#lib/streaks/mod.ts'
import { readTextFile } from '#shared/fs/mod.ts'
import StreakDocument, { computeStreakStats, parseStreakCategory } from '#shared/models/Streak/mod.ts'
import { streakCategoryFlag } from './lib/category.ts'

const params = {
  name: Arg.string('Streak slug to archive'),
  category: streakCategoryFlag(),
}

type Params = InferParams<typeof params>
type Result = { file: string; name: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:archive': {
      params: Params
      result: Result
    }
  }
}

export default class StreaksArchiveTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:archive',
    description: 'Archive a streak — stamps ended and moves it to streaks/archived/.',
    descriptionLong: [
      'Streaks are never deleted, only archived. The rule doc keeps its full',
      'history: stats can be recomputed from day files forever.',
    ],
    usage: ['sky streaks:archive eat-clean'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output, config } = context
    const { name } = args

    const loaded = await loadStreaks('active', config.DIR_STREAKS)
    const found = loaded.find(({ streak }) => streak.name === name)

    if (!found) {
      const known = loaded.map(({ streak }) => streak.name).join(', ') || '(none)'
      output.error(`Unknown streak "${name}". Active streaks: ${known}`)
      return CommandResult.fail(`Unknown streak "${name}"`)
    }

    const now = context.notebookNow
    const today = now.plainDateTime.plainDate
    const before = await readTextFile(found.path)
    const streak = StreakDocument.fromMarkdown(before)

    // Final stats before the archive stamp caps the walk
    const entries = await loadStreakEntries(streak.start ?? today, today, config.DIR_TIME)
    const stats = computeStreakStats(streak, entries, today)

    const category = await resolveStreakCategory(
      streak,
      parseStreakCategory(args.category),
      createStreakClassifier(config.DIR_BASE),
    )
    let archived = streak.archive(today)
    if (category.category) archived = archived.updateYaml({ category: category.category })
    const archivedPath = path.join(config.DIR_STREAKS, 'archived', `${name}.md`)

    await writePlanningChanges([
      { file: archivedPath, before: undefined, after: archived.toMarkdown() },
      { file: found.path, before, after: undefined },
    ])

    output.log(
      colors.green(`Archived "${streak.title}"`) + colors.dim(`  final run: ${stats.current}d, best: ${stats.best}d`),
    )

    const dayItem = `${now.plainDateTime.time} > streaks/${name} -> Archived | ${streak.title}`
    const collection = `${category.category ?? 'Personal'} Complete`
    if (category.warning) output.log(colors.yellow('Category could not be determined; using Personal Complete.'))
    try {
      await writeDayItems(today, collection, dayItem, { timeDir: config.DIR_TIME })
      output.log(colors.gray(`Added to ${collection}: ${dayItem}`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not add day item: ${(err as Error).message}`))
    }

    return CommandResult.success({ file: archivedPath, name })
  }
}
