import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { Command, CommandResult } from '#commands/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import readTextFile from '#shared/fs/readTextFile.ts'
import DayDocument from '#shared/models/Day/mod.ts'
import ListDocument from '#shared/models/Markdown/ListDocument/mod.ts'
import PlainDate from '#shared/universal/dates/nbdt/PlainDate/mod.ts'
import extractDayItems from '../_extractDayItems.ts'

export default class DayRecurringUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:recurring:update',
    description: 'Extract recurring tasks into day.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { config } = context
    // TODO: eventually allow passing any date
    const plainDate = PlainDate.today()

    const personalMarkdown = await readTextFile(<string>config.FILE_RECURRING_PERSONAL)
    const professionalMarkdown = await readTextFile(<string>config.FILE_RECURRING_PROFESSIONAL)

    const professionalDoc = ListDocument.fromMarkdown(professionalMarkdown)
    const personalDoc = ListDocument.fromMarkdown(personalMarkdown)

    // Now just pass PlainDate - it handles legacy conversion internally
    const professionalItems = extractDayItems(professionalDoc, plainDate)
    const professionalItemsCommitment = professionalItems.filter(DayDocument.itemStartsWithTime)
    const professionalItemsBacklog = professionalItems.filter(DayDocument.itemDoesNotStartWithTime)

    await writeDayItems(plainDate, 'Professional Commitments', professionalItemsCommitment)
    await writeDayItems(plainDate, 'Professional Todos', professionalItemsBacklog)

    const personalItems = extractDayItems(personalDoc, plainDate)
    const personalItemsCommitment = personalItems.filter(DayDocument.itemStartsWithTime)
    const personalItemsBacklog = personalItems.filter(DayDocument.itemDoesNotStartWithTime)

    await writeDayItems(plainDate, 'Personal Commitments', personalItemsCommitment)
    await writeDayItems(plainDate, 'Personal Todos', personalItemsBacklog)

    return CommandResult.success()
  }
}
