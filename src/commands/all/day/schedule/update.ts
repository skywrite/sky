import { Command, CommandResult } from '#commands/mod.ts'
import type { CommandArgs, CommandDescription } from '#commands/lib/commands.d.ts'
import { PlainDate } from '#universal/dates/nbdt/mod.ts'
import { writeDayItems } from '#lib/nbfs/mod.ts'
import DayDocument from '#shared/models/Day/document/mod.ts'
import type { Link } from '#shared/models/Markdown/Link/mod.ts'
import extractAndDeleteDayItems from '../_extractAndDeleteDayItems.ts'

async function writeScheduleItems(day: PlainDate, category: string, items: string[], links: Map<string, Link>) {
  const commitments = items.filter((item) => DayDocument.itemStartsWithTime(item))
  const todos = items.filter((item) => !DayDocument.itemStartsWithTime(item))

  if (commitments.length > 0) await writeDayItems(day, `${category} Commitments`, commitments, { links })
  if (todos.length > 0) await writeDayItems(day, `${category} Todos`, todos, { links })
}

export default class DayScheduleUpdateTask extends Command {
  static override description: CommandDescription = {
    name: 'day:schedule:update',
    description: 'Extract scheduled tasks into day.',
  }

  async run({ context }: CommandArgs): Promise<CommandResult> {
    const { config } = context
    // TODO: eventually allow passing any date
    const day = new PlainDate()
    const dayStr = day.ymd

    const { items: professionalItems, links: professionalLinks } = await extractAndDeleteDayItems(
      <string>config.FILE_SCHEDULE_PROFESSIONAL,
      dayStr,
    )
    await writeScheduleItems(day, 'Professional', professionalItems, professionalLinks)

    const { items: personalItems, links: personalLinks } = await extractAndDeleteDayItems(
      <string>config.FILE_SCHEDULE_PERSONAL,
      dayStr,
    )
    await writeScheduleItems(day, 'Personal', personalItems, personalLinks)

    return CommandResult.success()
  }
}
