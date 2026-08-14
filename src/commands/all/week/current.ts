import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { Week } from '#universal/dates/nbdt/mod.ts'

const params = {}

type Params = InferParams<typeof params>

export default class WeekCurrentTask extends Command {
  static override description: CommandDescription = {
    name: 'week:current',
    description: 'Show the current week (Mon–Sun, notebook time).',
    params,
  }

  async run({ context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context

    // notebook now, so a 25:30 session still belongs to the started day's week
    const week = Week.of(await fetchNow())

    output.log(
      `${week.toString()} · ${week.start.dayShort} ${week.start.ymd} – ${week.end.dayShort} ${week.end.ymd}` +
        ` · week ${week.number} of ${Week.lastOfYear(week.year)}`,
    )

    return CommandResult.success()
  }
}
