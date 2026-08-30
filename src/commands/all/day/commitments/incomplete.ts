import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { categoryCommitment, Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
import type ItemList from '#shared/models/Markdown/ItemList/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'
import { incompleteTitle, sweepIncomplete } from './lib/moveCommitments.ts'

const params = {
  day: dayNoFutureArg(),
  category: categoryCommitment(),
  dryRun: Flag.bool('Return incomplete items without modifying the day', {
    short: 'd',
    default: false,
  }),
  cleanOnly: Flag.bool('Clean commitments but do not create Incomplete section', {
    short: 'C',
    default: false,
  }),
}

type Params = InferParams<typeof params>
type Result = { incompleteItems: Map<string, ItemList> }

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:commitments:incomplete': { params: Params; result: Result }
  }
}

export default class DayCommitmentsIncompleteTask extends Command {
  static override description: CommandDescription = {
    name: 'day:commitments:incomplete',
    description: 'Move unfinished commitments to the Incomplete section',
    params,
  }

  async run({ args, context }: CommandArgs<Params>): Promise<CommandResult<Result>> {
    const { output } = context
    const { category, day, dryRun, cleanOnly } = args

    const dayDoc = await readDay(day)
    const swept = sweepIncomplete(dayDoc, category, { cleanOnly })
    if (!swept) return CommandResult.error(`Cannot find ${day.ymd} ${category}.`)

    const { doc, notDone } = swept
    const incompleteItems = new Map<string, ItemList>([[category, notDone]])

    if (notDone.size === 0) {
      output.log(`\n  No incomplete items in ${category}.\n`)
      return CommandResult.success({ incompleteItems })
    }

    if (dryRun) {
      output.log(`\n  ${notDone.size} incomplete items in ${category}:\n`)
      for (const item of notDone) {
        output.log(`    - ${item}`)
      }
      output.log('')
      return CommandResult.success({ incompleteItems })
    }

    await writeDay(doc)

    if (cleanOnly) {
      output.log(`\n  Cleaned ${notDone.size} incomplete items from ${category}.\n`)
    } else {
      output.log(`\n  Moved ${notDone.size} items to ${incompleteTitle(category)}.\n`)
    }
    return CommandResult.success({ incompleteItems })
  }
}
