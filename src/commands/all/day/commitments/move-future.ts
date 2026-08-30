import * as path from 'node:path'
import { parsePartialDate } from '#commands/lib/args/parsePartialDate.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { categoryCommitment, Command, CommandResult, Flag } from '#commands/mod.ts'
import type { InferParams } from '#commands/mod.ts'
import { DIR_TIME } from '#config'
import { exists } from '#shared/fs/mod.ts'
import { dayFile, readDay, writeDay } from '#shared/nbfs/mod.ts'
import { appendCommitments } from './lib/moveCommitments.ts'

const params = {
  old: Flag.plainDate('Old Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'o',
    required: true,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: true }),
  }),
  new: Flag.plainDate('New Day (e.g., 27, 8-27, 2025-08-27)', {
    short: 'n',
    required: true,
    parse: (input: string) => parsePartialDate(input, { rejectFuture: false }),
  }),
  category: categoryCommitment(),
  noIncomplete: Flag.bool('Do not create an Incomplete section in the source day', {
    short: 'I',
    default: false,
  }),
}

type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:commitments:move-future': { params: Params; result: undefined }
  }
}

export default class DayCommitmentsMoveFutureTask extends Command {
  static override description: CommandDescription = {
    name: 'day:commitments:move-future',
    description: "Put unfinished commitments on another day's Commitments list",
    params,
  }

  async run({ args, context, tasks }: CommandArgs<Params>): Promise<CommandResult> {
    const { category, old: oldDate, new: newDate, noIncomplete } = args

    // Checked before the sweep touches the source day: a sweep with nowhere to
    // land would leave the items under Incomplete and a rerun with nothing to move.
    const targetFile = path.join(DIR_TIME, dayFile(newDate))
    if (!(await exists(targetFile))) {
      return CommandResult.error(
        `Day file does not exist: ${newDate.ymd}. Create its week first with 'sky week:new --when ${newDate.ymd}'.`,
      )
    }

    const result = await tasks.run('day:commitments:incomplete', { day: oldDate, category, cleanOnly: noIncomplete })
    if (!result.ok) return result

    const moved = result.data?.incompleteItems?.get(category)
    if (!moved || moved.size === 0) return CommandResult.success()

    const targetDoc = appendCommitments(await readDay(newDate), category, moved)
    await writeDay(targetDoc)

    context.output.log(`\n  Moved ${moved.size} commitments to ${newDate.ymd}.\n`)
    return CommandResult.success()
  }
}
