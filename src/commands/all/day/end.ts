import { Command, CommandResult, dayNoFutureArg } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { DAY_END_COMMANDS } from '#config'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'

const params = {
  day: dayNoFutureArg(),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:end': { params: Params; result: undefined }
  }
}

export default class DayEndTask extends Command {
  static override description: CommandDescription = {
    name: 'day:end',
    description: 'Run tasks for end of the day.',
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { output, notebookNow } = context
    const { day } = args

    // Get YMD format for display
    const dayYMD = day.ymd

    let dayObj = await readDay(day)

    dayObj = dayObj.setEnded(notebookNow) // Pass full ZonedDateTime to preserve timezone

    // Check if the day is perfect and persist to YAML.
    //
    // Why persist to YAML when Day.perfect is computed?
    // The act of seeing `perfect: true` written to the day file IS THE REWARD.
    // It's the accomplishment, the gold star, the moment of satisfaction for
    // executing the plan. Computed state alone doesn't give that feeling -
    // having it permanently recorded in the file does.
    //
    // Design note: We intentionally don't have a Day.setPerfect() method because
    // the getter reads from computed state (lists), not YAML. Having a setter
    // that writes YAML while the getter ignores it would be confusing.
    const isPerfect = dayObj.perfect
    if (isPerfect) {
      dayObj = dayObj.updateYaml({ perfect: true })
    }

    dayObj = dayObj.removeEmptyLists()

    await writeDay(dayObj)

    // Delete the day from Supabase
    await tasks.run('supabase:days:delete', { from: dayYMD })

    // Add entry to current day
    const dayItem = `${notebookNow.plainDateTime.time} > Notebook -> ${dayYMD} End`
    await writeDayItems(notebookNow.plainDateTime.plainDate, 'Professional Complete', dayItem)

    output.log(`\n  Set ended on ${dayYMD} to ${dayObj.ended?.toString()}`)
    if (isPerfect) {
      output.log(`  Perfect day!`)
    }
    output.log('')

    await tasks.run('day:attachments:check', { day })

    // Run configurable end-of-day commands (day.end in config)
    for (const cmd of DAY_END_COMMANDS) {
      await tasks.run(cmd, { day }).catch((err: Error) => {
        console.warn(`  [day:end] ${cmd}: ${err.message}`)
      })
    }

    return CommandResult.success()
  }
}
