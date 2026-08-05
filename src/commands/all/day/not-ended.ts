import * as path from 'node:path'
import colors from 'picocolors'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import exists from '#shared/fs/exists.ts'
import dayFile from '#shared/nbfs/dayFile.ts'
import { readDay } from '#shared/nbfs/mod.ts'
import { fetchNowSync } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// The started/ended feature was introduced on 2025-07-20
// Days before this date should not be checked for incompleteness
const STARTED_ENDED_CUTOFF = new PlainDate('2025-07-20')

export default class DayNotEndedTask extends Command {
  static override description: CommandDescription = {
    name: 'day:not-ended',
    description: 'Find days that have not been ended',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const incompleteDays: { plainDate: PlainDate; ymd: string }[] = []

    // Get the current "notebook day" (could be past midnight but still today)
    const nowDt = fetchNowSync()
    const currentDayYmd = nowDt.plainDateTime.date

    // Start from yesterday to skip the current day
    let currentPlainDate = nowDt.plainDateTime.plainDate.addDays(-1)
    let searchComplete = false

    while (!searchComplete) {
      const filePath = path.join(DIR_TIME, dayFile(currentPlainDate))

      // Check if day file exists
      if (!(await exists(filePath))) {
        // Move to previous day if file doesn't exist
        currentPlainDate = currentPlainDate.addDays(-1)
        continue
      }

      try {
        const dayModel = await readDay(currentPlainDate)

        if (!dayModel.ended) {
          incompleteDays.push({
            plainDate: currentPlainDate,
            ymd: currentPlainDate.ymd,
          })
        }
      } catch (_error) {
        // If we can't read the file, skip to previous day
      }

      // Move to previous day
      currentPlainDate = currentPlainDate.addDays(-1)

      // Stop when we reach the cutoff date (before started/ended feature existed)
      if (PlainDate.compare(currentPlainDate, STARTED_ENDED_CUTOFF) < 0) {
        searchComplete = true
      }
    }

    // Output incomplete days with oldest first
    incompleteDays.reverse()

    if (incompleteDays.length === 0) {
      output.log(
        colors.green('\n  ✓ No incomplete days found') + colors.gray(` (excluding current day: ${currentDayYmd})\n`),
      )
    } else {
      const dayCount = incompleteDays.length
      const dayText = dayCount === 1 ? 'day' : 'days'
      output.log(colors.yellow('\n  Incomplete days') + colors.gray(' (not ended):'))
      output.log(colors.gray(`  Excluding current day: ${currentDayYmd}\n`))
      for (const day of incompleteDays) {
        const dayOfWeek = day.plainDate.dayShort
        output.log(`    ${colors.yellowBright(day.ymd)} ${colors.gray('-')} ${colors.cyan(dayOfWeek)}`)
      }
      output.log(colors.gray(`\n  ${dayCount} ${dayText} remaining`))
    }

    return CommandResult.success()
  }
}
