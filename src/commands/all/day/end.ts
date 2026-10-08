import { Command, CommandResult, dayNoFutureArg, Flag } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import { readDay, writeDay } from '#shared/nbfs/mod.ts'

const params = {
  day: dayNoFutureArg(),
  perfect: Flag.bool('Mark the day perfect if all planned items are done', { default: true }),
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
    const { output, notebookNow, config } = context
    const { day, perfect } = args

    // Get YMD format for display
    const dayYMD = day.ymd

    // Warn about unlogged meetings while the day can still be amended.
    await tasks.run('day:meeting:check', { day })

    let dayObj = await readDay(day, config.DIR_TIME)

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
    const isPerfect = perfect && dayObj.perfect
    dayObj = dayObj.updateYaml({ perfect: isPerfect })

    dayObj = dayObj.removeEmptyLists()

    await writeDay(dayObj, config.DIR_TIME)

    // Add entry to current day
    const dayItem = `${notebookNow.plainDateTime.time} > Notebook -> ${dayYMD} End`
    await writeDayItems(notebookNow.plainDateTime.plainDate, 'Professional Complete', dayItem, {
      timeDir: config.DIR_TIME,
    })

    output.log(`\n  Set ended on ${dayYMD} to ${dayObj.ended?.toString()}`)
    if (isPerfect) {
      output.log(`  Perfect day!`)
    }
    output.log('')

    await tasks.run('day:attachments:check', { day })

    // Run configurable end-of-day commands (day.end in config)
    for (const cmd of config.DAY_END_COMMANDS) {
      await tasks.run(cmd, { day }).catch((err: Error) => {
        console.warn(`  [day:end] ${cmd}: ${err.message}`)
      })
    }

    return CommandResult.success()
  }
}
