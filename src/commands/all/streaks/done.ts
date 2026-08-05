import colors from 'picocolors'
import { Arg, Command, CommandResult, dayArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { computeStreakCounts, loadStreaks, strikeStreakItem } from '#lib/streaks/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'

const params = {
  name: Arg.string('Streak slug to mark done'),
  day: dayArg(),
}

type Params = InferParams<typeof params>
type Result = { changed: boolean; item?: string }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'streaks:done': {
      params: Params
      result: Result
    }
  }
}

export default class StreaksDoneTask extends Command {
  static override description: CommandDescription = {
    name: 'streaks:done',
    description: "Strike a streak's item in the day file.",
    descriptionLong: [
      'Marks a streak complete by striking its item in the Streaks list —',
      'the same mechanic as checking it in the editor.',
    ],
    usage: [
      'sky streaks:done eat-clean       # Mark done today',
      'sky streaks:done eat-clean 25    # Retro-mark a past day',
    ],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { name, day } = args

    const loaded = await loadStreaks('active')
    const found = loaded.find(({ streak }) => streak.name === name)

    if (!found) {
      const known = loaded.map(({ streak }) => streak.name).join(', ') || '(none)'
      output.error(`Unknown streak "${name}". Active streaks: ${known}`)
      return CommandResult.fail(`Unknown streak "${name}"`)
    }

    let dayModel
    try {
      dayModel = await readDay(day)
    } catch {
      output.error(`No day file for ${day.ymd}`)
      return CommandResult.fail(`No day file for ${day.ymd}`)
    }

    const result = strikeStreakItem(dayModel, found.streak, day)

    if (result.kind === 'not-tracked') {
      output.log(colors.dim(`"${found.streak.title}" is not tracked on ${day.ymd} (schedule, pause, or dates).`))
      return CommandResult.success({ changed: false })
    }

    if (result.kind === 'already') {
      output.log(colors.dim(`Already done: ${result.item}`))
      return CommandResult.success({ changed: false, item: result.item })
    }

    await writeDay(result.day)

    const counts = await computeStreakCounts([found.streak], day)
    const run = counts.get(found.streak.name) ?? 0
    output.log(colors.green(`✓ ${found.streak.title}`) + colors.dim(`  run: ${run}d`))

    return CommandResult.success({ changed: true, item: result.item })
  }
}
