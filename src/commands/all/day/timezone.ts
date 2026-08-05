import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'

// we don't pass a date arg since the historical timezone
// is dependent upon location

export default class DayTimezoneTask extends Command {
  static override description: CommandDescription = {
    name: 'day:timezone',
    description: 'Set the timezone in the current day file.',
  }

  async run({ context, tasks }: CommandArgs): Promise<CommandResult> {
    const { output } = context
    const now = new PlainDate()

    let dayModel = await readDay(now)

    const tzResult = await tasks.run('util:timezone')
    const tzIANA = tzResult.data?.iana
    if (!tzIANA) return CommandResult.fail('Unable to detect the current timezone.')

    dayModel = dayModel.setTimezone(tzIANA)

    await writeDay(dayModel)

    output.log(`\n  Set timezone:\n`)
    output.log(`    IANA: ${tzIANA}\n`)

    return CommandResult.success()
  }
}
