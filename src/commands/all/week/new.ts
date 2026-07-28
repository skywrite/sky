import * as path from 'node:path'
import { cp } from 'node:fs/promises'
import * as dateFns from '#universal/dates/dateFns/mod.ts'
import { DIR_CODE, DIR_TIME } from '#config'
import exists from '#shared/fs/exists.ts'
import daysOfWeek from '#universal/dates/daysOfWeek.ts'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { loadStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { Command, CommandResult, when as whenParam } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { isFirstDayOfTheYear, isLastDayOfTheYear } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
const { addDays, isSunday } = dateFns

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
    const { when } = args
    let date = when.toDayDateValue()
    output.log(JSON.stringify(date, null, 2))

    output.log('\nStarting...')

    // if the day is Sunday or last day of the year
    // we're prepping to create a new week dir
    if (isSunday(date) || isLastDayOfTheYear(date)) {
      date = addDays(date, 1)
    }

    // daysOfTheWeek() handles year crossing
    const days = daysOfWeek(date)
    const wd = path.join(DIR_TIME, weekDir(new PlainDate(date)))

    // for now, if the week directory exists
    // exit to explicitly force creating the right week directory
    const weekDirExists = await exists(wd)
    if (weekDirExists) {
      output.log(`\n  ${weekDirExists} already exists. Explicitly pass the date.`)
      return CommandResult.error('Week directory already exists')
    }

    // tracking csvs

    // const trackingDirs = ['health', 'other']
    const tmplDir = path.join(DIR_CODE, 'src', 'tmpl')
    const trackingDirs = ['health']

    for (let trackingDir of trackingDirs) {
      trackingDir = path.join('_tracking', trackingDir)
      const trackingDirFrom = path.join(tmplDir, trackingDir)
      const trackingDirTo = path.join(wd, trackingDir)

      await cp(trackingDirFrom, trackingDirTo, { recursive: true })

      output.log('')
    }

    const activeStreaks = (await loadStreaks('active')).map((loaded) => loaded.streak)

    for (const [_i, day] of days.entries()) {
      const plainDay = PlainDate.from(day)
      const dd = new DayDirFileWriter(plainDay)

      const dayObj = stampStreaksList(DayDocument.createFutureDay(plainDay), activeStreaks, plainDay)
      await dd.write('day.md', dayObj.toMarkdown())
    }

    output.log('\nSuccess!\n')

    return CommandResult.success()
  }
}
