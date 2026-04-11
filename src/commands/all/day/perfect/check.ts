import { readDay } from '#shared/nbfs/mod.ts'
import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:perfect:check': { params: Params; result: { perfect: boolean } }
  }
}

export default class DayPerfectCheckTask extends Command {
  static override description: CommandDescription = {
    name: 'day:perfect:check',
    description: 'Check if a day is perfect (all tasks executed)',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<{ perfect: boolean }>> {
    const { output } = context
    const { day } = args

    const dayDoc = await readDay(day)
    const isPerfect = dayDoc.perfect

    if (isPerfect) {
      output.log(`${day.ymd}: Perfect`)
    } else {
      output.log(`${day.ymd}: Not perfect`)
    }

    return CommandResult.success({ perfect: isPerfect })
  }
}
