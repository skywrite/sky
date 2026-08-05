import * as path from 'node:path'
import { Command, CommandResult, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import readTextFile from '#shared/fs/readTextFile.ts'
import { weekDir } from '#shared/nbfs/mod.ts'
import { addDays, isSameDay } from '#universal/dates/dateFns/mod.ts'
import { daysOfWeek, YMD } from '#universal/dates/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { parseCsv } from '#universal/encoding/csv/mod.ts'

const params = {
  type: Flag.string('Tracking data type', { short: 't', default: () => 'health/weight' }),
}

type Params = InferParams<typeof params>
type Result = { totalRecords: number }

const DAYS_OF_WEEK = ['SU', 'M', 'T', 'W', 'R', 'F', 'SA']
type DayOfWeek = (typeof DAYS_OF_WEEK)[number]
type DayTable = Record<DayOfWeek, Date>

export default class DataTrackingTask extends Command {
  static override description: CommandDescription = {
    name: 'data:tracking',
    description: 'Output tracking data',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { config, output } = context
    const { type } = args

    const weeks = new Map<string, DayTable>()

    const startDate = new Date('2021-01-01 12:00')
    const today = new Date()

    const fields = ['lbs']
    output.log('date,lbs')

    // this can be optimized
    // instead of iterating though each day and repeating
    // work 6 days of the week, just iterate through Mondays
    let curDate = startDate
    while (!isSameDay(curDate, today)) {
      // output.log(YMD(curDate).join('-'))
      const dayTable: DayTable = {}

      const daysInWeek = daysOfWeek(curDate)
      daysInWeek.forEach((day) => {
        dayTable[DAYS_OF_WEEK[day.getDay()]] = day
      })

      weeks.set(weekDir(new PlainDate(curDate)), dayTable)
      curDate = addDays(curDate, 1)
    }

    let totalRecords = 0

    for (const [weekDir, dayTable] of weeks) {
      const dir = path.join(<string>config.DIR_TIME, weekDir, '_tracking')
      const file = path.join(dir, `${type}.csv`)

      let fileData
      try {
        fileData = await readTextFile(file)
      } catch (err) {
        // Skip files that don't exist
        continue
      }

      const { records } = parseCsv(fileData)
      records.forEach((record) => {
        const date = dayTable[record.day]
        if (record.lbs !== '-') {
          output.log(`${YMD(date).join('-')}, ${record.lbs}`)
          totalRecords++
        }
      })
      // output.log(data.header)
      // output.log(file)
      // output.log(JSON.stringify(records, null, 2))
      // output.log(weekDir)
      // output.log(JSON.stringify(dayTable, null, 2))
    }

    return CommandResult.success({ totalRecords })
  }
}
