import * as path from 'node:path'
import { unlink } from 'node:fs/promises'
import colors from 'picocolors'
import { DIR_STREAKS } from '#config'
import { outputFile } from '#shared/fs/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { computeStreakStats } from '#shared/models/Streak/mod.ts'
import { loadStreakEntries, loadStreaks } from '#lib/streaks/mod.ts'
import { Arg, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  name: Arg.string('Streak slug to archive'),
  category: Flag.string('Category for day item: "Personal" or "Professional"', {
    short: 'c',
    parse: (val: string) => `${val} Complete`,
    default: () => 'Personal Complete',
  }),
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
    const { output } = context
    const { name, category } = args

    const loaded = await loadStreaks('active')
    const found = loaded.find(({ streak }) => streak.name === name)

    if (!found) {
      const known = loaded.map(({ streak }) => streak.name).join(', ') || '(none)'
      output.error(`Unknown streak "${name}". Active streaks: ${known}`)
      return CommandResult.fail(`Unknown streak "${name}"`)
    }

    const now = await fetchNow()
    const today = now.plainDateTime.plainDate
    const { streak } = found

    // Final stats before the archive stamp caps the walk
    const entries = await loadStreakEntries(streak.start ?? today, today)
    const stats = computeStreakStats(streak, entries, today)

    const archived = streak.archive(today)
    const archivedPath = path.join(DIR_STREAKS, 'archived', `${name}.md`)

    await outputFile(archivedPath, archived.toMarkdown())
    await unlink(found.path)

    output.log(colors.green(`Archived "${streak.title}"`) + colors.dim(`  final run: ${stats.current}d, best: ${stats.best}d`))

    const dayItem = `${now.plainDateTime.time} > streaks/${name} -> Archived | ${streak.title}`
    try {
      await writeDayItems(today, category, dayItem)
      output.log(colors.gray(`Added to ${category}: ${dayItem}`))
    } catch (err) {
      output.log(colors.yellow(`Warning: Could not add day item: ${(err as Error).message}`))
    }

    return CommandResult.success({ file: archivedPath, name })
  }
}
