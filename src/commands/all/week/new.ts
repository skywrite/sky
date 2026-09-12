import { Command, CommandResult, when as whenParam } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import { loadStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { Week } from '#universal/dates/nbdt/mod.ts'
import { createWeekDays } from './lib/createWeekDays.ts'

const params = {
  when: whenParam(),
}

type Params = InferParams<typeof params>

export default class WeekNewTask extends Command {
  static override description: CommandDescription = {
    name: 'week:new',
    description: 'Create a new week.',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context

    // On Sunday or New Year's Eve you're prepping the coming week, not
    // re-creating the one that's ending.
    let day = args.when.plainDate
    if (day.dayOfWeek === 7 || (day.month === 12 && day.day === 31)) {
      day = day.addDays(1)
    }

    const week = Week.of(day)
    output.log(`Creating ${week.toString()} (${week.start.ymd} - ${week.end.ymd})`)

    const activeStreaks = (await loadStreaks('active')).map((loaded) => loaded.streak)
    const result = await createWeekDays(week, DIR_TIME, (day) =>
      stampStreaksList(DayDocument.createFutureDay(day), activeStreaks, day).toMarkdown(),
    )
    output.log(`${result.created.length} days created; ${result.existing.length} existing days kept.`)

    output.log('\nSuccess!\n')

    return CommandResult.success()
  }
}
