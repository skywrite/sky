import { Arg, Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { fetchNow } from '#shared/nbfs/mod.ts'
import { renderYearGrid } from './lib/yearGrid.ts'

const params = {
  year: Arg.string('Year to render (defaults to the current notebook year)', { optional: true }),
}

type Params = InferParams<typeof params>

export default class WeeksYearTask extends Command {
  static override description: CommandDescription = {
    name: 'weeks:year',
    description: 'Year at a glance — every sky week (W00–W53) by quarter and month.',
    usage: ['sky weeks:year', 'sky weeks:year 2027'],
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult> {
    const { output } = context

    // notebook now, so a 25:30 session still lights up the started day's week
    const today = (await fetchNow()).plainDateTime.plainDate

    let year = today.year
    if (args.year !== undefined) {
      const trimmed = args.year.trim()
      if (!/^\d{4}$/.test(trimmed)) {
        return CommandResult.error(`Invalid year "${args.year}" — expected a 4-digit year like 2027`)
      }
      year = Number(trimmed)
    }

    output.log('')
    for (const line of renderYearGrid(year, { today })) output.log(line)
    output.log('')

    return CommandResult.success()
  }
}
