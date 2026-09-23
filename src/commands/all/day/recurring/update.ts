import type { CommandArgs, CommandDescription, InferParams } from '#commands/mod.ts'
import { Command, CommandResult, dayArg } from '#commands/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import readTextFile from '#shared/fs/readTextFile.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import extractDayItems from '../_extractDayItems.ts'

const params = { day: dayArg() }
type Params = InferParams<typeof params>

declare module '#commands/lib/core/CommandTypesRegistry.ts' {
  interface CommandTypesRegistry {
    'day:recurring:update': { params: Params; result: undefined }
  }
}

export default class DayRecurringUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:recurring:update',
    description: 'Extract recurring tasks into day.',
    params,
  }

  async run({ context, args }: CommandArgs<Params>): Promise<CommandResult> {
    const { config } = context
    const plainDate = args.day ?? PlainDate.today()

    const personalMarkdown = await readTextFile(<string>config.FILE_RECURRING_PERSONAL)
    const professionalMarkdown = await readTextFile(<string>config.FILE_RECURRING_PROFESSIONAL)

    const professionalDoc = ListDocument.fromMarkdown(professionalMarkdown)
    const personalDoc = ListDocument.fromMarkdown(personalMarkdown)

    // Now just pass PlainDate - it handles legacy conversion internally
    const professionalItems = extractDayItems(professionalDoc, plainDate)
    const professionalItemsCommitment = professionalItems.filter(DayDocument.itemStartsWithTime)
    const professionalItemsBacklog = professionalItems.filter(DayDocument.itemDoesNotStartWithTime)

    await writeDayItems(plainDate, 'Professional Commitments', professionalItemsCommitment, {
      timeDir: config.DIR_TIME,
    })
    await writeDayItems(plainDate, 'Professional Todos', professionalItemsBacklog, { timeDir: config.DIR_TIME })

    const personalItems = extractDayItems(personalDoc, plainDate)
    const personalItemsCommitment = personalItems.filter(DayDocument.itemStartsWithTime)
    const personalItemsBacklog = personalItems.filter(DayDocument.itemDoesNotStartWithTime)

    await writeDayItems(plainDate, 'Personal Commitments', personalItemsCommitment, { timeDir: config.DIR_TIME })
    await writeDayItems(plainDate, 'Personal Todos', personalItemsBacklog, { timeDir: config.DIR_TIME })

    return CommandResult.success()
  }
}
