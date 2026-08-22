import { cp } from 'node:fs/promises'
import * as path from 'node:path'
import { Command, CommandResult, when as whenParam } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DIR_CODE, DIR_TIME } from '#config'
import { DayDirFileWriter } from '#lib/nbfs/mod.ts'
import { loadStreaks, stampStreaksList } from '#lib/streaks/mod.ts'
import exists from '#shared/fs/exists.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { Week } from '#universal/dates/nbdt/mod.ts'

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

    // A boundary week spans two year buckets (the year is the boundary).
    // Refuse if any bucket already exists, so a half-created week can't
    // silently dedupe day files into day-2.md.
    const buckets = [...new Set(week.days.map((d) => path.join(DIR_TIME, weekDir(d))))]
    for (const bucket of buckets) {
      if (await exists(bucket)) {
        output.log(`\n  ${bucket} already exists. Explicitly pass the date.`)
        return CommandResult.error('Week directory already exists')
      }
    }

    // Week-level files live in the week's first in-year bucket — the same
    // place week:plan and summary:week read them from.
    const weekFilesDir = path.join(DIR_TIME, weekDir(week.startInYear))
    const tmplDir = path.join(DIR_CODE, 'src', 'tmpl')
    for (const trackingDir of ['health']) {
      const rel = path.join('_tracking', trackingDir)
      await cp(path.join(tmplDir, rel), path.join(weekFilesDir, rel), { recursive: true })
    }

    const activeStreaks = (await loadStreaks('active')).map((loaded) => loaded.streak)

    // Each day files through dayDir, so a boundary week's spillover days
    // route into their own year's bucket instead of the Monday's — the
    // write pattern that used to mint mis-yeared artifact paths.
    for (const plainDay of week.days) {
      const dd = new DayDirFileWriter(plainDay)
      const dayObj = stampStreaksList(DayDocument.createFutureDay(plainDay), activeStreaks, plainDay)
      await dd.write('day.md', dayObj.toMarkdown())
    }

    output.log('\nSuccess!\n')

    return CommandResult.success()
  }
}
