import { Command, CommandResult } from '#commands/mod.ts'
import { currentTimezoneIANA } from '#universal/dates/timezones/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// we don't pass a date arg since the historical timezone
// is dependent upon location

export default class DayTimezoneTask extends Command {
  static override description: CommandDescription = {
    name: 'day:timezone',
    description: 'Set the timezone in the current day file.',
  }

  async run({ args, context }: CommandArgs): Promise<CommandResult> {
    const { config, output } = context
    const now = new PlainDate()

    let dayModel = await readDay(now)

    const tzIANA = currentTimezoneIANA()

    // Use the new setTimezone method
    dayModel = dayModel.setTimezone(tzIANA)

    await writeDay(dayModel)

    output.log(`\n  Set timezone:\n`)
    output.log(`    IANA: ${tzIANA}\n`)

    return CommandResult.success()
  }
}
